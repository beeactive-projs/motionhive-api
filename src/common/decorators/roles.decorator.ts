import { SetMetadata } from '@nestjs/common';

/**
 * Roles Decorator
 *
 * Usage:
 * @Roles('INSTRUCTOR', 'ADMIN')
 *
 * User needs ANY of these roles to access the route
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
