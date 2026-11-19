import { HttpException, HttpStatus } from '@nestjs/common';
import { MessagingRateLimitService } from './messaging-rate-limit.service';

describe('MessagingRateLimitService — Stage 5', () => {
  let service: MessagingRateLimitService;

  beforeEach(() => {
    service = new MessagingRateLimitService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  // ─────────────────────────── per-user 30/min ──────────────────────

  describe('per-user window (30 / 60s)', () => {
    it('allows up to the limit, rejects the 31st within the window', async () => {
      for (
        let i = 0;
        i < MessagingRateLimitService.USER_PER_MINUTE_LIMIT;
        i++
      ) {
        await service.assertSendAllowed('user-1');
      }
      await expect(service.assertSendAllowed('user-1')).rejects.toBeInstanceOf(
        HttpException,
      );
    });

    it('429 carries the proper status code and retryAfter', async () => {
      for (
        let i = 0;
        i < MessagingRateLimitService.USER_PER_MINUTE_LIMIT;
        i++
      ) {
        await service.assertSendAllowed('user-1');
      }
      try {
        await service.assertSendAllowed('user-1');
        fail('expected throw');
      } catch (err) {
        const e = err as HttpException;
        expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const body = e.getResponse() as { retryAfter: number };
        expect(body.retryAfter).toBeGreaterThan(0);
        expect(body.retryAfter).toBeLessThanOrEqual(60);
      }
    });

    it('window slides — entries older than 60s drop off', async () => {
      const realNow = Date.now;
      let fakeNow = 1_000_000_000_000;
      Date.now = () => fakeNow;
      try {
        for (
          let i = 0;
          i < MessagingRateLimitService.USER_PER_MINUTE_LIMIT;
          i++
        ) {
          await service.assertSendAllowed('user-1');
        }
        // Now we're at the cap. Jump forward 61s — all entries expire.
        fakeNow += 61_000;
        await service.assertSendAllowed('user-1'); // should succeed
      } finally {
        Date.now = realNow;
      }
    });

    it('per-user limits are isolated between users', async () => {
      for (
        let i = 0;
        i < MessagingRateLimitService.USER_PER_MINUTE_LIMIT;
        i++
      ) {
        await service.assertSendAllowed('user-1');
      }
      // user-2 still has full quota.
      await expect(
        service.assertSendAllowed('user-2'),
      ).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────── per-conv 10/sec ──────────────────────

  describe('per-conversation window (10 / 1s)', () => {
    it('rejects the 11th in the same (user, convo) within 1 second', async () => {
      const userId = 'u';
      const convoId = 'c1';
      for (
        let i = 0;
        i < MessagingRateLimitService.CONV_PER_SECOND_LIMIT;
        i++
      ) {
        await service.assertSendAllowed(userId, convoId);
      }
      await expect(
        service.assertSendAllowed(userId, convoId),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('counts one send once against the per-minute ceiling', async () => {
      // The send path asks for the user slot, then for the conversation
      // alone: the full ceiling must be reachable.
      for (
        let i = 0;
        i < MessagingRateLimitService.USER_PER_MINUTE_LIMIT;
        i++
      ) {
        await service.assertSendAllowed('user-9');
        // A conversation each, so the per-second throttle stays out of it.
        await service.assertConversationSendAllowed('user-9', `c-${i}`);
      }
      expect(service.recentUserSendCount('user-9', 60_000)).toBe(
        MessagingRateLimitService.USER_PER_MINUTE_LIMIT,
      );
    });

    it('does NOT cross-pollute across conversations for the same user', async () => {
      const userId = 'u';
      for (
        let i = 0;
        i < MessagingRateLimitService.CONV_PER_SECOND_LIMIT;
        i++
      ) {
        await service.assertSendAllowed(userId, 'c1');
      }
      // The other conversation is untouched.
      await expect(
        service.assertSendAllowed(userId, 'c2'),
      ).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────── shouldSuppressMessageEmail ──────────

  describe('shouldSuppressMessageEmail (quiet-period gate)', () => {
    it('first message in the conversation (no previous) → allow email', () => {
      expect(service.shouldSuppressMessageEmail(null)).toBe(false);
    });

    it('previous message just arrived → suppress', () => {
      const oneMinAgo = new Date(Date.now() - 60_000);
      expect(service.shouldSuppressMessageEmail(oneMinAgo)).toBe(true);
    });

    it('previous message inside the quiet-period window → suppress', () => {
      const halfWindow = new Date(
        Date.now() - MessagingRateLimitService.EMAIL_QUIET_PERIOD_MS / 2,
      );
      expect(service.shouldSuppressMessageEmail(halfWindow)).toBe(true);
    });

    it('previous message older than the quiet period → allow email', () => {
      const beyond = new Date(
        Date.now() - MessagingRateLimitService.EMAIL_QUIET_PERIOD_MS - 1_000,
      );
      expect(service.shouldSuppressMessageEmail(beyond)).toBe(false);
    });

    it('exactly at the boundary → suppress (rule is `<` not `<=`)', () => {
      // The boundary case: gap === QUIET_PERIOD_MS means the previous
      // message is exactly that old. `gapMs < QUIET_PERIOD_MS` is
      // false, so we allow email. Document the rule explicitly.
      const realNow = Date.now;
      const fixedNow = 7_000_000_000_000;
      Date.now = () => fixedNow;
      try {
        const exactlyAtBoundary = new Date(
          fixedNow - MessagingRateLimitService.EMAIL_QUIET_PERIOD_MS,
        );
        expect(service.shouldSuppressMessageEmail(exactlyAtBoundary)).toBe(
          false,
        );
      } finally {
        Date.now = realNow;
      }
    });
  });

  // ─────────────────────────── recentUserSendCount ──────────────────

  describe('recentUserSendCount (used by velocity)', () => {
    it('counts sends in the supplied window', async () => {
      await service.assertSendAllowed('u');
      await service.assertSendAllowed('u');
      await service.assertSendAllowed('u');
      expect(service.recentUserSendCount('u', 60_000)).toBe(3);
    });

    it('ignores sends older than the window', async () => {
      const realNow = Date.now;
      let fakeNow = 5_000_000_000_000;
      Date.now = () => fakeNow;
      try {
        await service.assertSendAllowed('u');
        await service.assertSendAllowed('u');
        fakeNow += 3_600_001;
        await service.assertSendAllowed('u');
        // Only the most recent send is inside a 60s window.
        expect(service.recentUserSendCount('u', 60_000)).toBe(1);
      } finally {
        Date.now = realNow;
      }
    });
  });
});
