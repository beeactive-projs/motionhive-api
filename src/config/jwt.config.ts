import { ConfigService } from '@nestjs/config';
import { JwtModuleOptions } from '@nestjs/jwt';

/**
 * JWT Configuration Factory
 *
 * JWT (JSON Web Token) is used for authentication.
 * Structure: Header.Payload.Signature
 *
 * How it works:
 * 1. User logs in → Server creates JWT with user info
 * 2. JWT is signed with secret → Can't be tampered with
 * 3. User sends JWT with each request → Server validates it
 * 4. If valid → Request proceeds, if not → 401 Unauthorized
 *
 * ✅ SECURITY FIX: No fallback secret!
 * If JWT_SECRET is missing, app will crash on startup (via env validation)
 */
export const getJwtConfig = (
  configService: ConfigService,
): JwtModuleOptions => {
  const secret = configService.get<string>('JWT_SECRET');

  // This should never happen due to env validation, but double-check
  if (!secret) {
    throw new Error('JWT_SECRET is required! Please set it in your .env file.');
  }

  return {
    secret,
    signOptions: {
      // ✅ SECURITY FIX: Reduced from 7d to 2h
      // Short-lived tokens are more secure (less time for attackers to use stolen tokens)
      // We'll implement refresh tokens to maintain good UX
      expiresIn: configService.get('JWT_EXPIRES_IN') || '2h',
    },
  } as JwtModuleOptions;
};
