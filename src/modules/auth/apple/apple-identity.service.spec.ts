import { createHash, generateKeyPairSync } from 'crypto';
import type { KeyObject } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';
import {
  APPLE_ISSUER,
  AppleIdentityService,
  AppleTokenError,
} from './apple-identity.service';

const BUNDLE_ID = 'fit.motionhive.app';
const SERVICES_ID = 'fit.motionhive.web';
const WEB_REDIRECT = 'https://app.motionhive.fit/auth/login';
const RAW_NONCE = 'a'.repeat(64);
const HASHED_NONCE = createHash('sha256').update(RAW_NONCE).digest('hex');

/** A stand-in for Apple: our own RSA key, published as Apple publishes its keys. */
const apple = generateKeyPairSync('rsa', { modulusLength: 2048 });
const APPLE_KID = 'test-kid';
/** The Sign in with Apple .p8 stand-in (ES256). */
const ourKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const OUR_KEY_PEM = ourKey.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();

function jwks(kid: string, publicKey: KeyObject = apple.publicKey) {
  return {
    keys: [
      { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** An identity token as Apple would mint it; `claims` overrides any default. */
function appleToken(
  claims: Record<string, unknown> = {},
  options: { kid?: string; key?: KeyObject } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  let kid = APPLE_KID;
  if (options.kid) {
    kid = options.kid;
  }
  let key = apple.privateKey;
  if (options.key) {
    key = options.key;
  }
  return jwt.sign(
    {
      iss: APPLE_ISSUER,
      aud: BUNDLE_ID,
      sub: '001234.abcdef.1234',
      iat: now,
      exp: now + 600,
      nonce: HASHED_NONCE,
      email: 'Ana@Example.com',
      email_verified: 'true',
      is_private_email: 'false',
      ...claims,
    },
    key,
    { algorithm: 'RS256', keyid: kid },
  );
}

describe('AppleIdentityService', () => {
  let env: Record<string, string | undefined>;
  let fetchMock: jest.SpyInstance;
  let service: AppleIdentityService;

  beforeEach(() => {
    env = {
      APPLE_BUNDLE_ID: BUNDLE_ID,
      APPLE_SERVICES_ID: SERVICES_ID,
      APPLE_WEB_REDIRECT_URI: WEB_REDIRECT,
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY1234567',
      // Escaped newlines, as Railway keeps it.
      APPLE_PRIVATE_KEY: OUR_KEY_PEM.replace(/\n/g, '\\n'),
    };
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    fetchMock = jest.spyOn(global, 'fetch');
    fetchMock.mockImplementation((url: string) => {
      if (url === 'https://appleid.apple.com/auth/keys') {
        return Promise.resolve(jsonResponse(jwks(APPLE_KID)));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    service = new AppleIdentityService(config, makeSilentLogger());
  });

  afterEach(() => {
    // fetch, and Date.now where a test moved the clock.
    jest.restoreAllMocks();
  });

  const keyFetches = () =>
    fetchMock.mock.calls.filter(
      ([url]) => url === 'https://appleid.apple.com/auth/keys',
    ).length;

  describe('verifyIdentityToken', () => {
    it("accepts a token from the iPhone app and reads Apple's string claims", async () => {
      const identity = await service.verifyIdentityToken(
        appleToken(),
        RAW_NONCE,
      );

      expect(identity).toEqual({
        sub: '001234.abcdef.1234',
        clientId: BUNDLE_ID,
        email: 'ana@example.com',
        emailVerified: true,
        isPrivateEmail: false,
      });
    });

    it('accepts a token from the web popup, with boolean claims and a relay address', async () => {
      const identity = await service.verifyIdentityToken(
        appleToken({
          aud: SERVICES_ID,
          email: 'x2k9q7f4mz@privaterelay.appleid.com',
          email_verified: true,
          is_private_email: true,
        }),
        RAW_NONCE,
      );

      expect(identity.clientId).toBe(SERVICES_ID);
      expect(identity.isPrivateEmail).toBe(true);
      expect(identity.emailVerified).toBe(true);
    });

    it('takes the bundle id from APNS_BUNDLE_ID when APPLE_BUNDLE_ID is not set', async () => {
      env.APPLE_BUNDLE_ID = undefined;
      env.APNS_BUNDLE_ID = BUNDLE_ID;

      const identity = await service.verifyIdentityToken(
        appleToken(),
        RAW_NONCE,
      );

      expect(identity.clientId).toBe(BUNDLE_ID);
    });

    it('reads a token without an email as having none', async () => {
      const identity = await service.verifyIdentityToken(
        appleToken({ email: undefined }),
        RAW_NONCE,
      );

      expect(identity.email).toBeNull();
    });

    it.each([
      ['another issuer', { iss: 'https://accounts.google.com' }],
      ['another audience', { aud: 'com.someone.else' }],
      ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }],
      ['a nonce for another request', { nonce: 'f'.repeat(64) }],
      ['no nonce', { nonce: undefined }],
    ])('refuses %s', async (_label, claims) => {
      await expect(
        service.verifyIdentityToken(appleToken(claims), RAW_NONCE),
      ).rejects.toBeInstanceOf(AppleTokenError);
    });

    it('refuses the raw nonce itself in the token (Apple must get the hash)', async () => {
      await expect(
        service.verifyIdentityToken(
          appleToken({ nonce: RAW_NONCE }),
          RAW_NONCE,
        ),
      ).rejects.toBeInstanceOf(AppleTokenError);
    });

    it("refuses a token signed with a key that is not Apple's", async () => {
      const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });

      await expect(
        service.verifyIdentityToken(
          appleToken({}, { key: stranger.privateKey }),
          RAW_NONCE,
        ),
      ).rejects.toBeInstanceOf(AppleTokenError);
    });

    it('refuses a token signed with a shared secret', async () => {
      const forged = jwt.sign(
        { iss: APPLE_ISSUER, aud: BUNDLE_ID, sub: 'x', nonce: HASHED_NONCE },
        'secret',
        { algorithm: 'HS256', keyid: APPLE_KID },
      );

      await expect(
        service.verifyIdentityToken(forged, RAW_NONCE),
      ).rejects.toBeInstanceOf(AppleTokenError);
    });

    it('refuses everything when no Apple client id is configured', async () => {
      env.APPLE_BUNDLE_ID = undefined;
      env.APPLE_SERVICES_ID = undefined;

      expect(service.isAvailable).toBe(false);
      await expect(
        service.verifyIdentityToken(appleToken(), RAW_NONCE),
      ).rejects.toBeInstanceOf(AppleTokenError);
    });

    it("fetches Apple's keys once and reuses them", async () => {
      await service.verifyIdentityToken(appleToken(), RAW_NONCE);
      await service.verifyIdentityToken(appleToken(), RAW_NONCE);

      expect(keyFetches()).toBe(1);
    });

    it('fetches again for a key it lacks, but at most once a minute', async () => {
      await service.verifyIdentityToken(appleToken(), RAW_NONCE);

      // Apple rotated: the next token names a key the cached set lacks.
      const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 });
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60 * 1000);
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(jwks('new-kid', rotated.publicKey))),
      );
      await expect(
        service.verifyIdentityToken(
          appleToken({}, { kid: 'new-kid', key: rotated.privateKey }),
          RAW_NONCE,
        ),
      ).resolves.toMatchObject({ sub: '001234.abcdef.1234' });
      expect(keyFetches()).toBe(2);

      // A made-up key id right after does not send another request.
      await expect(
        service.verifyIdentityToken(
          appleToken({}, { kid: 'made-up' }),
          RAW_NONCE,
        ),
      ).rejects.toBeInstanceOf(AppleTokenError);
      expect(keyFetches()).toBe(2);
    });

    it("keeps answering from the cached keys when Apple's key list cannot be fetched", async () => {
      await service.verifyIdentityToken(appleToken(), RAW_NONCE);
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
      fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));

      await expect(
        service.verifyIdentityToken(appleToken(), RAW_NONCE),
      ).resolves.toMatchObject({ clientId: BUNDLE_ID });
    });
  });

  describe('clientSecret', () => {
    it('is an ES256 JWT from our team, for the client it speaks for', () => {
      const secret = service.clientSecret(SERVICES_ID) as string;

      const decoded = jwt.decode(secret, { complete: true });
      expect(decoded?.header).toMatchObject({
        alg: 'ES256',
        kid: 'KEY1234567',
      });
      const claims = jwt.verify(secret, ourKey.publicKey, {
        algorithms: ['ES256'],
      }) as jwt.JwtPayload;
      expect(claims).toMatchObject({
        iss: 'TEAM123456',
        aud: APPLE_ISSUER,
        sub: SERVICES_ID,
      });
      expect(
        (claims.exp as number) - (claims.iat as number),
      ).toBeLessThanOrEqual(300);
    });

    it('takes the team from APNS_TEAM_ID when APPLE_TEAM_ID is not set', () => {
      env.APPLE_TEAM_ID = undefined;
      env.APNS_TEAM_ID = 'APNSTEAM12';

      const claims = jwt.decode(
        service.clientSecret(BUNDLE_ID) as string,
      ) as jwt.JwtPayload;

      expect(claims.iss).toBe('APNSTEAM12');
    });

    it('is null without the key', () => {
      env.APPLE_PRIVATE_KEY = undefined;

      expect(service.clientSecret(BUNDLE_ID)).toBeNull();
      expect(service.canCallApple).toBe(false);
    });
  });

  describe('exchangeCode', () => {
    const sub = '001234.abcdef.1234';

    function answerToken(body: unknown, status = 200) {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(body, status)),
      );
    }

    function sentForm(): URLSearchParams {
      const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
      return init.body as URLSearchParams;
    }

    it('trades an iPhone code without a redirect URI and returns the refresh token', async () => {
      answerToken({
        refresh_token: 'r-token',
        id_token: jwt.sign({ sub }, 'x'),
      });

      const result = await service.exchangeCode('code-1', {
        sub,
        clientId: BUNDLE_ID,
      });

      expect(result).toEqual({ status: 'ok', refreshToken: 'r-token' });
      const [url] = fetchMock.mock.calls.at(-1) as [string];
      expect(url).toBe('https://appleid.apple.com/auth/token');
      const form = sentForm();
      expect(form.get('client_id')).toBe(BUNDLE_ID);
      expect(form.get('code')).toBe('code-1');
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('client_secret')).toBeTruthy();
      expect(form.has('redirect_uri')).toBe(false);
    });

    it("trades a web code with the popup's return URL", async () => {
      answerToken({
        refresh_token: 'r-token',
        id_token: jwt.sign({ sub }, 'x'),
      });

      await service.exchangeCode('code-1', { sub, clientId: SERVICES_ID });

      expect(sentForm().get('redirect_uri')).toBe(WEB_REDIRECT);
    });

    it('does not keep a token Apple issued to someone else', async () => {
      answerToken({
        refresh_token: 'r-token',
        id_token: jwt.sign({ sub: 'other' }, 'x'),
      });

      const result = await service.exchangeCode('code-1', {
        sub,
        clientId: BUNDLE_ID,
      });

      expect(result.status).toBe('failed');
    });

    it("reports Apple's refusal of a used or expired code", async () => {
      answerToken({ error: 'invalid_grant' }, 400);

      const result = await service.exchangeCode('code-1', {
        sub,
        clientId: BUNDLE_ID,
      });

      expect(result).toEqual({ status: 'failed', reason: 'invalid_grant' });
    });

    it('reports a network failure instead of throwing', async () => {
      fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));

      const result = await service.exchangeCode('code-1', {
        sub,
        clientId: BUNDLE_ID,
      });

      expect(result.status).toBe('failed');
    });

    it('skips without the key, asking Apple nothing', async () => {
      env.APPLE_KEY_ID = undefined;

      const result = await service.exchangeCode('code-1', {
        sub,
        clientId: BUNDLE_ID,
      });

      expect(result.status).toBe('skipped');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('posts the refresh token for the client it was issued to', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );

      await service.revoke('r-token', SERVICES_ID);

      const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
      expect(url).toBe('https://appleid.apple.com/auth/revoke');
      const form = init.body as URLSearchParams;
      expect(form.get('client_id')).toBe(SERVICES_ID);
      expect(form.get('token')).toBe('r-token');
      expect(form.get('token_type_hint')).toBe('refresh_token');
    });

    it('throws when Apple refuses', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse({ error: 'invalid_client' }, 400)),
      );

      await expect(service.revoke('r-token', BUNDLE_ID)).rejects.toThrow();
    });
  });
});
