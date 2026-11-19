import { Op } from 'sequelize';

import { UserController } from './user.controller';
import { UserService } from './user.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { foldedLike } from '../../../test/helpers/folded-search';

// Smoke test for the /users/me response shape.
//
// Historically this has been a CVE-adjacent leak magnet: whenever the
// controller was refactored to `return req.user` directly, passwordHash
// and reset tokens shipped to the client. This spec locks down the
// whitelist projection so that regression can't happen silently.
describe('UserController getProfile (/users/me)', () => {
  const onboarding = {
    flowVersion: 1,
    role: null,
    flow: ['ROLE', 'INTERESTS', 'LEVEL'],
  };

  function setup(user: Record<string, unknown>) {
    const onboardingStateService = {
      read: jest.fn().mockResolvedValue(onboarding),
    };
    const service = new UserService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      onboardingStateService as never,
      undefined as never,
    );
    const controller = new UserController(service);
    const req = { user } as unknown as AuthenticatedRequest;
    return { controller, req, onboardingStateService };
  }

  const jane = {
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
    fitnessLevel: 'BEGINNER',
    createdAt: new Date('2026-01-01'),
    // Fields that MUST NOT appear in the response:
    passwordHash: '$2b$12$HASH',
    passwordResetToken: 'reset-xyz',
    passwordResetExpires: new Date(),
    emailVerificationToken: 'verify-xyz',
    emailVerificationExpires: new Date(),
    failedLoginAttempts: 3,
    lockedUntil: null,
  };

  it('never leaks passwordHash, reset tokens, or verification tokens', async () => {
    const { controller, req } = setup(jane);

    const result = await controller.getProfile(req);

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

  it('carries the welcome flow state, read for the signed-in person', async () => {
    const { controller, req, onboardingStateService } = setup(jane);

    const result = await controller.getProfile(req);

    expect(result.onboarding).toEqual(onboarding);
    expect(onboardingStateService.read).toHaveBeenCalledWith({
      userId: 'u-1',
      isCoach: false,
      fitnessLevel: 'BEGINNER',
    });
  });

  it("reads a coach's state as a coach's, from the roles on the request", async () => {
    const { controller, req, onboardingStateService } = setup({
      ...jane,
      roles: ['USER', 'INSTRUCTOR'],
      fitnessLevel: null,
    });

    await controller.getProfile(req);

    expect(onboardingStateService.read).toHaveBeenCalledWith({
      userId: 'u-1',
      isCoach: true,
      fitnessLevel: null,
    });
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
    // Only `escape` is read: the folded search quotes its term with it.
    const sequelize = {
      escape: (value: string) => `'${value.replace(/'/g, "''")}'`,
    };
    const service = new UserService(
      { findAll } as never,
      undefined as never,
      sequelize as never,
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

  /** The SQL of each column a token is matched against (folded literals). */
  function sqlOf(tokenClause: Clause): string[] {
    return (tokenClause[Op.or] as Array<{ val: string }>).map((c) => c.val);
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
    expect(sqlOf(tokens[0]).join(' ')).not.toContain('email');
  });

  it('matches the full name and the handle blind to accents', async () => {
    const { service, match } = setup();

    await service.searchUsers({ q: 'Ștefan' });

    const tokens = match()[Op.and] as Clause[];
    expect(sqlOf(tokens[0])).toEqual([
      foldedLike(
        `concat_ws(' ', "User"."first_name", "User"."last_name")`,
        'Stefan',
      ),
      foldedLike('"User"."handle"', 'Stefan'),
    ]);
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
    expect(sqlOf(tokens[0])[1]).toBe(foldedLike('"User"."handle"', 'el_na'));
  });
});
