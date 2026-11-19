import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPublicKey, timingSafeEqual } from 'crypto';
import type { JsonWebKey, KeyObject } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

export const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

/** Apple rotates its signing keys rarely; a day-old copy is fine. */
const KEYS_TTL_MS = 24 * 60 * 60 * 1000;
/** A token naming a key we lack fetches the keys again, at most this often (so made-up key ids cannot hammer Apple). */
const KEYS_REFETCH_MIN_MS = 60 * 1000;
/** Slack for clocks a little apart. */
const CLOCK_TOLERANCE_S = 60;
/** The client secret only lives for the one request it signs. */
const CLIENT_SECRET_TTL_S = 300;
/** Apple's endpoints answer in well under this; a hung call must not hold a sign-in. */
const APPLE_TIMEOUT_MS = 8000;

/** Who Apple says signed in, from a checked identity token. */
export interface AppleIdentity {
  /** Apple's stable user id for our team: the same on the iPhone and the web. */
  sub: string;
  /** The audience the token was minted for: the bundle id or the Services ID. Exchanges and revokes use it as `client_id`. */
  clientId: string;
  /** Missing for some managed Apple accounts. */
  email: string | null;
  emailVerified: boolean;
  /** A Hide My Email relay address. */
  isPrivateEmail: boolean;
}

/** What exchanging a sign-in's authorization code came to. */
export type AppleCodeExchange =
  | { status: 'ok'; refreshToken: string }
  | { status: 'skipped' | 'failed'; reason: string };

/** The identity token failed a check. The message is for the log, never the person. */
export class AppleTokenError extends Error {}

interface AppleIdTokenClaims {
  sub?: string;
  aud?: string | string[];
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
}

interface AppleJwks {
  keys?: (JsonWebKey & { kid?: string })[];
}

interface AppleTokenResponse {
  refresh_token?: string;
  id_token?: string;
  error?: string;
}

/** Apple sends some booleans as strings ("true") and some as booleans. */
function isTrueClaim(value: boolean | string | undefined): boolean {
  return value === true || value === 'true';
}

/** SHA-256 of the raw nonce, hex: what the client gave Apple. */
function hashNonce(rawNonce: string): string {
  return createHash('sha256').update(rawNonce, 'utf8').digest('hex');
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Talks to Apple for Sign in with Apple: checks identity tokens, exchanges a
 * sign-in's code for a refresh token, and revokes it.
 *
 * Tokens are checked by hand against Apple's published keys (RS256, issuer,
 * audience, expiry, then the nonce) because `google-auth-library` only knows
 * Google. Two audiences are accepted: the iOS app's bundle id and the web
 * Services ID; Apple gives one person the same `sub` under both.
 *
 * The nonce: the client makes a random raw nonce, hands Apple its SHA-256
 * (hex), and sends us the raw one; the token must carry the hash. That ties
 * the token to the client that asked for it.
 */
@Injectable()
export class AppleIdentityService {
  private _keys = new Map<string, KeyObject>();
  /** When the keys held were fetched. */
  private _keysFetchedAt = 0;
  /** When a fetch last started, successful or not: the once-a-minute limit counts from here. */
  private _keysAttemptedAt = 0;
  private _keysLoading: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /** The client ids Apple tokens may be minted for. Empty when Apple is not set up. */
  audiences(): string[] {
    const audiences: string[] = [];
    const bundleId = this.bundleId();
    if (bundleId) {
      audiences.push(bundleId);
    }
    const servicesId = this.servicesId();
    if (servicesId) {
      audiences.push(servicesId);
    }
    return audiences;
  }

  get isAvailable(): boolean {
    return this.audiences().length > 0;
  }

  /** Whether the key that signs client secrets is set, which exchanging and revoking need. */
  get canCallApple(): boolean {
    return this.clientSecretParts() !== null;
  }

  /**
   * Check an identity token and say who it names. Throws `AppleTokenError`
   * for anything wrong with it.
   */
  async verifyIdentityToken(
    idToken: string,
    rawNonce: string,
  ): Promise<AppleIdentity> {
    const audiences = this.audiences();
    if (audiences.length === 0) {
      throw new AppleTokenError('Apple sign-in is not configured');
    }

    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded.payload === 'string') {
      throw new AppleTokenError('Not a JWT');
    }
    if (decoded.header.alg !== 'RS256') {
      throw new AppleTokenError(`Unexpected algorithm ${decoded.header.alg}`);
    }
    const kid = decoded.header.kid;
    if (!kid) {
      throw new AppleTokenError('No key id');
    }
    const publicKey = await this.publicKeyFor(kid);

    const [firstAudience, ...otherAudiences] = audiences;
    let verified: string | jwt.JwtPayload;
    try {
      verified = jwt.verify(idToken, publicKey, {
        algorithms: ['RS256'],
        issuer: APPLE_ISSUER,
        audience: [firstAudience, ...otherAudiences],
        clockTolerance: CLOCK_TOLERANCE_S,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      throw new AppleTokenError(`Token rejected: ${message}`);
    }
    if (typeof verified === 'string') {
      throw new AppleTokenError('Token has no claims');
    }
    const claims: AppleIdTokenClaims = verified;

    // Apple: treat the nonce as mandatory and fail without it.
    if (!claims.nonce || !sameText(claims.nonce, hashNonce(rawNonce))) {
      throw new AppleTokenError('Nonce mismatch');
    }
    if (!claims.sub) {
      throw new AppleTokenError('No subject');
    }

    const clientId = this.matchedAudience(claims.aud, audiences);
    if (!clientId) {
      throw new AppleTokenError('No accepted audience');
    }

    let email: string | null = null;
    if (claims.email) {
      email = claims.email.trim().toLowerCase();
    }

    return {
      sub: claims.sub,
      clientId,
      email,
      emailVerified: isTrueClaim(claims.email_verified),
      isPrivateEmail: isTrueClaim(claims.is_private_email),
    };
  }

  /**
   * Trade a sign-in's one-time code for a refresh token (the thing that
   * revokes the grant later). Never throws: a failure only means there is
   * nothing to store this time, and the next Apple sign-in tries again.
   * `sub` must match the person the code was issued to.
   */
  async exchangeCode(
    code: string,
    identity: Pick<AppleIdentity, 'sub' | 'clientId'>,
  ): Promise<AppleCodeExchange> {
    const secret = this.clientSecret(identity.clientId);
    if (!secret) {
      return { status: 'skipped', reason: 'no Apple key configured' };
    }

    const body = new URLSearchParams({
      client_id: identity.clientId,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
    });
    // Web codes were issued for the popup's return URL and must be traded
    // with exactly it; codes from the iPhone app have none.
    if (identity.clientId === this.servicesId()) {
      const redirectUri = this.configService.get<string>(
        'APPLE_WEB_REDIRECT_URI',
      );
      if (!redirectUri) {
        return { status: 'skipped', reason: 'no APPLE_WEB_REDIRECT_URI' };
      }
      body.set('redirect_uri', redirectUri);
    }

    let response: Response;
    try {
      response = await this.post(APPLE_TOKEN_URL, body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return { status: 'failed', reason: `request failed: ${message}` };
    }

    let data: AppleTokenResponse = {};
    try {
      data = (await response.json()) as AppleTokenResponse;
    } catch {
      // Not JSON: reported by status below.
    }
    if (!response.ok) {
      let error = `HTTP ${response.status}`;
      if (data.error) {
        error = data.error;
      }
      return { status: 'failed', reason: error };
    }
    if (!data.refresh_token || !data.id_token) {
      return { status: 'failed', reason: 'no refresh token in the answer' };
    }

    // Straight from Apple over TLS, so reading it is enough; it must name
    // the person who signed in.
    const exchanged = jwt.decode(data.id_token);
    if (
      !exchanged ||
      typeof exchanged === 'string' ||
      exchanged.sub !== identity.sub
    ) {
      return { status: 'failed', reason: 'code belongs to someone else' };
    }

    return { status: 'ok', refreshToken: data.refresh_token };
  }

  /**
   * Revoke a refresh token, which ends the person's Sign in with Apple grant
   * for MotionHive. Apple answers 200 for a token already revoked, so a
   * retry is safe. Throws when Apple refuses or cannot be reached.
   */
  async revoke(refreshToken: string, clientId: string): Promise<void> {
    const secret = this.clientSecret(clientId);
    if (!secret) {
      throw new Error('No Apple key configured');
    }
    const response = await this.post(
      APPLE_REVOKE_URL,
      new URLSearchParams({
        client_id: clientId,
        client_secret: secret,
        token: refreshToken,
        token_type_hint: 'refresh_token',
      }),
    );
    if (!response.ok) {
      throw new Error(`Apple refused the revoke: HTTP ${response.status}`);
    }
  }

  /**
   * The client secret Apple's REST endpoints take: a JWT signed ES256 with
   * our Sign in with Apple key, naming the client it speaks for. Null when
   * the key is not configured.
   */
  clientSecret(clientId: string): string | null {
    const parts = this.clientSecretParts();
    if (!parts) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: parts.teamId,
        iat: now,
        exp: now + CLIENT_SECRET_TTL_S,
        aud: APPLE_ISSUER,
        sub: clientId,
      },
      parts.privateKey,
      { algorithm: 'ES256', keyid: parts.keyId },
    );
  }

  private bundleId(): string | undefined {
    const bundleId = this.configService.get<string>('APPLE_BUNDLE_ID');
    if (bundleId) {
      return bundleId;
    }
    return this.configService.get<string>('APNS_BUNDLE_ID');
  }

  private servicesId(): string | undefined {
    return this.configService.get<string>('APPLE_SERVICES_ID');
  }

  private clientSecretParts(): {
    teamId: string;
    keyId: string;
    privateKey: string;
  } | null {
    let teamId = this.configService.get<string>('APPLE_TEAM_ID');
    if (!teamId) {
      teamId = this.configService.get<string>('APNS_TEAM_ID');
    }
    const keyId = this.configService.get<string>('APPLE_KEY_ID');
    const rawKey = this.configService.get<string>('APPLE_PRIVATE_KEY');
    if (!teamId || !keyId || !rawKey) {
      return null;
    }
    // Railway keeps the .p8 on one line with its newlines escaped.
    return { teamId, keyId, privateKey: rawKey.replace(/\\n/g, '\n') };
  }

  /** The accepted audience the token names (`aud` may be a list). */
  private matchedAudience(
    aud: string | string[] | undefined,
    audiences: string[],
  ): string | null {
    let named: string[] = [];
    if (Array.isArray(aud)) {
      named = aud;
    } else if (aud) {
      named = [aud];
    }
    for (const candidate of named) {
      if (audiences.includes(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Apple's public key for `kid`, from a cached copy of its key set. The
   * copy is fetched again when a day old or when a token names a key it
   * lacks (Apple rotated), at most once a minute; if that fetch fails, the
   * copy held still answers.
   */
  private async publicKeyFor(kid: string): Promise<KeyObject> {
    const now = Date.now();
    const stale = now - this._keysFetchedAt > KEYS_TTL_MS;
    const unknown = !this._keys.has(kid);
    const mayFetch = now - this._keysAttemptedAt > KEYS_REFETCH_MIN_MS;
    if ((stale || unknown) && mayFetch) {
      try {
        await this.loadKeys();
      } catch {
        // Logged in fetchKeys; the keys held (if any) still answer below.
      }
    }
    const key = this._keys.get(kid);
    if (!key) {
      throw new AppleTokenError(`Unknown key id ${kid}`);
    }
    return key;
  }

  /** One fetch at a time; a failed one keeps the old keys. */
  private loadKeys(): Promise<void> {
    this._keysLoading ??= this.fetchKeys().finally(() => {
      this._keysLoading = null;
    });
    return this._keysLoading;
  }

  private async fetchKeys(): Promise<void> {
    this._keysAttemptedAt = Date.now();
    let jwks: AppleJwks;
    try {
      const response = await fetch(APPLE_KEYS_URL, {
        signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      jwks = (await response.json()) as AppleJwks;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(
        `Could not fetch Apple's keys: ${message}`,
        'AppleIdentityService',
      );
      throw new AppleTokenError("Apple's keys are unavailable");
    }

    const keys = new Map<string, KeyObject>();
    for (const jwk of jwks.keys || []) {
      if (!jwk.kid) {
        continue;
      }
      try {
        keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {
        // A key we cannot read is skipped; the rest still work.
      }
    }
    if (keys.size === 0) {
      throw new AppleTokenError("Apple's key set was empty");
    }
    this._keys = keys;
    this._keysFetchedAt = Date.now();
  }

  private post(url: string, body: URLSearchParams): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
    });
  }
}
