import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Every notification is a promise that tapping it goes somewhere useful. This
 * spec keeps that promise honest by resolving every builder's `data.screen`
 * (+ `entityId`) into the URL the clients actually navigate to, and matching
 * it against the routes those apps actually declare.
 *
 * It exists because three separate bugs shipped through the same blind spot:
 *   - `/coaching/payments/:id` was sent a payment id; no such route (404).
 *   - `/coaching/clients/:id` was sent a workout-log id; the route matches but
 *     the page loads a *client*, so it found nothing.
 *   - the mobile deep-link map was built from screens that only appear in test
 *     fixtures, and missed `user/plans` entirely.
 *
 * The route lists below are copied from the two Angular apps (a separate repo).
 * When a route moves there, this fails — which is the point: the notification
 * is the thing that breaks, and it breaks silently otherwise.
 */

/**
 * Web routes, as full paths. `:x` matches any single segment.
 * Source: projects/web/src/app/{app,main,main/instructor,main/instructor/payments,
 * main/messages,main/user}/*.routes.ts
 */
const WEB_ROUTES = `
  home discover exercises messages messages/:id profile profile/invoices/:id
  sessions/discover sessions/my my/sessions sessions/:id sessions/:id/join
  groups groups/:id groups/:id/feed groups/:id/posts groups/:id/members groups/:id/about
  coaching/overview coaching/roster coaching/clients coaching/clients/:id
  coaching/pending-requests coaching/sessions coaching/sessions/calendar
  coaching/sessions/approvals coaching/sessions/templates/:id
  coaching/sessions/:id coaching/sessions/:id/attendance
  coaching/exercises coaching/programs coaching/programs/:id
  coaching/payments coaching/invoices/:id coaching/subscriptions/:id
  activity/schedule activity/progress activity/invoices activity/subscriptions
  user/dashboard user/instructors user/sessions user/workouts user/routines/:id
  user/training user/progress user/progress/exercises/:id user/plans user/plans/:id
  user/workout-log/:id user/workout-log/:id/replay user/workouts/:id/complete
  user/sessions/discover user/sessions/:id user/sessions/:id/join
`
  .trim()
  .split(/\s+/);

/**
 * Screens the mobile app can open, and the ones it deliberately cannot.
 * Source: projects/mobile/src/app/main/notifications/deep-link.ts — the two
 * maps there must together cover every screen this file finds.
 */
const MOBILE_ROUTED = [
  'messages',
  'coaching/sessions',
  'coaching/clients',
  'coaching/pending-requests',
  'sessions',
  'user/sessions',
  'coaching/invoices',
  'coaching/payments',
  'profile/invoices',
  'profile',
  'user/workout-log',
];
const MOBILE_NAMED = [
  'groups',
  'user/plans',
  'coaching/exercises',
  'coaching/subscriptions',
];

interface Target {
  module: string;
  builder: string;
  screen: string;
  hasEntityId: boolean;
}

/** Pull every `data: { screen, entityId? }` literal out of the builder files. */
function collectTargets(): Target[] {
  const dir = join(__dirname, '..');
  const targets: Target[] = [];

  for (const moduleName of readdirSync(dir)) {
    const file = join(dir, moduleName, 'notifications.ts');
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const builders = src.matchAll(
      /export function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g,
    );
    for (const [, builder, body] of builders) {
      // Every `screen:` in the body is one possible target — a builder that
      // branches on the recipient's role has two.
      for (const match of body.matchAll(/screen: '([^']*)'/g)) {
        const screen = match[1];
        // Look at the ~120 chars after this screen for its own entityId —
        // enough to stay inside the same object literal.
        const tail = body.slice(match.index ?? 0, (match.index ?? 0) + 120);
        const hasEntityId = /entityId:/.test(tail.split('}')[0] ?? '');
        targets.push({ module: moduleName, builder, screen, hasEntityId });
      }
    }
  }
  return targets;
}

function matchesWebRoute(url: string): boolean {
  const segments = url.split('/').filter(Boolean);
  return WEB_ROUTES.some((route) => {
    const parts = route.split('/').filter(Boolean);
    if (parts.length !== segments.length) return false;
    return parts.every(
      (part, i) => part.startsWith(':') || part === segments[i],
    );
  });
}

const TARGETS = collectTargets();

describe('notification click targets', () => {
  it('finds the builders (guards against the regex silently matching nothing)', () => {
    expect(TARGETS.length).toBeGreaterThan(40);
  });

  it('every target resolves to a real web route', () => {
    const dead = TARGETS.filter((t) => {
      const url = `/${t.screen}${t.hasEntityId ? '/id' : ''}`;
      return !matchesWebRoute(url);
    }).map(
      (t) =>
        `${t.module}.${t.builder} → /${t.screen}${t.hasEntityId ? '/<id>' : ''}`,
    );

    expect(dead).toEqual([]);
  });

  it('every screen is either routed or named on mobile', () => {
    const known = new Set([...MOBILE_ROUTED, ...MOBILE_NAMED]);
    const unmapped = [
      ...new Set(
        TARGETS.filter((t) => !known.has(t.screen)).map((t) => t.screen),
      ),
    ];

    expect(unmapped).toEqual([]);
  });

  it('never maps a screen as both routed and unavailable on mobile', () => {
    const overlap = MOBILE_ROUTED.filter((s) => MOBILE_NAMED.includes(s));
    expect(overlap).toEqual([]);
  });

  // Coaching screens sit behind an instructor guard on both clients. A client
  // sent there gets bounced, and the notification does nothing.
  it('only sends coaching/* to builders named for an instructor', () => {
    const wrong = TARGETS.filter(
      (t) =>
        t.screen.startsWith('coaching/') && !/Instructor|Owner/.test(t.builder),
    ).map((t) => `${t.builder} → ${t.screen}`);

    // clientRequestAccepted / clientRequestDeclined branch on the requester's
    // role and are covered by their own specs.
    const allowed = new Set([
      'clientRequestAccepted → coaching/clients',
      'clientRequestDeclined → coaching/clients',
      'clientRequestReceived → coaching/pending-requests',
    ]);
    expect(wrong.filter((w) => !allowed.has(w))).toEqual([]);
  });

  // The mirror: a client-facing screen must not be the target of a builder
  // that only an instructor receives.
  it('never sends an instructor-only alert to a client-only screen', () => {
    const clientOnly = ['user/', 'profile'];
    const wrong = TARGETS.filter(
      (t) =>
        /ForInstructor$/.test(t.builder) &&
        clientOnly.some((prefix) => t.screen.startsWith(prefix)),
    ).map((t) => `${t.builder} → ${t.screen}`);

    expect(wrong).toEqual([]);
  });
});
