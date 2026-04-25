import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { DISPOSABLE_EMAIL_DOMAINS } from '../constants/disposable-email-domains';

/**
 * Why this exists
 * ---------------
 * The only way to *know* an email address is real is to send mail to it and
 * wait for a human to click a link (we already do that via the
 * email-verification flow). Everything else is filtering — but cheap filtering
 * catches 90%+ of junk *before* we burn Resend quota and sender reputation
 * sending verification emails to addresses that will never receive them.
 *
 * Two signals, in order:
 *   1. Disposable-domain blocklist (mailinator.com, temp-mail.io, …). Dead
 *      certain rejection, zero false positives on domains whose stated purpose
 *      is throwaway inboxes.
 *   2. DNS MX lookup. A domain with no MX records cannot receive mail, full
 *      stop — RFC 5321 §5.1. If our own DNS resolver is flaky we fail OPEN
 *      (allow the signup) rather than lock users out; the verification email
 *      would still bounce and we'd catch it on the second layer.
 *
 * Scope
 * -----
 * This runs on classic email+password register and on waitlist signup only.
 * OAuth paths are SKIPPED intentionally — Google/Facebook already handed us a
 * pre-verified email tied to an identity. Running MX checks on a Google
 * Workspace domain that somehow shows up on a false-positive disposable list
 * would block a legitimate user's OAuth signup, which is the worst outcome
 * here.
 */

export interface EmailVerifierDeps {
  disposableDomains?: ReadonlySet<string>;
  /** Override only for tests — stubs out Node's DNS. */
  resolveMx?: (domain: string) => Promise<{ exchange: string }[]>;
}

@Injectable()
export class EmailVerifierService {
  private readonly logger = new Logger(EmailVerifierService.name);
  private readonly disposableDomains: ReadonlySet<string>;
  private readonly resolveMx: (
    domain: string,
  ) => Promise<{ exchange: string }[]>;

  // One-hour in-process cache keyed by lowercase domain.
  // 100 signups from the same gmail shouldn't trigger 100 DNS calls.
  private readonly mxCache = new Map<
    string,
    { hasMx: boolean; expiresAt: number }
  >();

  private static readonly CACHE_TTL_MS = 60 * 60 * 1000;
  private static readonly DNS_TIMEOUT_MS = 3_000;

  // NOTE: no constructor parameters on purpose. A typed parameter like
  // `deps: EmailVerifierDeps = {}` confuses Nest's DI — it reflects the
  // parameter, can't resolve the interface, and throws at boot. Tests get
  // overrides via the static `forTesting` factory below.
  constructor() {
    this.disposableDomains = DISPOSABLE_EMAIL_DOMAINS;
    this.resolveMx = (domain) => dns.resolveMx(domain);
  }

  /**
   * Test-only constructor. Bypasses Nest DI so specs can stub the domain set
   * and the DNS resolver without talking to the network.
   */
  static forTesting(deps: EmailVerifierDeps = {}): EmailVerifierService {
    const svc = new EmailVerifierService();
    const overrides: Record<string, unknown> = {};
    if (deps.disposableDomains) {
      overrides.disposableDomains = deps.disposableDomains;
    }
    if (deps.resolveMx) {
      overrides.resolveMx = deps.resolveMx;
    }
    Object.assign(svc, overrides);
    return svc;
  }

  /**
   * Reject the email if we can cheaply prove it cannot receive mail.
   * Throws BadRequestException with a user-facing message on rejection.
   *
   * The DTO layer has already validated RFC syntax via `@IsEmail()`, so we
   * assume `email` is well-formed here.
   */
  async assertDeliverable(email: string): Promise<void> {
    const domain = this.extractDomain(email);
    if (!domain) {
      // Shouldn't happen — DTO validation runs first — but belt-and-braces.
      throw new BadRequestException('Invalid email address.');
    }

    if (this.disposableDomains.has(domain)) {
      this.logger.warn(
        `Rejected signup: ${email} — reason: DISPOSABLE_DOMAIN (${domain})`,
      );
      throw new BadRequestException(
        "We can't accept temporary email addresses. Please use a personal or work email.",
      );
    }

    const hasMx = await this.domainHasMx(domain);
    if (!hasMx) {
      this.logger.warn(`Rejected signup: ${email} — reason: NO_MX (${domain})`);
      throw new BadRequestException(
        'This email address cannot receive mail (the domain has no mail server). Please check for typos.',
      );
    }
  }

  private extractDomain(email: string): string | null {
    const at = email.lastIndexOf('@');
    if (at < 0 || at === email.length - 1) return null;
    return email.slice(at + 1).toLowerCase();
  }

  private async domainHasMx(domain: string): Promise<boolean> {
    const cached = this.mxCache.get(domain);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.hasMx;
    }

    let hasMx: boolean;
    try {
      const records = await this.withTimeout(
        this.resolveMx(domain),
        EmailVerifierService.DNS_TIMEOUT_MS,
      );
      // RFC 7505 "null MX" — priority 0, empty exchange — signals the domain
      // explicitly refuses mail. Treat the same as no records.
      hasMx =
        records.length > 0 &&
        records.some((r) => r.exchange && r.exchange.length > 0);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
        // Authoritative: the domain (or its MX) doesn't exist.
        hasMx = false;
      } else {
        // Timeout / SERVFAIL / transient resolver failure: fail OPEN. Better
        // to let a borderline signup through than block real users when our
        // DNS hiccups.
        this.logger.warn(
          `MX lookup failed for ${domain} (code=${code ?? 'unknown'}); allowing signup.`,
        );
        hasMx = true;
      }
    }

    this.mxCache.set(domain, {
      hasMx,
      expiresAt: now + EmailVerifierService.CACHE_TTL_MS,
    });
    return hasMx;
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err: NodeJS.ErrnoException = new Error(
          `DNS lookup timed out after ${ms}ms`,
        );
        err.code = 'ETIMEDOUT';
        reject(err);
      }, ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
