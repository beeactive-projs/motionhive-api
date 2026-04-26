# Manual Test Plan — Invoice & Subscription work

> Use this doc as a literal checklist before merging. Each section maps to a code change in this session. Tick each box as you confirm it in the running UI.

**Prereqs to test these flows:**
- API running locally (`npm run start:dev`)
- UI `web` app running (`ng serve web`)
- Stripe CLI forwarding webhooks: `stripe listen --forward-to localhost:3000/webhooks/stripe`
- An instructor account with **Stripe Connect onboarding completed** (`charges_enabled = true`)
- At least one ACTIVE client linked to that instructor
- One **subscription product** AND one **one-off product** in Pricing
- Test cards: `4242 4242 4242 4242` (success), `4000 0025 0000 3155` (3DS), `4000 0000 0000 9995` (decline)

---

## FLOW 1 — Edit a draft invoice

### What changed
- New backend route: `PATCH /payments/invoices/:id` (DRAFT-only, swaps line items + due date + description on Stripe).
- New UI: **Edit** button (pencil icon) on every draft row in the invoices list. Opens the existing create-invoice-dialog in edit mode.
- The dialog hides the recipient picker and the "Send immediately" checkbox in edit mode.

### Golden path

- [ ] Create a new invoice via "+ Create invoice", **uncheck "Send immediately"** so it stays as a draft. Confirm it appears in the list with a `DRAFT` tag.
- [ ] Click the pencil icon on the draft row. The dialog opens with title **"Edit draft invoice"**, line items pre-filled, no recipient picker, no Delivery section.
- [ ] Change the description, change the line item amount, click **Save changes**.
- [ ] The dialog closes, the toast says **"Draft updated"**, and the list refreshes with the new amount.
- [ ] Click into the invoice detail (open hosted page or PDF if present) — confirm the new line items appear in Stripe's hosted view (this confirms Stripe was actually updated, not just our DB).

### Edge cases

- [ ] Edit a draft, **add a brand-new line item via the "+" button**, save. Confirm the new line is on the Stripe-hosted page.
- [ ] Edit a draft, **delete a line item** (trash icon), save. Confirm Stripe shows only the remaining lines.
- [ ] Try to set the due date to **yesterday** → the toast shows "Due date cannot be in the past."
- [ ] Edit a draft, change nothing, click Save → toast shows "Provide at least one of lineItems, dueDate, or description."
- [ ] Open the dialog for a **non-draft** invoice (this should be impossible — the Edit button only renders for drafts, and the backend rejects non-drafts with "Only draft invoices can be edited"). To verify the backend guard, in browser devtools call `PATCH /payments/invoices/<an OPEN invoice id>` with body `{"description":"x"}`. Expect **400**.
- [ ] Close the edit dialog with the X. Click "+ Create invoice" again. The dialog opens **fresh** in create mode (NOT in edit mode). This confirms the editing state resets.
- [ ] Open the edit dialog. Refresh the page mid-edit. Re-open Create invoice — should NOT load the previous edit's data (the localStorage draft belongs only to the create flow, not edit).

### Known limitation (acknowledged, not a bug)

- Line items loaded for edit show as "manual" even if they came from a Pricing item — Stripe doesn't store the product link on invoice items. Users can re-pick the product if they want to. Worth flagging only if support tickets come in.

---

## FLOW 2 — Subscription list cleanup + Subscription detail page

### What changed
- New backend route: `GET /payments/subscriptions/:id` (with eager-loaded client + plan).
- Subscription list:
  - Plan column clamped to one line + cycle subtitle below; full text on hover tooltip.
  - Sane column widths (no more wrapping).
  - Each row is **clickable** → navigates to detail.
  - On mobile, tapping the card opens a menu with **"View details"** at top, then cancel actions when applicable.
  - New **"Pending setup"** filter chip.
- New page at `/coaching/subscriptions/:id` — hero, client + plan cards, period info, cancel buttons.

### Golden path

- [ ] Open Coaching → Payments → Memberships tab.
- [ ] Confirm the Plan column shows "Personal training stuff" on top with "every 2 months" below — and **does not wrap onto 5 lines** like before.
- [ ] Hover a row's Plan cell — the tooltip shows the full string.
- [ ] Click any row. URL goes to `/coaching/subscriptions/<id>`. Page shows hero with status pill and amount/cycle, a Client card, a Plan card, current-period dates, and (if active/trialing) a Cancel section.
- [ ] On the detail page, click the back arrow (top-left). You return to the memberships list with the right tab pre-selected.

### Edge cases

- [ ] Click a row that is **canceled** — the detail page renders, shows the canceled date, hides the Cancel buttons.
- [ ] Click a row that is **trialing** — page shows "Trial ends ..." in the period card.
- [ ] On a row with `cancelAt` set (cancellation scheduled), the hero shows an amber banner "Scheduled to cancel on ...".
- [ ] **Mobile width**: open memberships on a narrow viewport. The card list shows. Tap any card. The action menu pops up with "View details" first; tap it and you navigate to detail. Cancelled subs only show the "View details" entry (no cancel actions).
- [ ] Filter chip: click "Pending setup". Only INCOMPLETE subscriptions should show.
- [ ] On the action column of an active subscription on desktop, click the X (cancel-at-period-end) button — the row navigation should NOT fire (event propagation is stopped).
- [ ] Try to load a subscription you don't own: paste another instructor's subscription UUID into the URL. You should be redirected back to the list with an error toast.

---

## FLOW 3 — Subscription with no card on file (push-model setup)

### What changed
- When you create a subscription for a client who has **no payment method on file**, the backend creates the Stripe subscription with `payment_behavior: 'default_incomplete'` so Stripe doesn't try (and fail) to charge.
- A **Stripe Checkout setup URL** is minted and **emailed to the client** automatically.
- The subscription appears in the list with status **`incomplete`** (filterable as "Pending setup").
- Once the client saves their card via the hosted page, a `setup_intent.succeeded` webhook fires → we attach the card as the customer's default + retry the first invoice → Stripe activates the subscription and our `customer.subscription.updated` webhook flips local status to `active`.
- The detail page shows a **Pending payment setup** card with **"Get setup link"** + **Copy / Open** buttons so the instructor can re-share the link.

### Golden path (this is the critical flow)

- [ ] Pick a **fresh client** who has never saved a card — confirm in Stripe dashboard that their Customer object has no default payment method.
- [ ] Create a subscription for that client (NOT a trial — leave trial days at 0).
- [ ] Toast appears: **"Membership pending payment setup — We emailed the client a link to add their payment method..."** for ~8 seconds.
- [ ] List shows the new row with status pill **`INCOMPLETE`** (or whatever your label maps to).
- [ ] Check the API logs — the email should have either been sent via Resend (production with `RESEND_API_KEY`) or logged to console (`[EMAIL - DEV MODE] To: client@... | Subject: <Instructor> set up a <Plan> subscription for you`).
- [ ] Click into the subscription detail. The hero shows a blue **"Waiting for the client to save a payment method"** banner and the right column has a **Payment setup** card.
- [ ] Click **"Get setup link"** in the Payment setup card. A URL appears. Click **"Copy link"** → toast confirms copy. Click **"Open"** → opens the Stripe-hosted setup page in a new tab.
- [ ] On the Stripe hosted page (or in your email client opening the link from the email), enter `4242 4242 4242 4242`, future expiry, any CVC. Submit.
- [ ] In your terminal, watch the Stripe CLI forward `setup_intent.succeeded`. The API should log "Subscription <id> payment method attached + retry triggered".
- [ ] Within seconds, `customer.subscription.updated` webhook fires (also via the Stripe CLI). Refresh the detail page. Status flipped to **`ACTIVE`** (or `TRIALING` if there was a trial), the Payment setup card is gone, and Cancel buttons appear.
- [ ] On the list, the same row now shows the active status pill.

### Edge cases (the important ones)

- [ ] **Client already has a saved card** — create another subscription for the same client. The toast shows the **regular "Subscription created"** message (NOT the pending-setup one). Status is `ACTIVE` immediately. No email sent.
- [ ] **Trial subscription, no card** — create with `trialDays: 14`, no card on file. The subscription should be `TRIALING`, NOT `INCOMPLETE`. No setup email is sent (the trial defers payment).
- [ ] **Re-mint setup link** — on a still-INCOMPLETE subscription, click "Get setup link" twice. Each click yields a fresh URL (Stripe creates new sessions; idempotency keys are time-based per call here).
- [ ] **Already activated** — open the detail page of a subscription, then in another tab pay through the original setup link. Refresh the first tab and click "Get setup link". Toast says **"Already activated — This membership no longer needs payment setup"** and the page reloads showing ACTIVE.
- [ ] **Email send failure tolerance** — temporarily break Resend (e.g. set a bad API key). Create a paid sub for a card-less client. The subscription should still be created in INCOMPLETE state — the failure only kills the email; the URL is still surfaced via the toast and the detail page.
- [ ] **Use a declining card** (`4000 0000 0000 9995`) on the setup page. The setup intent should still succeed (we're just saving the card, not charging). The retry attempt on the first invoice will fail; the next webhook (`invoice.payment_failed`) flips status to `PAST_DUE` and our existing handler notifies the client.
- [ ] **Duplicate prevention** — try to create a second subscription to the **same plan for the same client** while one is INCOMPLETE. Backend should return 409 "This client already has an active subscription to this plan."
- [ ] **Cancel an INCOMPLETE subscription** — open the detail page of an INCOMPLETE sub. There are no Cancel buttons (Cancel only appears for ACTIVE/TRIALING). To clean up, you'd void the underlying Stripe subscription manually. Worth tracking as a future improvement.

### Things to verify in the **Stripe Dashboard**

After a complete run-through:

- [ ] The Stripe Customer object now has `invoice_settings.default_payment_method` set.
- [ ] The Subscription object has `default_payment_method` set.
- [ ] The first Invoice on the Subscription is `paid`.
- [ ] The Customer's payment-method list shows the saved card.

---

## Smoke checks for the rest of the platform

These are quick clicks just to make sure the invoice/subscription work didn't break anything else:

- [ ] Existing invoice flows (Send, Void, Mark paid) all still function on draft, open, and paid invoices respectively.

---

# Earlier-session work — coverage from the same set of changes

Below are flows for the security + DoS + rate-limit work done before this session. Same format: golden path → edge cases → what to look for. Background context for each is in `SECURITY_NOTES.md` (sections 1-9).

---

## FLOW 4 — `trust proxy = 1` and per-IP rate limiting

### What changed
[main.ts](src/main.ts) was updated to call `app.set('trust proxy', 1)`. Now Express reads the real client IP from `X-Forwarded-For` instead of always seeing Railway's load-balancer IP. Every `@Throttle` on the platform is now actually per-client.

### Golden path

- [ ] In two different browsers (or one browser + an incognito window), hit any throttled endpoint (e.g. `/auth/login` with bad credentials). Each browser should have its own quota — exhausting one doesn't lock the other out.
- [ ] In a single browser, hit `/auth/login` 11 times with bad creds in 15 minutes. The 11th should return 429 (Too Many Requests).
- [ ] Wait 15 minutes. Try again. Should succeed (per-IP bucket has reset).

### Edge cases

- [ ] **Direct API call** (no proxy): hit the local API at `http://localhost:3000/auth/login` from your machine. Per-IP throttle still works correctly because Express reads `127.0.0.1` from the socket — no XFF header to consult.
- [ ] **Header spoofing attempt**: from the same client, send a request with a hand-crafted `X-Forwarded-For: 1.2.3.4` header (curl: `-H 'X-Forwarded-For: 1.2.3.4'`). Repeatedly. Throttle should still fire on YOUR real IP — `trust proxy = 1` means we only trust the LAST entry in the chain (which Railway writes), not anything to its left.

### What it would look like if it broke

If `trust proxy` was off: every login attempt anywhere in the world counted against a single global bucket. You'd see throttle responses with no apparent reason ("but I only logged in once!"). After this fix, that class of issue should never happen.

---

## FLOW 5 — Tightened throttles on auth + public forms

### What changed
Loosened **7 routes** to a more user-friendly `7 req / 15 min` (was `3-5 / 1 hour`):
- `POST /auth/register`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/verify-email` (POST + GET both)
- `POST /auth/resend-verification`
- `POST /feedback`
- `POST /waitlist`

`POST /auth/login` was uncommented and set to `10 / 15 min` (paired with existing 5-attempt account lockout).

### Golden path

- [ ] Register a new account with email A. Then realize you typo'd, register again with email B. Then realize wrong domain, register again with email C. All should succeed (you're well under 7/15min).
- [ ] Hit `POST /auth/forgot-password` 7 times. The 8th returns 429.
- [ ] Wait 15 minutes. Try again. Succeeds.

### Edge cases

- [ ] On `/auth/login`, type a wrong password 5 times — your **account** is locked for 15 min. Even the 6th attempt with the CORRECT password is rejected (account lockout, separate from IP throttle).
- [ ] Same `/auth/login`, but using 5 different account emails from the same IP, each with a wrong password — at the 11th attempt your IP gets 429 (IP throttle). This is the layered defense in action.

---

## FLOW 6 — EmailVerifier (disposable-domain block + DNS MX check)

### What changed
[email-verifier.service.ts](src/common/services/email-verifier.service.ts) checks every email submitted to `/auth/register` (classic path only — OAuth bypassed) and `/waitlist`. Rejects disposable domains and domains with no MX records.

### Golden path — should ACCEPT

- [ ] Register with `you@gmail.com` → success.
- [ ] Register with `you@yourcompany.com` (assuming yourcompany.com is real) → success.
- [ ] Sign up to the waitlist with the same → success.
- [ ] **Sign in with Google** with any Google account → success (OAuth path skips the verifier entirely; Google has already verified the email).

### Golden path — should REJECT

- [ ] Register with `test@mailinator.com` → 400 with message "We can't accept temporary email addresses. Please use a personal or work email."
- [ ] Register with `test@MailInator.COM` → same rejection (case-insensitive).
- [ ] Register with `test@tempmail.io` → 400 disposable.
- [ ] Register with `you@nodomain-i-just-made-up-12345.xyz` → 400 with message "This email address cannot receive mail (the domain has no mail server). Please check for typos."

### Edge cases

- [ ] **Cache behavior**: register `a@gmail.com` → succeeds. Immediately register `b@gmail.com` → succeeds (gmail.com's MX result is cached for 1 hour, so no DNS hit).
- [ ] **OAuth bypass**: complete a Google OAuth signup with a Google Workspace email belonging to a niche domain. Even if that domain were on the disposable list (false positive), it would NOT be checked because OAuth providers pre-verify.
- [ ] **DNS timeout fail-open**: hard to reproduce manually — when DNS resolution times out (3s) we ALLOW the signup rather than block real users on a transient resolver glitch. Stripe's verification email flow catches dead addresses on the next layer.

---

## FLOW 7 — Feedback + Waitlist amplification fix

### What changed
- `/feedback` POST no longer accepts a client-supplied `email` field. Confirmation email only fires when the request is JWT-authenticated, and only to the user's account email.
- `/waitlist` POST: when a duplicate email is submitted, the server returns the existing record SILENTLY without re-sending the confirmation email.
- Both endpoints throttled to 7/15min per IP.

### Golden path

- [ ] Submit feedback as a logged-in user. You receive a confirmation email at YOUR account email.
- [ ] Submit feedback as a guest (no token). Submission succeeds; you receive NO email (no way to spoof the recipient now).
- [ ] Sign up to waitlist with a new email → confirmation email arrives.
- [ ] Sign up to waitlist AGAIN with the same email → server returns the existing entry, NO new email arrives. (Test in dev console: POST twice, watch logs — only one "Sent waitlist confirmation" line.)

### Attack-attempt tests (these should ALL fail to spam victims)

- [ ] As a guest, POST `/feedback` with `{ email: "victim@example.com", ... }` directly via curl/Postman → server accepts the request (response is OK to avoid revealing logic) but **NO email goes out** to `victim@example.com`. Check the logs to confirm only the feedback row was inserted.
- [ ] Try to spam `/waitlist` 100 times with `{ email: "victim@example.com" }`. First call sends the confirmation. Subsequent calls return the existing row silently with NO email. Plus you'll hit the 7/15min throttle quickly.

---

## FLOW 8 — Public DoS hardenings

### What changed
- [blog.controller.ts](src/modules/blog/blog.controller.ts) sitemap: `LIMIT 10000` on the query + 1-hour in-process XML cache.
- [blog-query.dto.ts](src/modules/blog/dto/blog-query.dto.ts): `@MaxLength(100)` on `search`.
- [discover-groups.dto.ts](src/modules/group/dto/discover-groups.dto.ts): `@MaxLength(100)` on search/city, `@MaxLength(3)` on country, `@ArrayMaxSize(5)` + per-element `@MaxLength(50)` on tags.
- [session.service.ts](src/modules/session/session.service.ts): `discoverSessions` rejects any `dateFrom`/`dateTo` span over 180 days.

### Golden path

- [ ] `GET /blog/sitemap.xml` → returns XML with all your posts (up to 10k).
- [ ] Hit `GET /blog/sitemap.xml` again immediately → response is identical (in-process cache hit). Check API logs: only the FIRST request shows a DB query for blog posts.
- [ ] `GET /blog?search=fitness` → returns matching posts.
- [ ] `GET /groups/discover?search=yoga&tags=beginner&tags=morning` → returns groups.
- [ ] `GET /sessions/discover?dateFrom=2026-04-01&dateTo=2026-04-30` → returns sessions in that window.

### Attack-attempt tests (should all return 400)

- [ ] `GET /blog?search=` followed by 200 characters → 400 (`@MaxLength(100)`).
- [ ] `GET /groups/discover?tags=a&tags=b&tags=c&tags=d&tags=e&tags=f` (6 tags) → 400 (`@ArrayMaxSize(5)`).
- [ ] `GET /groups/discover?search=` followed by 200 characters → 400.
- [ ] `GET /groups/discover?country=ROMANIA` → 400 (country max length 3).
- [ ] `GET /sessions/discover?dateFrom=1900-01-01&dateTo=2100-01-01` → 400 with message "Date range cannot exceed 180 days. Please narrow your search."
- [ ] `GET /sessions/discover?dateFrom=1900-01-01` (no dateTo, but more than 180 days back) → 400 (the audit-fix branch — implicit upper bound is "now").

### What to look for in logs

After hitting the sitemap once, then 100 times in quick succession, you should see:
- 1 line about querying blog posts.
- 0 additional DB activity for the next ~1 hour, no matter how many times the sitemap is requested.

This confirms the cache is working.

---

## FLOW 9 — Webhook signature verification (Stripe)

### What changed (this was already in place — included for full coverage)
Every Stripe webhook verifies signature against the raw body before any handler runs.

### Golden path

- [ ] In one terminal, run `stripe listen --forward-to localhost:3000/webhooks/stripe`. Note the `whsec_...` secret it prints.
- [ ] Confirm `STRIPE_WEBHOOK_SECRET=whsec_...` in your local `.env`.
- [ ] In another terminal: `stripe trigger account.updated` → in API logs, see "Stripe webhook received: account.updated" then "processed".
- [ ] Repeat the same trigger → see "duplicate" handling (the `webhook_event` table has UNIQUE on `stripe_event_id`).

### Attack-attempt tests

- [ ] Send a forged event:
  ```bash
  curl -X POST http://localhost:3000/webhooks/stripe \
       -H "Content-Type: application/json" \
       -H "Stripe-Signature: t=1234,v1=fake" \
       -d '{"id":"evt_fake","type":"invoice.paid","data":{"object":{}}}'
  ```
  Expect **400 Bad Request** ("signature verification failed"). The forged event must NOT appear in the `webhook_event` table.

---

## Final cross-cutting tests

- [ ] Run `npm test` in the API repo: should be `9 suites / 80 tests passing`.
- [ ] Run `npm run build` in the API repo: should complete with no errors.
- [ ] Run `ng build core && ng build web && ng build website` in the UI repo: all three should complete.

---

## If something goes wrong

- **Subscription stuck in INCOMPLETE forever after card save**: check `setup_intent.succeeded` arrived (Stripe CLI / dashboard webhook log). If it did but status didn't flip, check API logs for "Failed to attach payment method" — the most common cause is the SetupIntent metadata missing `purpose=subscription_payment_setup`.
- **Edit button missing on a draft**: hard-refresh the list (the Edit button is gated on `Statuses.Draft` and only appears on draft rows).
- **Setup email never arrives in dev**: check `RESEND_API_KEY` in `.env`. Without it the email is logged to console only.
