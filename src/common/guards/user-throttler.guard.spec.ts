import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';

import { UserThrottlerGuard } from './user-throttler.guard';

describe('UserThrottlerGuard', () => {
  const jwt = { verify: jest.fn() } as unknown as JwtService & {
    verify: jest.Mock;
  };
  const guard = new UserThrottlerGuard(
    [{ name: 'default', ttl: 60_000, limit: 300 }] as ThrottlerModuleOptions,
    {} as ThrottlerStorage,
    new Reflector(),
    jwt,
  );
  const tracker = (req: {
    headers?: { authorization?: string };
    ip?: string;
  }) =>
    (
      guard as unknown as { getTracker(r: unknown): Promise<string> }
    ).getTracker(req);

  beforeEach(() => jwt.verify.mockReset());

  it('keys a verified bearer token by its user id', async () => {
    jwt.verify.mockReturnValueOnce({ sub: 'u-1' });
    await expect(
      tracker({ headers: { authorization: 'Bearer good' }, ip: '10.0.0.1' }),
    ).resolves.toBe('user:u-1');
    expect(jwt.verify).toHaveBeenCalledWith('good');
  });

  it('falls back to the address when the token does not verify', async () => {
    jwt.verify.mockImplementationOnce(() => {
      throw new Error('jwt expired');
    });
    await expect(
      tracker({ headers: { authorization: 'Bearer stale' }, ip: '10.0.0.1' }),
    ).resolves.toBe('10.0.0.1');
  });

  it('keys anonymous requests by the address', async () => {
    await expect(tracker({ ip: '10.0.0.2' })).resolves.toBe('10.0.0.2');
    expect(jwt.verify).not.toHaveBeenCalled();
  });
});
