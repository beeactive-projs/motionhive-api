import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

/** AES-256-GCM: a 32 byte key, a fresh 12 byte IV per message, a 16 byte tag. */
const CIPHER = 'aes-256-gcm';
const CIPHER_KEY_BYTES = 32;
const CIPHER_IV_BYTES = 12;
const CIPHER_TAG_BYTES = 16;
/** The format version leading every encrypted value, so a later change can read old ones. */
const CIPHER_VERSION = 'v1';

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

  /**
   * Read a 32 byte encryption key given as base64 (how it sits in an env
   * var). Null when it is missing or not 32 bytes, so callers can treat a
   * bad key like no key.
   */
  parseKey(base64Key: string | undefined | null): Buffer | null {
    if (!base64Key) {
      return null;
    }
    const key = Buffer.from(base64Key.trim(), 'base64');
    if (key.length !== CIPHER_KEY_BYTES) {
      return null;
    }
    return key;
  }

  /**
   * Encrypt a secret we must be able to read back (unlike `hashToken`), such
   * as a provider's refresh token. AES-256-GCM with a fresh IV each time, so
   * the same secret never encrypts to the same text, and the tag makes any
   * change to the stored value fail on decrypt.
   *
   * Returns `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
   */
  encrypt(plaintext: string, key: Buffer): string {
    const iv = randomBytes(CIPHER_IV_BYTES);
    const cipher = createCipheriv(CIPHER, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      CIPHER_VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /**
   * Read back a value from `encrypt`. Throws when the value was changed, was
   * made with another key, or is not in the format.
   */
  decrypt(payload: string, key: Buffer): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
      throw new Error('Not an encrypted value');
    }
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== CIPHER_IV_BYTES || tag.length !== CIPHER_TAG_BYTES) {
      throw new Error('Not an encrypted value');
    }
    const decipher = createDecipheriv(CIPHER, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
