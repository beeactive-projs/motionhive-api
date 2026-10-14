import { Op } from 'sequelize';

import { UserController } from './user.controller';
import { UserService } from './user.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';

// Smoke test for the /users/me response shape.
//
// Historically this has been a CVE-adjacent leak magnet: whenever the
// controller was refactored to `return req.user` directly, passwordHash
// and reset tokens shipped to the client. This spec locks down the
// whitelist projection so that regression can't happen silently.
describe('UserController getProfile (/users/me)', () => {
  it('never leaks passwordHash, reset tokens, or verification tokens', () => {
    const controller = new UserController(undefined as never);

    const fakeReq = {
      user: {
        id: 'u-1',
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: null,
        avatarId: null,
        language: 'en',
        timezone: 'UTC',
        isActive: true,
        isEmailVerified: true,
        roles: ['USER'],
        createdAt: new Date('2026-01-01'),
        // Fields that MUST NOT appear in the response:
        passwordHash: '$2b$12$HASH',
        passwordResetToken: 'reset-xyz',
        passwordResetExpires: new Date(),
        emailVerificationToken: 'verify-xyz',
        emailVerificationExpires: new Date(),
        failedLoginAttempts: 3,
        lockedUntil: null,
      },
    };

    const result = controller.getProfile(
      fakeReq as unknown as AuthenticatedRequest,
    );

    expect(result).toHaveProperty('id', 'u-1');
    expect(result).toHaveProperty('email', 'jane@example.com');

    const forbidden = [
      'passwordHash',
      'password',
      'passwordResetToken',
      'passwordResetExpires',
      'emailVerificationToken',
      'emailVerificationExpires',
      'failedLoginAttempts',
    ];
    for (const key of forbidden) {
      expect(result).not.toHaveProperty(key);
    }
  });
});

describe('UserService.searchUsers', () => {
  type Clause = Record<string | symbol, unknown>;

  function setup() {
    const findAll = jest.fn().mockResolvedValue([
      {
        id: 'u-2',
        email: 'elena@example.com',
        firstName: 'Elena',
        lastName: 'Dumitru',
        avatarUrl: null,
        handle: 'elena',
      },
    ]);
    const service = new UserService(
      { findAll } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const match = (): Clause => {
      const [options] = findAll.mock.calls[0] as [{ where: Clause }];
      return (options.where[Op.and] as Clause[])[0];
    };
    return { service, findAll, match };
  }

  function columnsOf(tokenClause: Clause): string[] {
    return (tokenClause[Op.or] as Clause[]).flatMap((c) => Object.keys(c));
  }

  it('never returns an email, nor asks the database for one', async () => {
    const { service, findAll } = setup();

    const [row] = await service.searchUsers({ q: 'elena' });

    expect(row).not.toHaveProperty('email');
    const [options] = findAll.mock.calls[0] as [{ attributes: string[] }];
    expect(options.attributes).not.toContain('email');
  });

  it('does not match part of an email address', async () => {
    // "elena.d" must not confirm whose address starts that way.
    const { service, match } = setup();

    await service.searchUsers({ q: 'elena.d' });

    const tokens = match()[Op.and] as Clause[];
    expect(columnsOf(tokens[0])).not.toContain('email');
  });

  it('finds the owner of a whole email address', async () => {
    const { service, match } = setup();

    await service.searchUsers({ q: 'Elena@Example.com' });

    const either = match()[Op.or] as Clause[];
    expect(either[0]).toEqual({ email: 'elena@example.com' });
  });

  it('reads "@handle" as the handle and matches wildcards literally', async () => {
    const { service, match } = setup();

    await service.searchUsers({ q: '@el_na' });

    const tokens = match()[Op.and] as Clause[];
    const firstName = (tokens[0][Op.or] as Clause[])[0];
    expect(firstName).toEqual({ firstName: { [Op.iLike]: '%el\\_na%' } });
  });
});
