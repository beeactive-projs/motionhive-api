import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RoleService } from '../../modules/role/role.service';

function contextFor(user: unknown, required: string[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === ROLES_KEY ? required : undefined,
    ),
  } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return { reflector, context };
}

describe('RolesGuard', () => {
  const roleService = {
    userHasAnyRole: jest.fn(),
  } as unknown as RoleService & { userHasAnyRole: jest.Mock };

  beforeEach(() => roleService.userHasAnyRole.mockReset());

  it('passes routes without a @Roles() requirement', async () => {
    const { reflector, context } = contextFor({ id: 'u-1' }, undefined);
    await expect(
      new RolesGuard(reflector, roleService).canActivate(context),
    ).resolves.toBe(true);
    expect(roleService.userHasAnyRole).not.toHaveBeenCalled();
  });

  it('uses the roles JwtStrategy attached to the request, without a query', async () => {
    const { reflector, context } = contextFor(
      { id: 'u-1', roles: ['USER', 'INSTRUCTOR'] },
      ['INSTRUCTOR', 'ADMIN'],
    );
    await expect(
      new RolesGuard(reflector, roleService).canActivate(context),
    ).resolves.toBe(true);
    expect(roleService.userHasAnyRole).not.toHaveBeenCalled();
  });

  it('rejects when none of the attached roles match', async () => {
    const { reflector, context } = contextFor({ id: 'u-1', roles: ['USER'] }, [
      'INSTRUCTOR',
    ]);
    await expect(
      new RolesGuard(reflector, roleService).canActivate(context),
    ).rejects.toThrow('Access denied');
    expect(roleService.userHasAnyRole).not.toHaveBeenCalled();
  });

  it('falls back to the database when the principal carries no roles', async () => {
    roleService.userHasAnyRole.mockResolvedValue(true);
    const { reflector, context } = contextFor({ id: 'u-1' }, ['INSTRUCTOR']);
    await expect(
      new RolesGuard(reflector, roleService).canActivate(context),
    ).resolves.toBe(true);
    expect(roleService.userHasAnyRole).toHaveBeenCalledWith('u-1', [
      'INSTRUCTOR',
    ]);
  });

  it('rejects unauthenticated requests', async () => {
    const { reflector, context } = contextFor(undefined, ['INSTRUCTOR']);
    await expect(
      new RolesGuard(reflector, roleService).canActivate(context),
    ).rejects.toThrow('User not authenticated');
  });
});
