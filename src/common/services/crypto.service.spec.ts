import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const service = new CryptoService();

  it('generateToken returns a hex string of 2x the requested byte length', () => {
    const token16 = service.generateToken(16);
    const token32 = service.generateToken(32);

    expect(token16).toMatch(/^[0-9a-f]{32}$/);
    expect(token32).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashToken is deterministic for the same input', () => {
    const a = service.hashToken('correct horse battery staple');
    const b = service.hashToken('correct horse battery staple');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different inputs produce different hashes', () => {
    const a = service.hashToken('one');
    const b = service.hashToken('two');
    expect(a).not.toBe(b);
  });

  it('generateTokenWithExpiry sets expiresAt exactly hoursValid in the future', () => {
    // Pin time so the assertion is deterministic regardless of CI clock
    // skew. The previous implementation drifted expiry by the local
    // timezone offset; this guards against that regression for good.
    jest.useFakeTimers().setSystemTime(new Date('2026-04-25T12:00:00.000Z'));
    try {
      const out24 = service.generateTokenWithExpiry(24);
      expect(out24.expiresAt.toISOString()).toBe('2026-04-26T12:00:00.000Z');

      const out1 = service.generateTokenWithExpiry(1);
      expect(out1.expiresAt.toISOString()).toBe('2026-04-25T13:00:00.000Z');

      // Token + hash relationship is intact.
      expect(out24.token).toMatch(/^[0-9a-f]{64}$/);
      expect(out24.hashedToken).toBe(service.hashToken(out24.token));
    } finally {
      jest.useRealTimers();
    }
  });
  describe('encrypt / decrypt', () => {
    const key = Buffer.alloc(32, 7);

    it('reads back what it encrypted, and never encrypts the same way twice', () => {
      const first = service.encrypt('apple-refresh-token', key);
      const second = service.encrypt('apple-refresh-token', key);

      expect(first).not.toBe(second);
      expect(first).toMatch(/^v1\./);
      expect(first).not.toContain('apple-refresh-token');
      expect(service.decrypt(first, key)).toBe('apple-refresh-token');
      expect(service.decrypt(second, key)).toBe('apple-refresh-token');
    });

    it('refuses a value that was changed', () => {
      const parts = service.encrypt('apple-refresh-token', key).split('.');
      const body = Buffer.from(parts[3], 'base64url');
      body[0] = body[0] ^ 1;
      parts[3] = body.toString('base64url');

      expect(() => service.decrypt(parts.join('.'), key)).toThrow();
    });

    it('refuses another key, and text that is not an encrypted value', () => {
      const sealed = service.encrypt('apple-refresh-token', key);

      expect(() => service.decrypt(sealed, Buffer.alloc(32, 8))).toThrow();
      expect(() => service.decrypt('plain text', key)).toThrow();
    });

    it('reads a base64 key only when it is 32 bytes', () => {
      expect(service.parseKey(key.toString('base64'))).toEqual(key);
      expect(service.parseKey(Buffer.alloc(16).toString('base64'))).toBeNull();
      expect(service.parseKey(undefined)).toBeNull();
      expect(service.parseKey('')).toBeNull();
    });
  });
});
