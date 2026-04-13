/**
 * Centralized API Documentation
 *
 * All API documentation is organized by module for easy maintenance.
 * Import the docs you need in your controller.
 *
 * Usage:
 * ```typescript
 * import { AuthDocs } from '@common/docs';
 *
 * @ApiEndpoint(AuthDocs.register)
 * @Post('register')
 * async register(@Body() dto: RegisterDto) {
 *   return this.authService.register(dto);
 * }
 * ```
 */

export * from './standard-responses';
export * from './auth.docs';
export * from './profile.docs';
export * from './group.docs';
export * from './session.docs';
export * from './invitation.docs';
export * from './user.docs';
export * from './payment.docs';
