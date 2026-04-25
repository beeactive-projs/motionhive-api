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
});
