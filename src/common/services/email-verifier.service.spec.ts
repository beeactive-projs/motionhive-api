import { BadRequestException } from '@nestjs/common';
import { EmailVerifierService } from './email-verifier.service';

/**
 * We exercise the service with an injected disposable-domain fixture and a
 * stub resolveMx, so these tests don't hit the real 5k-entry blocklist or
 * talk to the network.
 */
describe('EmailVerifierService', () => {
  const DISPOSABLE = new Set(['mailinator.com', 'tempmail.io']);

  function makeService(
    resolveMx: (domain: string) => Promise<{ exchange: string }[]>,
  ): EmailVerifierService {
    return EmailVerifierService.forTesting({
      disposableDomains: DISPOSABLE,
      resolveMx,
    });
  }

  const mx = (records: { exchange: string }[]) => () =>
    Promise.resolve(records);
  const mxThrow = (code: string) => () => {
    const err: NodeJS.ErrnoException = new Error(code);
    err.code = code;
    return Promise.reject(err);
  };

  it('passes a Gmail address with normal MX records', async () => {
    const svc = makeService(mx([{ exchange: 'gmail-smtp-in.l.google.com' }]));
    await expect(
      svc.assertDeliverable('alice@gmail.com'),
    ).resolves.toBeUndefined();
  });

  it('rejects a disposable domain with a user-facing message', async () => {
    const svc = makeService(mx([{ exchange: 'mx1.mailinator.com' }]));
    await expect(svc.assertDeliverable('bob@mailinator.com')).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.assertDeliverable('bob@mailinator.com')).rejects.toThrow(
      /temporary email/i,
    );
  });

  it('disposable check is case-insensitive on the domain', async () => {
    const svc = makeService(mx([{ exchange: 'mx.mailinator.com' }]));
    await expect(svc.assertDeliverable('b@MailInator.COM')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a domain with no MX records', async () => {
    const svc = makeService(mx([]));
    await expect(
      svc.assertDeliverable('user@nodomain.example'),
    ).rejects.toThrow(/cannot receive mail/i);
  });

  it('rejects a domain with only a null-MX record (RFC 7505)', async () => {
    // Null MX: priority 0, empty exchange. Treated as "no MX".
    const svc = makeService(mx([{ exchange: '' }]));
    await expect(
      svc.assertDeliverable('user@refuses-mail.test'),
    ).rejects.toThrow(/cannot receive mail/i);
  });

  it('rejects when DNS returns NXDOMAIN / ENOTFOUND', async () => {
    const svc = makeService(mxThrow('ENOTFOUND'));
    await expect(
      svc.assertDeliverable('user@totally-bogus.xyz'),
    ).rejects.toThrow(BadRequestException);
  });

  it('fails OPEN on transient DNS errors (SERVFAIL)', async () => {
    // When our resolver hiccups, we prefer to let the signup through
    // rather than lock real users out. The verification email flow catches
    // truly dead addresses on the next layer.
    const svc = makeService(mxThrow('ESERVFAIL'));
    await expect(
      svc.assertDeliverable('user@flaky-dns.test'),
    ).resolves.toBeUndefined();
  });

  it('caches positive MX results per domain (only calls resolveMx once)', async () => {
    const resolveMx = jest
      .fn<Promise<{ exchange: string }[]>, [string]>()
      .mockResolvedValue([{ exchange: 'mx.example.com' }]);
    const svc = makeService(resolveMx);

    await svc.assertDeliverable('a@example.com');
    await svc.assertDeliverable('b@example.com');
    await svc.assertDeliverable('c@EXAMPLE.com');

    expect(resolveMx).toHaveBeenCalledTimes(1);
  });

  it('caches negative MX results per domain too', async () => {
    const resolveMx = jest
      .fn<Promise<{ exchange: string }[]>, [string]>()
      .mockResolvedValue([]);
    const svc = makeService(resolveMx);

    await expect(svc.assertDeliverable('a@nomx.test')).rejects.toThrow();
    await expect(svc.assertDeliverable('b@nomx.test')).rejects.toThrow();

    expect(resolveMx).toHaveBeenCalledTimes(1);
  });

  it('rejects syntactically broken addresses that slip past the DTO', async () => {
    // DTO @IsEmail() will normally block these, but the service should be
    // defensive — a missing domain should produce a clean 400 rather than a
    // crash deeper in resolveMx.
    const svc = makeService(mx([{ exchange: 'x' }]));
    await expect(svc.assertDeliverable('nodomain@')).rejects.toThrow(
      BadRequestException,
    );
  });
});
