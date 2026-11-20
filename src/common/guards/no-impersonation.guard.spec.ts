import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthController } from '../../modules/auth/auth.controller';
import { DeviceController } from '../../modules/notification/device.controller';
import { PaymentClientController } from '../../modules/payment/payment-client.controller';
import { PaymentController } from '../../modules/payment/payment.controller';
import {
  ALLOW_WHILE_IMPERSONATING_KEY,
  AllowWhileImpersonating,
  NoImpersonationGuard,
} from './no-impersonation.guard';

class SampleController {}

/** A route handler; the guard only reads its metadata and name. */
function write(): void {}
function harmlessWrite(): void {}
AllowWhileImpersonating()(harmlessWrite);

/** A controller's method, read without binding it. */
function methodOf(controller: { prototype: object }, name: string): object {
  return (controller.prototype as Record<string, object>)[name];
}

function contextFor(
  req: { method: string; user?: { id: string; impersonatedBy?: string } },
  handler: () => void = write,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => SampleController,
  } as unknown as ExecutionContext;
}

describe('NoImpersonationGuard', () => {
  const guard = new NoImpersonationGuard(new Reflector());
  const person = { id: 'user-1' };
  const support = { id: 'user-1', impersonatedBy: 'admin-1' };

  it('lets the person themselves write', () => {
    expect(
      guard.canActivate(contextFor({ method: 'POST', user: person })),
    ).toBe(true);
  });

  it('lets support read while acting as someone', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(guard.canActivate(contextFor({ method, user: support }))).toBe(
        true,
      );
    }
  });

  it('refuses every write support makes while acting as someone', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(() =>
        guard.canActivate(contextFor({ method, user: support })),
      ).toThrow(ForbiddenException);
    }
  });

  it('answers with the catalog sentence', () => {
    try {
      guard.canActivate(contextFor({ method: 'POST', user: support }));
      throw new Error('expected a refusal');
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        messageKey: 'common.notWhileImpersonating',
      });
    }
  });

  it('lets a route marked harmless through', () => {
    expect(
      guard.canActivate(
        contextFor({ method: 'POST', user: support }, harmlessWrite),
      ),
    ).toBe(true);
  });

  it('passes a request with no user (the route has no JWT guard before it)', () => {
    expect(guard.canActivate(contextFor({ method: 'POST' }))).toBe(true);
  });
});

describe('NoImpersonationGuard wiring', () => {
  function guardsOf(target: object): unknown[] {
    return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];
  }

  it('covers every payment write, for coaches and clients', () => {
    expect(guardsOf(PaymentController)).toContain(NoImpersonationGuard);
    expect(guardsOf(PaymentClientController)).toContain(NoImpersonationGuard);
  });

  it('covers device registration and removal', () => {
    expect(guardsOf(DeviceController)).toContain(NoImpersonationGuard);
  });

  it('covers changing the password and signing out everywhere', () => {
    expect(guardsOf(methodOf(AuthController, 'changePassword'))).toContain(
      NoImpersonationGuard,
    );
    expect(guardsOf(methodOf(AuthController, 'logoutAll'))).toContain(
      NoImpersonationGuard,
    );
  });

  it('lets support refresh a coach’s Stripe status, and nothing else in payments', () => {
    const allowed = Object.getOwnPropertyNames(PaymentController.prototype)
      .filter((name) => name !== 'constructor')
      .filter((name) =>
        Reflect.getMetadata(
          ALLOW_WHILE_IMPERSONATING_KEY,
          methodOf(PaymentController, name),
        ),
      );
    expect(allowed).toEqual(['refreshOnboardingStatus']);
  });
});
