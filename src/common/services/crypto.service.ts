import { Injectable } from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/**
 * Crypto Service
 *
 * Handles cryptographic operations like:
 * - Generating secure random tokens
 * - Hashing tokens for database storage
 * - Comparing tokens
 *
 * Why hash tokens?
 * If your database is breached, attackers can't use the tokens directly.
 * Similar to how we hash passwords!
 *
 * Flow:
 * 1. Generate token: "abc123..."
 * 2. Hash it: "7d8f9e2..."
 * 3. Store hash in DB
 * 4. Send plain token to user (via email)
 * 5. When user provides token, hash it and compare with DB
 */
@Injectable()
export class CryptoService {
  /**
   * Generate a secure random token
   *
   * @param length - Length in bytes (default: 32 = 64 hex characters)
   * @returns Hex-encoded random token
   *
   * Example: generateToken(32) → "a1b2c3d4e5f6..."
   */
  generateToken(length: number = 32): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * Hash a token using SHA-256
   *
   * @param token - The plain token to hash
   * @returns SHA-256 hash of the token
   *
   * Example:
   * hashToken("abc123") → "ba7816bf8f01cfea..."
   * hashToken("abc123") → "ba7816bf8f01cfea..." (same result = deterministic)
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Compare a plain token with a hashed token (timing-safe)
   *
   * Uses crypto.timingSafeEqual() to prevent timing attacks.
   * A timing attack measures how long comparison takes to find
   * which characters match — timingSafeEqual always takes the same time.
   *
   * @param plainToken - The token provided by user
   * @param hashedToken - The hashed token from database
   * @returns True if they match
   *
   * Example:
   * compareToken("abc123", "ba7816...") → true
   * compareToken("abc124", "ba7816...") → false
   */
  compareToken(plainToken: string, hashedToken: string): boolean {
    const hashedInput = this.hashToken(plainToken);

    // Both are SHA-256 hex strings (64 chars), so same length is guaranteed
    const bufferA = Buffer.from(hashedInput, 'hex');
    const bufferB = Buffer.from(hashedToken, 'hex');

    if (bufferA.length !== bufferB.length) {
      return false;
    }

    return timingSafeEqual(bufferA, bufferB);
  }

  /**
   * Generate a token with expiration timestamp
   *
   * @param hoursValid - How many hours the token is valid (default: 1)
   * @returns Object with token and expiration date
   *
   * Example:
   * generateTokenWithExpiry(1) → {
   *   token: "abc123...",
   *   hashedToken: "ba7816...",
   *   expiresAt: Date (1 hour from now)
   * }
   */
  generateTokenWithExpiry(hoursValid: number = 1): {
    token: string;
    hashedToken: string;
    expiresAt: Date;
  } {
    const token = this.generateToken();
    const hashedToken = this.hashToken(token);
    // Expiry is "now + hoursValid", full stop.
    //
    // (We previously subtracted `getTimezoneOffset()` here as a
    // workaround for a problem that turned out not to exist on this
    // stack: Sequelize stores `DataType.DATE` as Postgres TIMESTAMPTZ,
    // which round-trips JS `Date` objects correctly through UTC. The
    // "compensation" actually drifted expiries by 1–3h depending on
    // the server's local TZ + DST, so password-reset / verification
    // links lived longer than advertised. Fixed.)
    const ttlMs = hoursValid * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    return { token, hashedToken, expiresAt };
  }
}
