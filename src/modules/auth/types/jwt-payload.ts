/**
 * What a token is FOR, carried as the `typ` claim.
 *
 * Absent on a normal access or refresh token, so every token minted before
 * this existed validates exactly as it did. Present only on the narrow,
 * short-lived kinds — which every strategy that is not their audience must
 * refuse, or the narrowing buys nothing.
 */
export const TokenTypes = {
  /** Opens `GET /messaging/stream` and nothing else. See the ticket service. */
  STREAM_TICKET: 'messaging-stream',
} as const;

export type TokenType = (typeof TokenTypes)[keyof typeof TokenTypes];

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
  /**
   * Set ONLY on admin impersonation tokens: the id of the admin acting
   * as this user (see `AuthService.mintImpersonationToken`). Absent on
   * every normal access/refresh token, so reading it is purely additive
   * — existing tokens validate exactly as before.
   */
  act_as?: string;
  /**
   * Narrow-purpose marker — see `TokenTypes`. Absent on a normal access or
   * refresh token, which is what makes reading it purely additive.
   */
  typ?: string;
  /** Issued-at (unix seconds). */
  iat?: number;
  /** Expiry (unix seconds). */
  exp?: number;
}
