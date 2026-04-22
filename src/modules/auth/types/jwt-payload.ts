/**
 * Decoded JWT payload shape.
 *
 * Emitted by AuthService on sign-in (access + refresh tokens) and
 * consumed by `JwtStrategy.validate()` + `AuthService.refreshAccessToken()`.
 * Must stay in sync with every place that calls `jwtService.sign(...)`
 * — if a new claim is added there, add it here too.
 */
export interface JwtPayload {
  /** User id (subject). */
  sub: string;
  /** User email — included so clients can display it without a user fetch. */
  email?: string;
  /** Issued-at (unix seconds). */
  iat?: number;
  /** Expiry (unix seconds). */
  exp?: number;
}
