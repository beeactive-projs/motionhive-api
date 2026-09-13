import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

interface ThrottledRequest {
  headers?: { authorization?: string };
  ip?: string;
}

/**
 * Rate-limit buckets keyed by the signed-in user, not the IP address.
 *
 * The stock guard keys on `req.ip`, which for this product is the wrong
 * unit: a coach and their clients on one gym Wi-Fi, a household, or phones
 * behind carrier NAT all share an address, so the limit was per venue
 * rather than per person. A request carrying a bearer token that verifies
 * is counted against that user; anything else (login, public routes, a
 * forged token) still counts against the IP, which is what the strict
 * per-route limits on auth rely on.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {
    super(options, storage, reflector);
  }

  protected override getTracker(req: ThrottledRequest): Promise<string> {
    const header = req.headers?.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      try {
        const { sub } = this.jwtService.verify<{ sub?: string }>(token);
        if (sub) return Promise.resolve(`user:${sub}`);
      } catch {
        // Expired or forged: fall through to the address.
      }
    }
    return Promise.resolve(req.ip ?? 'unknown');
  }
}
