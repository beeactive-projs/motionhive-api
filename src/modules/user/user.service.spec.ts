import { UserController } from './user.controller';

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

    const result = controller.getProfile(fakeReq) as Record<string, unknown>;

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
