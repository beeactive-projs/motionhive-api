# 05 — Web Push Notifications

> Research date: **2026-04-25**.
>
> Scope: how browser web push works, what to build server-side, and the Apple iOS caveats that make this trickier than it looks.

## TL;DR

- Web Push is a **W3C standard** — no SaaS required, the cost is essentially $0.
- Server uses **VAPID** keys (one keypair for the whole app) to authenticate to the push services.
- Client registers a service worker, calls `pushManager.subscribe()`, sends the resulting subscription JSON to our server.
- Server stores subscriptions per user/device, sends notifications via the [`web-push`](https://github.com/web-push-libs/web-push) Node library.
- **iOS Safari supports it since 16.4 (March 2023)** but ONLY when the site is added to the Home Screen (PWA install). Notifications from a regular Safari tab don't work.
- **No silent push** on iOS, no background sync, ~50MB cache cap, 7-day cache eviction if PWA unused.

## How it works (the protocol)

```
┌─────────┐  1. subscribe()        ┌──────────┐
│ Browser │ ──────────────────────→│ Push svc │  (FCM/APNS/Mozilla AS)
└─────────┘ ←── subscription JSON ─└──────────┘
     │
     │ 2. POST subscription
     ↓
┌─────────────┐
│ Our server  │  3. send(subscription, payload)
└─────────────┘ ───────────────────→┌──────────┐  4. push to device
                  (VAPID-signed)    │ Push svc │ ─────────────→ Browser
                                    └──────────┘                   │
                                                                   ↓
                                                         service worker
                                                          'push' event
                                                          → showNotification()
```

### Components

1. **VAPID keypair** (server, one per app). Public key shipped to browser, private key signs requests.
2. **Service worker** (client JS file at `/sw.js`) — handles `push` events even when the page is closed.
3. **Push subscription** — opaque JSON returned by browser; contains the push service URL and encryption keys.
4. **Push service** — operated by the browser vendor (Google for Chrome, Mozilla for Firefox, Apple for Safari). We don't pick this; the browser does.
5. **`web-push` library** — handles VAPID signing, payload encryption, HTTP/2 to push services.

### Why VAPID
Without VAPID, push services restricted senders by GCM/FCM API keys (Google-only). VAPID standardizes a JWT-based identity so any server can send to any browser's push service. As of 2026 it's universal.

## Server side: web-push library

**Package**: <https://www.npmjs.com/package/web-push> · **Repo**: <https://github.com/web-push-libs/web-push>

Maintained by web-push-libs (W3C-aligned community). 1M+ weekly downloads. The de-facto Node implementation.

### Setup

```bash
npm install web-push
```

```ts
import * as webpush from 'web-push';

// One-time: generate VAPID keys
const vapidKeys = webpush.generateVAPIDKeys();
// { publicKey: 'B...', privateKey: '...' }
// Store these in env vars; rotate is painful (invalidates all subscriptions).

webpush.setVapidDetails(
  'mailto:notifications@motionhive.app',  // contact for push services
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

// Send a notification
async function sendPush(subscription: PushSubscription, payload: object) {
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload),
      { TTL: 60 * 60, urgency: 'high' },  // 1h TTL, high urgency
    );
  } catch (err) {
    // 404 / 410: subscription expired — delete from DB
    if (err.statusCode === 404 || err.statusCode === 410) {
      await deleteSubscription(subscription);
    } else {
      throw err;  // BullMQ will retry
    }
  }
}
```

### Key options
- **`TTL`** (Time To Live, seconds): how long the push service stores the message if the device is offline. Default 4 weeks. For "user has 5 unread messages" we want short (1h); for "important alert" longer.
- **`urgency`**: `'very-low' | 'low' | 'normal' | 'high'`. Affects whether the device wakes up from doze.
- **`topic`**: replaces previous undelivered messages with same topic — useful for collapsing notifications (e.g. only show latest "new message" not all 5).

### Subscription payload shape

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "expirationTime": null,
  "keys": {
    "p256dh": "BNc...long-base64...",
    "auth": "tBHI...short-base64..."
  }
}
```

The `endpoint` URL identifies the push service (FCM for Chrome, mozilla.com for Firefox, etc.). The `keys` are used to encrypt the payload so the push service can't read it.

## Storage schema

```sql
CREATE TABLE push_subscription (
  id           CHAR(36)     PRIMARY KEY,
  user_id      CHAR(36)     NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint     TEXT         NOT NULL,
  p256dh       TEXT         NOT NULL,
  auth         TEXT         NOT NULL,
  user_agent   TEXT,        -- for debugging "which device is this?"
  device_label TEXT,        -- user-facing: "Chrome on MacBook"
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (endpoint)         -- endpoint is globally unique per device-app
);

CREATE INDEX idx_push_user ON push_subscription(user_id);
```

### Schema notes
- **`endpoint` UNIQUE**: prevents duplicate subscriptions if the user resubscribes from the same browser.
- **One user → many subscriptions**: phone, laptop, work computer, etc.
- **`last_seen_at`**: update when user logs in. Prune subscriptions inactive > 6 months.
- **`device_label`**: optional, lets users see "you have notifications on 3 devices" with rename/delete actions.

## Client side: service worker + subscribe flow

### `/sw.js` (service worker)

```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'MotionHive', {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/badge-72.png',  // monochrome, mainly for Android
      data: { url: data.url },
      tag: data.tag,           // collapses notifications with same tag
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.openWindow(url)
  );
});
```

### Subscribe flow (page JS)

```ts
async function subscribePush(vapidPublicKey: string) {
  // 1. Register SW
  const reg = await navigator.serviceWorker.register('/sw.js');

  // 2. Request notification permission (must be in user gesture handler)
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;

  // 3. Get push subscription
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,        // ← MANDATORY (no silent push allowed)
    applicationServerKey: urlB64ToUint8Array(vapidPublicKey),
  });

  // 4. POST to our backend
  await fetch('/api/notifications/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });
}

function urlB64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64Safe);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
```

### Permission UX best practices

**Don't pop the permission prompt on page load.** Browsers increasingly auto-block sites that ask too eagerly. Pattern:

1. Don't ask until the user has done at least one meaningful action.
2. Show a **soft ask** first: an in-app banner like "Get notified about session reminders? [Yes] [Not now]"
3. Only call `Notification.requestPermission()` when the user clicks Yes.
4. If they deny, never re-prompt programmatically (browser remembers; only user can unblock).
5. Provide a settings page to re-enable.

This pattern keeps grant rates ~3x higher than cold prompts.

## Apple Web Push on iOS — caveats that matter

Web Push arrived in iOS 16.4 (March 2023). Now baseline on iOS, but with restrictions ([MagicBell guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide), [Apple docs](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)):

### The big one: requires Add-to-Home-Screen (PWA install)

**Web push only works on iOS when the user has installed the site as a PWA**. From a normal Safari tab, push notifications are silently unavailable. The `Notification.requestPermission()` call returns `'denied'` immediately.

This means:
- Plain web users (most users) won't get push at all on iPhone.
- We need an "Install MotionHive" prompt on iOS Safari, with a tutorial: tap Share → Add to Home Screen.
- Once installed, the PWA gets push permission flow as normal.

### Other iOS caveats

- **No silent push**. `userVisibleOnly: true` is enforced; every push must show a visible notification.
- **No background sync**. Can't refresh data in the background.
- **~50MB total cache cap** for the PWA (IndexedDB + Cache API combined).
- **7-day eviction**: if the user doesn't open the PWA for 7 days, iOS may evict cached data and push subscriptions can become stale.
- **No web push from non-PWA contexts**: Safari tab, Safari extension, in-app browser (Instagram, etc.) — none of these can subscribe.

### Practical impact for MotionHive

If the iOS PWA install rate is low (typical: 5–15% of iOS users), most iPhone users won't get push. Plan accordingly:
- Make email + in-app the primary channels.
- Treat push as a "nice-to-have" enhancement layer.
- Do invest in PWA install UX — install rate scales with how clearly we communicate the benefit.

## Browser support matrix (2026)

| Browser | Web Push support | Notes |
|---|---|---|
| Chrome (desktop + Android) | ✅ Yes | Full feature set |
| Firefox (desktop + Android) | ✅ Yes | Full feature set |
| Edge | ✅ Yes | Same as Chrome (Chromium) |
| Safari macOS 16+ | ✅ Yes | Works in regular browser |
| Safari iOS 16.4+ | ⚠️ PWA-only | Must Add to Home Screen first |
| Samsung Internet | ✅ Yes | Same as Chrome |
| In-app browsers (FB, IG) | ❌ No | Generally cannot subscribe |
| Older browsers (< 2020) | ❌ No | Don't attempt |

## Cost

**$0 in service fees.** Push services are operated free by browser vendors. Costs we do pay:

- Server CPU to encrypt/sign payloads (~1ms per message — negligible).
- Outbound bandwidth (small JSON payloads — pennies per million).
- DB storage for subscriptions (a few KB per device).

Compare: Knock charges $0.005 per push message (~$50/100k). For 1M push notifications/month: $0 (DIY) vs $5,000 (Knock).

## Putting it together — MotionHive integration

### New module: `push` (or in `notification` module)

```
src/modules/notification/
├── push/
│   ├── push.controller.ts          ← POST /notifications/push/subscribe
│   ├── push.service.ts             ← register + send
│   ├── entities/push-subscription.entity.ts
│   ├── providers/web-push.provider.ts ← wraps web-push library
│   └── dto/subscribe-push.dto.ts
```

### Endpoints

```
POST   /notifications/push/subscribe       (auth) → register subscription
DELETE /notifications/push/subscribe/:id   (auth) → user removes a device
GET    /notifications/push/vapid-public-key (public) → returns VAPID public key
```

### Job in BullMQ

`notifications.push_send` job → calls `WebPushProvider.send()` for each subscription belonging to the target user. On 404/410 from push service, delete the subscription. On other errors, throw → BullMQ retries.

### Env vars

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:notifications@motionhive.app
```

Generate once via `npx web-push generate-vapid-keys`; never rotate without a migration plan (rotating invalidates all existing subscriptions, requiring users to re-grant permission).

## Things that go wrong (build it knowing these)

- **Subscription expired silently**: push service starts returning 410 Gone. Delete on this, never retry.
- **Browser revoked permission**: subscription still "valid" in DB but pushes succeed without showing. No way to detect — track engagement and prune subscriptions with 0 clicks for 90 days.
- **VAPID key rotation**: invalidates everything. Avoid unless compromised.
- **Service worker scope**: must match the path you're sending notifications about. Easiest: register at root scope.
- **Payload size limit**: ~4KB per push. Don't put rich content in the payload — put an ID and have the SW fetch full data.
- **Encrypted at rest in browser**: payloads are encrypted with `p256dh` and `auth`. If you lose those, the push services can still relay but the browser can't decrypt — silent failure.

## Recommendation

Build web push as a channel inside the notification system (file 04). Estimated effort: **half a week of focused work** for VAPID setup, subscription endpoints, web-push integration, and SW scaffolding. Frontend will need a service worker and a "subscribe" UI affordance.

Defer iOS PWA install UX as a separate frontend project — it's not blocked by backend work.

## Sources

- [web-push npm package](https://www.npmjs.com/package/web-push)
- [web-push GitHub repo](https://github.com/web-push-libs/web-push)
- [Web Push Protocol — web.dev](https://web.dev/articles/push-notifications-web-push-protocol)
- [Apple Web Push docs](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [PWA iOS limitations — MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [Do PWAs work on iOS 2026 — MobiLoud](https://www.mobiloud.com/blog/progressive-web-apps-ios)
- [Safari PWA limitations](https://docs.bswen.com/blog/2026-03-12-safari-pwa-limitations-ios/)
- [Demystifying Web Push Notifications](https://pqvst.com/2023/11/21/web-push-notifications/)
- [Using Web Push with VAPID — rossta.net](https://rossta.net/blog/using-the-web-push-api-with-vapid.html)
- [VapidKeys.com generator](https://vapidkeys.com/)
