import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientController } from './client.controller';

/**
 * Route metadata only: who may call what. The handlers forward to the
 * services, which have their own specs.
 */
describe('ClientController access', () => {
  const handler = (name: keyof ClientController) =>
    ClientController.prototype[name] as (...args: unknown[]) => unknown;

  it('lets any signed-in account count its pending requests', () => {
    // A trainee reads `invitations` from it for the "a coach invited you"
    // dot; coach-only, it answered every trainee 403 on every screen.
    const fn = handler('getPendingRequestsCount');

    expect(Reflect.getMetadata(ROLES_KEY, fn)).toBeUndefined();
    const guards = (Reflect.getMetadata(GUARDS_METADATA, fn) ??
      []) as unknown[];
    expect(guards).not.toContain(RolesGuard);
    expect(guards).toHaveLength(1); // the JWT guard
  });

  it('keeps the coach-only reads behind the coach roles', () => {
    for (const name of ['getMyClients', 'getPendingEmailInvites'] as const) {
      const fn = handler(name);
      expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual([
        'INSTRUCTOR',
        'ADMIN',
        'SUPER_ADMIN',
      ]);
      expect(Reflect.getMetadata(GUARDS_METADATA, fn)).toContain(RolesGuard);
    }
  });
});
