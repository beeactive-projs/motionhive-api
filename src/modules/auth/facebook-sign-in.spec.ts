import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';
import { ClientRequest } from '../client/entities/client-request.entity';
import { Invitation } from '../invitation/entities/invitation.entity';
import { AuthService } from './auth.service';
import {
  FacebookIdentityService,
  FacebookTokenError,
} from './facebook/facebook-identity.service';
import type { FacebookIdentity } from './facebook/facebook-identity.service';
import type { FacebookAuthDto } from './dto/facebook-auth.dto';

const APP_ID = '1234567890';
const RAW_NONCE = 'n'.repeat(64);

/** The address a fetch was sent to. */
function hrefOf(input: string | URL | Request): string {
  if (input instanceof Request) {
    return input.url;
  }
  return input.toString();
}

/**
 * POST /auth/facebook: a Graph access token (web, Android) or a Limited
 * Login ID token with its nonce (iPhone), never both. Either way the
 * account is found by the app-scoped Facebook id and never joined by email.
 */
describe('AuthService.registerWithFacebook', () => {
  const tx = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const identity: FacebookIdentity = {
    id: '10220000000000001',
    email: 'ana@example.com',
    givenName: 'Ana',
    familyName: 'Popescu',
    name: 'Ana Popescu',
  };

  let env: Record<string, string | undefined>;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let facebookIdentity: FacebookIdentityService;
  let verifyIdToken: jest.SpyInstance;
  let userService: { findOrCreateFromOAuth: jest.Mock };
  let logger: ReturnType<typeof makeSilentLogger>;
  let service: AuthService;

  let linkClientRequests: jest.SpyInstance;

  const newUser = {
    id: 'u-new',
    email: identity.email,
    firstName: 'Ana',
    lastName: 'Popescu',
    isEmailVerified: false,
  };

  /** Graph's answers for the access-token path. */
  function answerGraph(
    debug: Record<string, unknown>,
    me: Record<string, unknown>,
  ) {
    fetchMock.mockImplementation((input) => {
      const href = hrefOf(input);
      if (href.startsWith('https://graph.facebook.com/debug_token')) {
        return Promise.resolve(Response.json({ data: debug }));
      }
      if (href.startsWith('https://graph.facebook.com/me')) {
        return Promise.resolve(Response.json(me));
      }
      return Promise.reject(new Error(`unexpected fetch ${href}`));
    });
  }

  const validDebug = {
    app_id: APP_ID,
    is_valid: true,
    user_id: identity.id,
  };
  const me = {
    id: identity.id,
    email: 'ana@example.com',
    first_name: 'Ana',
    last_name: 'Popescu',
  };

  /** The OAuth profile the sign-in looked the account up with. */
  function profileUsed(): Record<string, unknown> {
    const [, profile] = userService.findOrCreateFromOAuth.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    return profile;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    linkClientRequests = jest
      .spyOn(ClientRequest, 'update')
      .mockResolvedValue([0] as never);
    jest.spyOn(Invitation, 'count').mockResolvedValue(0 as never);
    fetchMock = jest.spyOn(global, 'fetch');
    fetchMock.mockRejectedValue(new Error('no network in tests'));

    env = { FACEBOOK_APP_ID: APP_ID, FACEBOOK_APP_SECRET: 'app-secret' };
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    logger = makeSilentLogger();
    facebookIdentity = new FacebookIdentityService(config, makeSilentLogger());
    verifyIdToken = jest
      .spyOn(facebookIdentity, 'verifyIdToken')
      .mockResolvedValue(identity);

    userService = {
      findOrCreateFromOAuth: jest
        .fn()
        .mockResolvedValue({ user: { ...newUser }, isNewUser: true }),
    };

    service = new AuthService(
      { create: jest.fn().mockResolvedValue(undefined) } as never,
      userService as never,
      { sign: jest.fn().mockReturnValue('jwt.signed') } as never,
      {
        assignRoleToUserByName: jest.fn().mockResolvedValue(undefined),
        getUserRoles: jest.fn().mockResolvedValue([{ name: 'USER' }]),
      } as never,
      undefined as never,
      { linkGuestToUser: jest.fn().mockResolvedValue(undefined) } as never,
      { get: () => undefined } as never,
      { transaction: jest.fn().mockResolvedValue(tx) } as never,
      undefined as never,
      { hashToken: (t: string) => `hashed:${t}` } as never,
      undefined as never,
      { assertSignInAllowed: jest.fn().mockResolvedValue(undefined) } as never,
      undefined as never,
      undefined as never,
      facebookIdentity,
      logger,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('with a Limited Login ID token (iPhone)', () => {
    const dto: FacebookAuthDto = {
      idToken: 'limited.id.token',
      rawNonce: RAW_NONCE,
      language: 'ro',
    };

    it('checks the token with the raw nonce and signs in by the app-scoped id', async () => {
      const result = await service.registerWithFacebook(dto);

      expect(verifyIdToken).toHaveBeenCalledWith('limited.id.token', RAW_NONCE);
      expect(userService.findOrCreateFromOAuth).toHaveBeenCalledWith(
        'FACEBOOK',
        {
          providerUserId: identity.id,
          email: 'ana@example.com',
          emailVerified: false,
          firstName: 'Ana',
          lastName: 'Popescu',
          language: 'ro',
        },
        tx,
      );
      expect(tx.commit).toHaveBeenCalled();
      expect(result.accessToken).toBe('jwt.signed');
    });

    it('links nothing sent to the email: Facebook never vouches for it', async () => {
      await service.registerWithFacebook(dto);

      // A new account whose address nobody proved gets none of the
      // invitations or bills sent to that address.
      expect(linkClientRequests).not.toHaveBeenCalled();
    });

    it('makes no Graph call', async () => {
      await service.registerWithFacebook(dto);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('works without the app secret, which only access tokens need', async () => {
      env.FACEBOOK_APP_SECRET = undefined;

      await expect(service.registerWithFacebook(dto)).resolves.toMatchObject({
        accessToken: 'jwt.signed',
      });
    });

    it('splits the full name when the parts are missing', async () => {
      verifyIdToken.mockResolvedValue({
        ...identity,
        givenName: null,
        familyName: null,
        name: 'Ana Maria Popescu',
      });

      await service.registerWithFacebook(dto);

      expect(profileUsed()).toMatchObject({
        firstName: 'Ana Maria',
        lastName: 'Popescu',
      });
    });

    it('names an account with no shared name like the other providers do', async () => {
      verifyIdToken.mockResolvedValue({
        ...identity,
        givenName: null,
        familyName: null,
        name: null,
      });

      await service.registerWithFacebook(dto);

      expect(profileUsed()).toMatchObject({ firstName: 'User', lastName: '' });
    });

    it('refuses a token that fails a check, logging why but not the token', async () => {
      verifyIdToken.mockRejectedValue(new FacebookTokenError('Nonce mismatch'));

      const attempt = service.registerWithFacebook(dto);

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(attempt).rejects.toMatchObject({
        response: {
          messageKey: 'auth.providerSignInFailed',
          messageParams: { provider: 'Facebook' },
        },
      });
      const logged = JSON.stringify(logger.warn.mock.calls);
      expect(logged).toContain('Nonce mismatch');
      expect(logged).not.toContain('limited.id.token');
      expect(userService.findOrCreateFromOAuth).not.toHaveBeenCalled();
    });

    it('refuses a sign-in that shared no email', async () => {
      verifyIdToken.mockResolvedValue({ ...identity, email: null });

      const attempt = service.registerWithFacebook(dto);

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toMatchObject({
        response: { messageKey: 'auth.providerNoEmail' },
      });
    });

    it('says Facebook is unavailable without an app id', async () => {
      env.FACEBOOK_APP_ID = undefined;

      await expect(service.registerWithFacebook(dto)).rejects.toMatchObject({
        response: { messageKey: 'auth.providerUnavailable' },
      });
      expect(verifyIdToken).not.toHaveBeenCalled();
    });
  });

  describe('with a Graph access token (web, Android)', () => {
    const dto: FacebookAuthDto = { accessToken: 'EAAG-token' };

    it('signs in by the id debug_token and /me agree on', async () => {
      answerGraph(validDebug, me);

      const result = await service.registerWithFacebook(dto);

      expect(verifyIdToken).not.toHaveBeenCalled();
      expect(profileUsed()).toEqual({
        providerUserId: identity.id,
        email: 'ana@example.com',
        emailVerified: false,
        firstName: 'Ana',
        lastName: 'Popescu',
        language: undefined,
      });
      expect(result.accessToken).toBe('jwt.signed');
    });

    it('refuses a token minted for another app', async () => {
      answerGraph({ ...validDebug, app_id: '999999' }, me);

      const attempt = service.registerWithFacebook(dto);

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(attempt).rejects.toMatchObject({
        response: { messageKey: 'auth.providerSignInFailed' },
      });
      // Nothing is read about the person once the app does not match.
      const meCalls = fetchMock.mock.calls.filter(([input]) =>
        hrefOf(input).startsWith('https://graph.facebook.com/me'),
      );
      expect(meCalls).toEqual([]);
      expect(userService.findOrCreateFromOAuth).not.toHaveBeenCalled();
    });

    it('refuses when /me names another user than debug_token', async () => {
      answerGraph(validDebug, { ...me, id: '10220000000000002' });

      await expect(service.registerWithFacebook(dto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(userService.findOrCreateFromOAuth).not.toHaveBeenCalled();
    });

    it('refuses a token debug_token calls invalid', async () => {
      answerGraph({ ...validDebug, is_valid: false }, me);

      await expect(service.registerWithFacebook(dto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('says Facebook is unavailable without the app secret', async () => {
      env.FACEBOOK_APP_SECRET = undefined;

      await expect(service.registerWithFacebook(dto)).rejects.toMatchObject({
        response: { messageKey: 'auth.providerUnavailable' },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a sign-in that shared no email', async () => {
      answerGraph(validDebug, { ...me, email: undefined });

      await expect(service.registerWithFacebook(dto)).rejects.toMatchObject({
        response: { messageKey: 'auth.providerNoEmail' },
      });
    });
  });

  describe('a body that is not one of the two shapes', () => {
    it.each<[string, FacebookAuthDto]>([
      ['no token at all', {}],
      [
        'both tokens',
        { accessToken: 'EAAG-token', idToken: 'id', rawNonce: RAW_NONCE },
      ],
      ['an ID token without its nonce', { idToken: 'id' }],
      [
        'an access token with a nonce',
        { accessToken: 'EAAG-token', rawNonce: RAW_NONCE },
      ],
    ])('refuses %s before asking Facebook anything', async (_label, body) => {
      const attempt = service.registerWithFacebook(body);

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toMatchObject({
        response: { messageKey: 'auth.facebookTokenChoice' },
      });
      expect(verifyIdToken).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
