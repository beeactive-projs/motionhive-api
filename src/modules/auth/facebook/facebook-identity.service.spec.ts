import { generateKeyPairSync } from 'crypto';
import type { KeyObject } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';
import {
  FACEBOOK_KEYS_URL,
  FacebookIdentityService,
  FacebookTokenError,
} from './facebook-identity.service';

const APP_ID = '1234567890';
const APP_SECRET = 'app-secret';
/** What the app passed to Facebook's login and sends us as `rawNonce`. */
const RAW_NONCE = 'b'.repeat(64);
const FACEBOOK_USER_ID = '10220000000000001';

/** A stand-in for Meta: our own RSA key, published as Meta publishes its keys. */
const meta = generateKeyPairSync('rsa', { modulusLength: 2048 });
const META_KID = 'test-kid';

function jwks(kid: string, publicKey: KeyObject = meta.publicKey) {
  return {
    keys: [
      { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
    ],
  };
}

/** The address a fetch was sent to. */
function hrefOf(input: string | URL | Request): string {
  if (input instanceof Request) {
    return input.url;
  }
  return input.toString();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A Limited Login token as Meta would mint it; `claims` overrides any default. */
function limitedToken(
  claims: Record<string, unknown> = {},
  options: { kid?: string; key?: KeyObject } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  let kid = META_KID;
  if (options.kid) {
    kid = options.kid;
  }
  let key = meta.privateKey;
  if (options.key) {
    key = options.key;
  }
  const payload: Record<string, unknown> = {
    iss: 'https://www.facebook.com',
    aud: APP_ID,
    sub: FACEBOOK_USER_ID,
    iat: now,
    exp: now + 3600,
    jti: 'jti-1',
    nonce: RAW_NONCE,
    email: ' ana@example.com ',
    given_name: 'Ana',
    family_name: 'Popescu',
    name: 'Ana Popescu',
  };
  // An override of `undefined` leaves the claim out of the token.
  for (const [claim, value] of Object.entries(claims)) {
    if (value === undefined) {
      delete payload[claim];
    } else {
      payload[claim] = value;
    }
  }
  return jwt.sign(payload, key, { algorithm: 'RS256', keyid: kid });
}

describe('FacebookIdentityService', () => {
  let env: Record<string, string | undefined>;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let service: FacebookIdentityService;

  beforeEach(() => {
    env = { FACEBOOK_APP_ID: APP_ID, FACEBOOK_APP_SECRET: APP_SECRET };
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    fetchMock = jest.spyOn(global, 'fetch');
    fetchMock.mockImplementation((input) => {
      const href = hrefOf(input);
      if (href === FACEBOOK_KEYS_URL) {
        return Promise.resolve(jsonResponse(jwks(META_KID)));
      }
      return Promise.reject(new Error(`unexpected fetch ${href}`));
    });
    service = new FacebookIdentityService(config, makeSilentLogger());
  });

  afterEach(() => {
    // fetch, and Date.now where a test moved the clock.
    jest.restoreAllMocks();
  });

  const keyFetches = () =>
    fetchMock.mock.calls.filter(
      ([input]) => hrefOf(input) === FACEBOOK_KEYS_URL,
    ).length;

  describe('verifyIdToken', () => {
    it('accepts a Limited Login token and reads who it names', async () => {
      const identity = await service.verifyIdToken(limitedToken(), RAW_NONCE);

      expect(identity).toEqual({
        id: FACEBOOK_USER_ID,
        email: 'ana@example.com',
        givenName: 'Ana',
        familyName: 'Popescu',
        name: 'Ana Popescu',
      });
    });

    it('accepts the limited.facebook.com issuer too', async () => {
      const identity = await service.verifyIdToken(
        limitedToken({ iss: 'https://limited.facebook.com' }),
        RAW_NONCE,
      );

      expect(identity.id).toBe(FACEBOOK_USER_ID);
    });

    it('makes no Graph call: Graph refuses Limited Login tokens', async () => {
      await service.verifyIdToken(limitedToken(), RAW_NONCE);

      const graphCalls = fetchMock.mock.calls.filter(([input]) =>
        hrefOf(input).startsWith('https://graph.facebook.com'),
      );
      expect(graphCalls).toEqual([]);
    });

    it('reads a token without an email as having none (the caller refuses it)', async () => {
      const identity = await service.verifyIdToken(
        limitedToken({ email: undefined }),
        RAW_NONCE,
      );

      expect(identity.email).toBeNull();
    });

    it.each([
      ['another audience', { aud: '999999' }],
      ['another issuer', { iss: 'https://appleid.apple.com' }],
      ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }],
      ['a token with no expiry', { exp: undefined }],
      ['a nonce for another request', { nonce: 'c'.repeat(64) }],
      ['no nonce', { nonce: undefined }],
      ['no subject', { sub: undefined }],
    ])('refuses %s', async (_label, claims) => {
      await expect(
        service.verifyIdToken(limitedToken(claims), RAW_NONCE),
      ).rejects.toBeInstanceOf(FacebookTokenError);
    });

    it("refuses a token signed with a key that is not Meta's", async () => {
      const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });

      await expect(
        service.verifyIdToken(
          limitedToken({}, { key: stranger.privateKey }),
          RAW_NONCE,
        ),
      ).rejects.toBeInstanceOf(FacebookTokenError);
    });

    it('refuses a token signed with a shared secret', async () => {
      const forged = jwt.sign(
        {
          iss: 'https://www.facebook.com',
          aud: APP_ID,
          sub: 'x',
          nonce: RAW_NONCE,
        },
        'secret',
        { algorithm: 'HS256', keyid: META_KID },
      );

      await expect(
        service.verifyIdToken(forged, RAW_NONCE),
      ).rejects.toBeInstanceOf(FacebookTokenError);
    });

    it('refuses everything when no app id is configured', async () => {
      env.FACEBOOK_APP_ID = undefined;

      expect(service.canCheckIdTokens).toBe(false);
      await expect(
        service.verifyIdToken(limitedToken(), RAW_NONCE),
      ).rejects.toBeInstanceOf(FacebookTokenError);
    });

    it('needs only the app id, not the secret', async () => {
      env.FACEBOOK_APP_SECRET = undefined;

      expect(service.canCheckIdTokens).toBe(true);
      expect(service.canCheckAccessTokens).toBe(false);
      await expect(
        service.verifyIdToken(limitedToken(), RAW_NONCE),
      ).resolves.toMatchObject({ id: FACEBOOK_USER_ID });
    });

    it("fetches Meta's keys once and reuses them", async () => {
      await service.verifyIdToken(limitedToken(), RAW_NONCE);
      await service.verifyIdToken(limitedToken(), RAW_NONCE);

      expect(keyFetches()).toBe(1);
    });

    it('fetches once more for a key it lacks, but at most once a minute', async () => {
      await service.verifyIdToken(limitedToken(), RAW_NONCE);

      // Meta rotated: the next token names a key the cached set lacks.
      const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 });
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60 * 1000);
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(jwks('new-kid', rotated.publicKey))),
      );
      await expect(
        service.verifyIdToken(
          limitedToken({}, { kid: 'new-kid', key: rotated.privateKey }),
          RAW_NONCE,
        ),
      ).resolves.toMatchObject({ id: FACEBOOK_USER_ID });
      expect(keyFetches()).toBe(2);

      // A made-up key id right after does not send another request.
      await expect(
        service.verifyIdToken(limitedToken({}, { kid: 'made-up' }), RAW_NONCE),
      ).rejects.toBeInstanceOf(FacebookTokenError);
      expect(keyFetches()).toBe(2);
    });

    it('fetches again once the copy is an hour old', async () => {
      await service.verifyIdToken(limitedToken(), RAW_NONCE);
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 60 * 1000);

      await service.verifyIdToken(limitedToken(), RAW_NONCE);

      expect(keyFetches()).toBe(2);
    });

    it("keeps answering from the cached keys when Meta's key list cannot be fetched", async () => {
      await service.verifyIdToken(limitedToken(), RAW_NONCE);
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60 * 60 * 1000);
      fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));

      await expect(
        service.verifyIdToken(limitedToken(), RAW_NONCE),
      ).resolves.toMatchObject({ id: FACEBOOK_USER_ID });
    });
  });

  describe('verifyAccessToken', () => {
    type Debug = { app_id?: string; is_valid?: boolean; user_id?: string };

    function answerGraph(debug: Debug, me: Record<string, unknown>) {
      fetchMock.mockImplementation((input) => {
        const href = hrefOf(input);
        if (href.startsWith('https://graph.facebook.com/debug_token')) {
          return Promise.resolve(jsonResponse({ data: debug }));
        }
        if (href.startsWith('https://graph.facebook.com/me')) {
          return Promise.resolve(jsonResponse(me));
        }
        return Promise.reject(new Error(`unexpected fetch ${href}`));
      });
    }

    const validDebug: Debug = {
      app_id: APP_ID,
      is_valid: true,
      user_id: FACEBOOK_USER_ID,
    };
    const me = {
      id: FACEBOOK_USER_ID,
      email: 'ana@example.com',
      first_name: 'Ana',
      last_name: 'Popescu',
      name: 'Ana Popescu',
    };

    it('checks the token under our app credentials, then reads /me', async () => {
      answerGraph(validDebug, me);

      const identity = await service.verifyAccessToken('EAAG-token');

      expect(identity).toEqual({
        id: FACEBOOK_USER_ID,
        email: 'ana@example.com',
        givenName: 'Ana',
        familyName: 'Popescu',
        name: 'Ana Popescu',
      });
      const debugUrl = new URL(hrefOf(fetchMock.mock.calls[0][0]));
      expect(debugUrl.pathname).toBe('/debug_token');
      expect(debugUrl.searchParams.get('input_token')).toBe('EAAG-token');
      expect(debugUrl.searchParams.get('access_token')).toBe(
        `${APP_ID}|${APP_SECRET}`,
      );
      const meUrl = new URL(hrefOf(fetchMock.mock.calls[1][0]));
      expect(meUrl.pathname).toBe('/me');
      expect(meUrl.searchParams.get('access_token')).toBe('EAAG-token');
    });

    it.each([
      ['a token debug_token calls invalid', { ...validDebug, is_valid: false }],
      ['a token minted for another app', { ...validDebug, app_id: '999999' }],
      ['a token naming no user', { ...validDebug, user_id: undefined }],
    ])('refuses %s', async (_label, debug) => {
      answerGraph(debug, me);

      await expect(
        service.verifyAccessToken('EAAG-token'),
      ).rejects.toBeInstanceOf(FacebookTokenError);
    });

    it('refuses when /me names another user than debug_token', async () => {
      answerGraph(validDebug, { ...me, id: '10220000000000002' });

      await expect(
        service.verifyAccessToken('EAAG-token'),
      ).rejects.toBeInstanceOf(FacebookTokenError);
    });

    it('refuses when /me answers with an error', async () => {
      answerGraph(validDebug, { error: { message: 'Session expired' } });

      await expect(service.verifyAccessToken('EAAG-token')).rejects.toThrow(
        'Session expired',
      );
    });

    it('turns a network failure into a token error', async () => {
      fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));

      await expect(
        service.verifyAccessToken('EAAG-token'),
      ).rejects.toBeInstanceOf(FacebookTokenError);
    });

    it('turns an answer that is not JSON into a token error', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(new Response('<html>', { status: 502 })),
      );

      await expect(
        service.verifyAccessToken('EAAG-token'),
      ).rejects.toBeInstanceOf(FacebookTokenError);
    });

    it('asks Facebook nothing without the app secret', async () => {
      env.FACEBOOK_APP_SECRET = undefined;

      await expect(
        service.verifyAccessToken('EAAG-token'),
      ).rejects.toBeInstanceOf(FacebookTokenError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
