import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, timingSafeEqual } from 'crypto';
import type { JsonWebKey, KeyObject } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

/**
 * The issuers Meta signs Limited Login tokens as. Its discovery document
 * (`limited.facebook.com/.well-known/openid-configuration/`) names the first;
 * Meta's docs allow the second as well.
 */
export const FACEBOOK_ISSUERS: [string, string] = [
  'https://www.facebook.com',
  'https://limited.facebook.com',
];
/**
 * Meta's Limited Login keys. The older `/.well-known/openid/jwks/` address
 * now redirects to a cookie prompt, so it cannot be fetched from a server.
 */
export const FACEBOOK_KEYS_URL =
  'https://limited.facebook.com/.well-known/oauth/openid/jwks/';
const GRAPH_URL = 'https://graph.facebook.com';

/** Meta's keys are fetched again after this long. */
const KEYS_TTL_MS = 60 * 60 * 1000;
/** A token naming a key we lack fetches the keys again, at most this often (so made-up key ids cannot hammer Meta). */
const KEYS_REFETCH_MIN_MS = 60 * 1000;
/** Slack for clocks a little apart. */
const CLOCK_TOLERANCE_S = 60;
/** Meta answers in well under this; a hung call must not hold a sign-in. */
const FACEBOOK_TIMEOUT_MS = 8000;

/** Who Facebook says signed in, from either kind of token. */
export interface FacebookIdentity {
  /**
   * The app-scoped user id (`sub` in a Limited Login token, `id` from
   * Graph's `/me`). Meta gives a person one id per app (its discovery
   * document lists `pairwise` subjects), the same under both kinds of
   * token, so one person maps to one account on the web, Android and the
   * iPhone.
   */
  id: string;
  /** Trimmed; null when the person did not share it. */
  email: string | null;
  givenName: string | null;
  familyName: string | null;
  /** The full name, for when the parts are missing. */
  name: string | null;
}

/** A token failed a check. The message is for the log, never the person. */
export class FacebookTokenError extends Error {}

interface FacebookIdTokenClaims {
  sub?: string;
  exp?: number;
  nonce?: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
}

interface FacebookJwks {
  keys?: (JsonWebKey & { kid?: string })[];
}

/** Graph's `debug_token` answer. */
interface FacebookDebugToken {
  data?: {
    app_id?: string;
    is_valid?: boolean;
    user_id?: string;
    /** Why the input token is not valid. */
    error?: { message?: string };
  };
  /** Why the call itself failed (our app credentials, usually). */
  error?: { message?: string };
}

/** Graph's `/me` answer, with the fields we ask for. */
interface FacebookMe {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  error?: { message?: string };
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/** A trimmed string, or null when there is nothing in it. */
function textOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

/** Why `debug_token` refused a token, for the log. */
function debugRefusal(debug: FacebookDebugToken): string {
  const callError = debug.error;
  if (callError && callError.message) {
    return callError.message;
  }
  const data = debug.data;
  if (data && data.error && data.error.message) {
    return data.error.message;
  }
  return 'not valid';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return 'unknown';
}

/**
 * Checks Facebook sign-ins, which come in two kinds:
 *
 * - A Graph access token (web, Android), checked with Graph's
 *   `debug_token` under our app credentials, which must say the token is
 *   valid and was minted for our app, then read with `/me`.
 * - A Limited Login ID token (iPhone). The app never asks for App Tracking
 *   Transparency, so Facebook's iOS SDK runs in Limited Login and returns an
 *   OpenID Connect JWT, which Graph does not accept. It is checked by hand
 *   against Meta's published keys (RS256, issuer, audience = our app id,
 *   expiry, then the nonce), as Apple's tokens are.
 *
 * The nonce: the app makes a random raw nonce, passes it as `nonce` to
 * `@capgo/capacitor-social-login`'s Facebook login and sends it to us as
 * `rawNonce`. The plugin hands that string unchanged to the SDK's
 * `LoginConfiguration(permissions:tracking:nonce:)` (8.7.4,
 * `FacebookProvider.swift`), the SDK sends it unchanged as the `nonce`
 * parameter (`LoginManager.swift`), and Meta echoes it into the token's
 * `nonce` claim. So, unlike Apple (which is given a SHA-256), the claim must
 * equal the raw nonce itself. Without a nonce of its own the plugin sends
 * "123", which is why the API requires one.
 */
@Injectable()
export class FacebookIdentityService {
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

  /** Whether access tokens can be checked: `debug_token` needs the app id and secret. */
  get canCheckAccessTokens(): boolean {
    return Boolean(this.appId() && this.appSecret());
  }

  /** Whether Limited Login tokens can be checked: only the app id is needed. */
  get canCheckIdTokens(): boolean {
    return Boolean(this.appId());
  }

  /**
   * Check a Graph access token and read who it belongs to. Throws
   * `FacebookTokenError` for anything wrong with it.
   */
  async verifyAccessToken(accessToken: string): Promise<FacebookIdentity> {
    const appId = this.appId();
    const appSecret = this.appSecret();
    if (!appId || !appSecret) {
      throw new FacebookTokenError('Facebook access tokens are not configured');
    }

    const debugUrl = new URL(`${GRAPH_URL}/debug_token`);
    debugUrl.searchParams.set('input_token', accessToken);
    debugUrl.searchParams.set('access_token', `${appId}|${appSecret}`);
    const debug = await this.getJson<FacebookDebugToken>(
      debugUrl,
      'debug_token',
    );
    const data = debug.data;
    if (!data || data.is_valid !== true) {
      throw new FacebookTokenError(
        `debug_token refused the token: ${debugRefusal(debug)}`,
      );
    }
    // A valid token minted for another app must not sign anyone in here.
    if (data.app_id !== appId) {
      throw new FacebookTokenError('Token was minted for another app');
    }
    if (!data.user_id) {
      throw new FacebookTokenError('debug_token named no user');
    }

    const meUrl = new URL(`${GRAPH_URL}/me`);
    meUrl.searchParams.set('fields', 'id,email,first_name,last_name,name');
    meUrl.searchParams.set('access_token', accessToken);
    const me = await this.getJson<FacebookMe>(meUrl, 'me');
    if (me.error || !me.id) {
      let reason = 'no id';
      if (me.error?.message) {
        reason = me.error.message;
      }
      throw new FacebookTokenError(`/me returned no profile: ${reason}`);
    }
    if (me.id !== data.user_id) {
      throw new FacebookTokenError('/me names another user than debug_token');
    }

    return {
      id: me.id,
      email: textOrNull(me.email),
      givenName: textOrNull(me.first_name),
      familyName: textOrNull(me.last_name),
      name: textOrNull(me.name),
    };
  }

  /**
   * Check a Limited Login ID token and say who it names. Throws
   * `FacebookTokenError` for anything wrong with it. Makes no Graph call:
   * Graph refuses these tokens.
   */
  async verifyIdToken(
    idToken: string,
    rawNonce: string,
  ): Promise<FacebookIdentity> {
    const appId = this.appId();
    if (!appId) {
      throw new FacebookTokenError('Facebook sign-in is not configured');
    }

    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded.payload === 'string') {
      throw new FacebookTokenError('Not a JWT');
    }
    if (decoded.header.alg !== 'RS256') {
      throw new FacebookTokenError(
        `Unexpected algorithm ${decoded.header.alg}`,
      );
    }
    const kid = decoded.header.kid;
    if (!kid) {
      throw new FacebookTokenError('No key id');
    }
    const publicKey = await this.publicKeyFor(kid);

    let verified: string | jwt.JwtPayload;
    try {
      verified = jwt.verify(idToken, publicKey, {
        algorithms: ['RS256'],
        issuer: FACEBOOK_ISSUERS,
        audience: appId,
        clockTolerance: CLOCK_TOLERANCE_S,
      });
    } catch (err) {
      throw new FacebookTokenError(`Token rejected: ${errorMessage(err)}`);
    }
    if (typeof verified === 'string') {
      throw new FacebookTokenError('Token has no claims');
    }
    const claims: FacebookIdTokenClaims = verified;

    // jwt.verify checks `exp` only when the token has one.
    if (typeof claims.exp !== 'number') {
      throw new FacebookTokenError('No expiry');
    }
    // The nonce Facebook was given is the raw one (see the class comment).
    if (!claims.nonce || !sameText(claims.nonce, rawNonce)) {
      throw new FacebookTokenError('Nonce mismatch');
    }
    if (!claims.sub) {
      throw new FacebookTokenError('No subject');
    }

    return {
      id: claims.sub,
      email: textOrNull(claims.email),
      givenName: textOrNull(claims.given_name),
      familyName: textOrNull(claims.family_name),
      name: textOrNull(claims.name),
    };
  }

  private appId(): string | undefined {
    return this.configService.get<string>('FACEBOOK_APP_ID');
  }

  private appSecret(): string | undefined {
    return this.configService.get<string>('FACEBOOK_APP_SECRET');
  }

  /**
   * A Graph GET read as JSON. The URL carries tokens, so neither it nor
   * the response is ever logged.
   */
  private async getJson<T>(url: URL, label: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(FACEBOOK_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FacebookTokenError(
        `${label} request failed: ${errorMessage(err)}`,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new FacebookTokenError(
        `${label} answered HTTP ${response.status} without JSON`,
      );
    }
  }

  /**
   * Meta's public key for `kid`, from a cached copy of its key set. The
   * copy is fetched again when an hour old or when a token names a key it
   * lacks (Meta rotated), at most once a minute; if that fetch fails, the
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
      throw new FacebookTokenError(`Unknown key id ${kid}`);
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
    let jwks: FacebookJwks;
    try {
      const response = await fetch(FACEBOOK_KEYS_URL, {
        signal: AbortSignal.timeout(FACEBOOK_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      jwks = (await response.json()) as FacebookJwks;
    } catch (err) {
      this.logger.warn(
        `Could not fetch Meta's Limited Login keys: ${errorMessage(err)}`,
        'FacebookIdentityService',
      );
      throw new FacebookTokenError("Meta's keys are unavailable");
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
      throw new FacebookTokenError("Meta's key set was empty");
    }
    this._keys = keys;
    this._keysFetchedAt = Date.now();
  }
}
