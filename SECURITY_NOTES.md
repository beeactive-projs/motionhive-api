# Security Notes — Concepts behind what we shipped

> A from-first-principles explanation of every defensive measure added in this session. Use this as your reference: each section says **what we did**, **why**, **what the standard is**, and **what would have happened without it**.

---

## 1. `app.set('trust proxy', 1)` in `main.ts`

### What we did
Added a single line on bootstrap that tells Express it's running behind exactly one upstream proxy (Railway's edge).

### Why
Without it, every rate limit on the platform was useless. Express's `req.ip` was reporting Railway's load-balancer IP for every request, so `@nestjs/throttler` keyed all visitors on the same IP. Three random people anywhere in the world hitting `/feedback` would burn the quota for everyone else.

### The standard
Express's official **"behind proxies"** guide ([expressjs.com/en/guide/behind-proxies.html](https://expressjs.com/en/guide/behind-proxies.html)) and NestJS's rate-limiting docs both call this out. Industry pattern: trust **only** the number of hops you actually have.

The number `1` matters:
- `1` = "trust the value the LAST proxy wrote into `X-Forwarded-For`, ignore everything to its left"
- `true` = "trust the entire `X-Forwarded-For` chain, including anything an attacker put there" → **dangerous**
- `false` = default, "ignore the header" → all users look like the proxy

### What would have happened without it
- Rate limits would have continued to misfire — first 7 strangers in a 15-minute window would lock everyone out.
- Brute-force protection on `/auth/login` would be worthless (one IP exhausts the quota for everyone).
- Account lockout still worked per-account, but the IP-level cap that's supposed to stop horizontal scans across many accounts wouldn't have fired.

### What an attacker can NOT do now
Forge their own IP via `X-Forwarded-For`. With `trust proxy = 1`, Express discards anything written into XFF before it reached Railway and only trusts what Railway itself wrote.

---

## 2. Rate limits with `@Throttle` (NestJS Throttler)

### What we did
Tightened a bunch of public-facing routes to `7 requests / 15 minutes` per IP, and `/auth/login` to `10 / 15 minutes`. Backed by Express's now-correct per-IP keying (see #1).

### Why
Two distinct attack shapes get blocked:
1. **Brute force** — guess a password by trying many combinations.
2. **Resource abuse** — spam a form (feedback, waitlist) with thousands of submissions.

Rate limiting alone doesn't stop a determined attacker, but it **transforms the cost**: at 7 attempts per 15 min per IP, brute-forcing a password takes years. At those rates the attacker has to either (a) acquire a botnet, (b) target many accounts in parallel, or (c) move to a different attack — all of which we want.

### The standard
**Defense-in-depth**: rate limit is one layer. We pair it with:
- bcrypt cost factor 12 (each guess takes ~100ms of CPU regardless of throttle)
- account lockout (5 failed passwords on one account → 15-min lock)

### Why these specific numbers
We picked `7/15min` after a UX vs. abuse analysis:
- A confused user might hit a submit button 3-4 times in frustration. 7 leaves headroom.
- 7 per 15 min = 28/hour ceiling per IP — not enough for anyone to meaningfully abuse the service.
- 1-hour blocks (the previous behavior) felt like a customer-service nightmare.

For `/auth/login`, `10` is a touch more lenient because legitimate users mistype passwords more often than they mistype registration forms.

### What would have happened without it
- Open feedback/waitlist forms become spam vectors. We saw concrete attack scenarios: 1000 fake feedback rows per minute, each one triggering an outbound email to a victim.
- Login becomes a brute-force target.

---

## 3. `EmailVerifierService` — disposable-domain blocklist + DNS MX check

### What we did
Before accepting an email at `/auth/register` or `/waitlist`:
1. Check the domain against a 5407-entry **disposable-domain blocklist** (`mailinator.com`, `tempmail.io`, etc.).
2. Run a **DNS MX lookup** to confirm the domain has a mail server.
3. Cache positive/negative results for 1 hour, with a 3-second timeout, **failing open** on transient DNS errors.

### Why
Three reasons:
1. **Save Resend quota** — sending a verification email to `asdf@nodomain.xyz` burns a send credit and contributes to bounce rate. High bounce rates damage our **sender reputation** with Gmail/Outlook, which makes our real emails go to spam.
2. **Reduce abuse** — disposable emails are how attackers create throwaway accounts at scale (vote rigging, free-tier abuse, spam).
3. **Improve UX** — typos like `gmial.com` get caught at signup with a friendly message ("This email address cannot receive mail").

### The standard
- **MX lookup** is RFC 5321 §5.1 — the SMTP standard. A domain with no MX records cannot receive mail. Period.
- The disposable-domain list comes from [disposable-email-domains/disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains), MIT-licensed, used by Stripe, GitHub, Slack, Linear, etc.
- "Fail open on transient DNS error" is a deliberate trade-off — better to let one suspicious signup through than lock real users out when our DNS resolver hiccups.

### What we deliberately do NOT do
- **No SMTP `RCPT TO` probing**: that's actually saying "hey real mail server, does this user exist?" — many providers refuse to answer (or treat it as suspicious behavior and blacklist your IP). Unreliable AND counterproductive.
- **No paid verification API** (ZeroBounce, Hunter, etc.) until we hit a scale where bounce rate hurts deliverability. MX + disposable list catches >90% of junk for free.
- **OAuth signups skip the check entirely** — Google/Facebook already verified the email belongs to the user. Running our checks on a Google Workspace email could lock out real users due to a false positive on the disposable list.

### What would have happened without it
- Register endpoint accepts every syntactically-valid email, including obvious junk.
- Verification email sends to dead addresses → bounces → our domain reputation drops → real users' emails land in spam.
- Throwaway-email signups proliferate; abuse vectors open up.

---

## 4. Removed SMTP amplification on `/feedback` and `/waitlist`

### What we did
- Dropped the `email` field from the public `/feedback` POST DTO (the marketing-site form). The recipient is now resolved server-side via the JWT — only authenticated users get a confirmation, and only at the email tied to their account.
- On `/waitlist`, when a duplicate-email POST comes in we silently return the existing record **without re-sending** the confirmation email.

### Why
This was a real attack vector. The original code accepted any email in the request body and immediately fired off a "thanks for your feedback" email to that address from `noreply@motionhive.fit`. Same on waitlist — re-POSTing a victim's email would re-send the welcome email. An attacker could:
1. Pick a victim email (say, `someone@example.com`).
2. Loop POSTing to `/feedback` or `/waitlist` with that email.
3. Watch the victim's inbox fill up with messages from our domain.

This is called an **SMTP amplification attack** or **email bombing**. The attacker uses one HTTP request as the trigger; we end up sending the email. From the victim's side, the spam comes from a legitimate-looking source (us), poisoning our domain reputation.

### The standard
**Never trust client-controlled identifiers when they cause a side effect to a third party.** Authenticated identity (JWT, session) is the only safe input here. This is a standard pattern in any system that sends external messages on behalf of a request — Slack, Notion, Linear all gate "send confirmation to email X" behind authenticated ownership of X.

### What would have happened without it
- Free email-bombing service hosted by us, on our SPF/DKIM-signed domain.
- Burned Resend quota.
- Domain blacklisted by major providers within hours of a sustained attack.

---

## 5. Sessions discover — date range cap

### What we did
On `GET /sessions/discover`, if `dateTo - dateFrom > 180 days` (or `dateFrom` set with no `dateTo` and `now - dateFrom > 180`), we throw a 400.

### Why
The original endpoint accepted any `dateFrom` value. Passing `dateFrom=1900-01-01` made Postgres scan the entire `session` table — pruned only by the `status IN ('SCHEDULED','IN_PROGRESS')` filter, which still scans long indexes. At our scale today this is fine, but at thousand-row scale it becomes a per-request DoS: each query runs in seconds, the connection pool exhausts, the API stops responding to anyone.

### The standard
**Validate that user input cannot force unbounded work.** Any open-search endpoint should cap the search window, the result limit, and the input size. A small cap (`@MaxLength`, `@ArrayMaxSize`, date-range guard) is the cheapest defense against accidental and intentional resource exhaustion.

### What would have happened without it
- Single `GET` request with `?dateFrom=1900-01-01&dateTo=2100-01-01` would scan the whole sessions table.
- 100 such requests per minute (the global throttle) = the database becomes unresponsive.

---

## 6. Sitemap LIMIT + in-process cache

### What we did
On `GET /blog/sitemap.xml`:
- Cap the underlying query at `LIMIT 10000` posts.
- Cache the generated XML in the controller for 1 hour.

### Why
- Without LIMIT, a growing blog table eventually means every sitemap request loads N posts into memory and stitches them into XML. At 100k posts this is hundreds of MB of allocated memory per request.
- Without a cache, the global 100 req/60s rate would let attackers hammer the endpoint, regenerating the XML 6000 times an hour for no reason — and crawlers expect sitemaps to be cached anyway.

### The standard
- Sitemaps are a cacheable resource by design — Google itself recommends `Cache-Control: public, max-age=3600`. We send that header AND cache server-side so we don't even hit the DB on hot calls.
- LIMIT on any aggregation/listing query is a baseline protection — there's no use case for "give me all 5 million rows in one response."

### What would have happened without it
- Memory-pressure DoS as the blog grows.
- Pointless DB load on a route that Google hits maybe once a day in practice.

---

## 7. Disposable email blocklist as a frozen `ReadonlySet<string>`

### What we did
Bundled 5407 disposable domains as a TypeScript constant exported as `ReadonlySet<string>`. Loaded once at module init.

### Why immutable
A mutable shared Set could be tampered with at runtime — a careless `add()` somewhere could pollute the global allowlist. `ReadonlySet` enforces this at the type level. It also signals intent: "this is configuration data, not state."

### What would have happened without it
- Theoretical risk: any code path that gets a reference to the set could mutate it accidentally.
- Real risk: someone refactoring the verifier could accidentally use it as a mutable cache and corrupt the source-of-truth list.

---

## 8. Stripe webhook signature verification

### What we did (this was already in place — included for completeness)
Every webhook arriving at `POST /webhooks/stripe` is verified using the Stripe-signed signature header against the **raw request body**. We do this BEFORE any JSON parsing.

### Why
Stripe webhooks contain authoritative state changes: "this invoice was paid", "this subscription is active now", "this customer's card was declined". If anyone could POST forged data to that endpoint, they could:
- Mark unpaid invoices as paid → free service.
- Activate canceled subscriptions → free service.
- Fake refund events → financial fraud.

### The standard
**HMAC signing of webhook payloads** is the universal pattern across every webhook-emitting platform: Stripe, GitHub, Slack, Twilio, Shopify. The signature is computed over the raw bytes; if you re-serialize JSON before verifying, the signature breaks.

That's why we wire `express.raw({ type: 'application/json' })` on the `/webhooks/stripe` route in `main.ts` BEFORE the global JSON body parser kicks in.

### What would have happened without it
Anyone with knowledge of our endpoint URL could POST forged Stripe events and manipulate our local payment state.

---

## 9. SetupIntent metadata guard in subscription webhook

### What we did
The new `setup_intent.succeeded` handler **only acts** if the SetupIntent's metadata contains `purpose: 'subscription_payment_setup'` AND a `beeactive_subscription_id` we recognize.

### Why
We may use Stripe SetupIntents for other features in the future (saving a card via the Customer Portal, adding a backup card, etc.). Without the guard, every `setup_intent.succeeded` event would try to attach the saved card to *some* subscription — possibly the wrong one. The metadata tag scopes the handler to **only** SetupIntents we minted as part of the subscription-create flow.

### The standard
**Tag your domain events.** When multiple flows in your code can produce the same provider-level event, attach distinguishing metadata at creation time and read it at consumption time. This is how you avoid cross-feature side effects when the provider's event taxonomy is coarser than your business logic.

### What would have happened without it
A client adding a card via the Stripe Customer Portal (an existing flow) would silently trigger our subscription-attachment logic, possibly attaching that card to a stale INCOMPLETE subscription they don't even know about.

---

## 10. Subscription create — `payment_behavior: 'default_incomplete'`

### What we did
When creating a subscription for a client with no card on file, we explicitly tell Stripe **not to try charging immediately**. Stripe creates the subscription in `incomplete` status, we mint a Stripe-hosted setup URL, email it to the client, and let them save a card asynchronously.

### Why
Without this, calling `subscriptions.create` on a customer with no payment method returns a 402 error: *"This customer has no attached payment source or default payment method."* That's exactly the bug you reported in the previous session. The default `payment_behavior` (`'allow_incomplete'`) tries to charge first and only on failure puts the subscription in incomplete.

The push-model alternative is `'default_incomplete'`, which **always** creates the subscription in incomplete state and only activates after the first invoice is paid. We then collect payment via a separate Checkout session in `setup` mode.

### The standard
This is the **Stripe-recommended pattern** for SaaS subscriptions where the client isn't sitting in front of the screen at create time:
- [stripe.com/docs/billing/subscriptions/build-subscriptions](https://stripe.com/docs/billing/subscriptions/build-subscriptions) — collect payment via SetupIntent, attach as default, retry the first invoice.
- Used by Notion, Vercel, Linear, every coaching/membership platform we benchmarked.

### What would have happened without it
The exact bug we were fixing: subscription create returns 500, the instructor sees a red error, the client has no idea anything was supposed to happen.

---

## 11. PCI compliance — we never see card data

### What we did (this is structural — included for awareness)
At every point where a card is collected (invoice payment, subscription setup), the user types it into a **Stripe-hosted page** in their own browser. Our backend never sees a card number, CVC, or expiry.

### Why
PCI-DSS (the payment industry's compliance standard) requires you to undergo audits proportional to what your code touches:
- **SAQ A** (the easiest): you never receive card data, just redirect to a hosted form. ~25 questions, can be self-attested.
- **SAQ A-EP**: you receive card data via your own page that posts to Stripe Elements/JS. Hundreds of questions, requires quarterly scans.
- **SAQ D**: you store card data. Annual on-site audit. Costs $30k+/year.

By using Stripe Checkout exclusively (and Customer Portal for ongoing management), we stay firmly in **SAQ A** territory.

### The standard
**Never touch card data unless you absolutely must, and even then, use a hosted iframe.** Every responsible payment integration follows this — Stripe's docs literally call it out as the first design principle.

### What would have happened without it
Six-figure compliance overhead, lawyers, quarterly audits. For a fitness platform of any size short of Strava, this is non-negotiable.

---

## 12. Ownership checks on every mutating endpoint

### What we did
Every backend service method that touches a specific record (`updateDraft`, `getOneForInstructor`, `getSetupLink`, `cancel`) re-fetches the entity by id and explicitly compares `entity.instructorId === currentUserId`. Throws `ForbiddenException` on mismatch.

### Why
JWT auth confirms WHO you are. Role guards confirm WHAT you can do. Ownership checks confirm you can do it **on this specific record**. Without them, an authenticated INSTRUCTOR could send `PATCH /payments/invoices/<another-instructor's-invoice-id>` and modify it.

This class of bug is **IDOR** (Insecure Direct Object Reference) — OWASP's API #1 ranked vulnerability for several years running.

### The standard
**Ownership check at every read AND write.** Don't trust the URL parameter to be safe just because the user authenticated. Re-fetch and compare on every operation.

### What would have happened without it
Cross-tenant data exposure. Instructor A could read Instructor B's invoices, customer lists, financial info — just by guessing or scraping IDs.

---

## 13. Stripe idempotency keys

### What we did (existing pattern, reinforced in new code)
Every Stripe write call uses a deterministic `idempotencyKey` derived from a stable local row id (e.g. `invoice:<row.id>:create`, `invoice_item:<row.id>:edit_<editVersion>_line_<i>`).

### Why
Stripe's idempotency layer guarantees that two calls with the same key return the same result. This is critical because:
- Our HTTP handler may retry on network blips.
- The user might double-click "Send invoice".
- A request might time out mid-flight; we re-issue and Stripe returns the original outcome instead of creating a duplicate invoice.

For the new edit endpoint, we use a per-edit version (`Date.now()`) so different edits don't collide on the same key, but a retry within the same call uses the same key and is safe.

### The standard
**Idempotency keys are mandatory on every state-changing third-party API call.** Stripe enforces it at the API level — they keep keys for 24h and return the cached response for any duplicate.

### What would have happened without it
Double charges, duplicate invoices, duplicate subscriptions when the network hiccups or the user retries.

---

## How these layers compose

Most attacks aren't a single shot — they're a chain. Here's how our defenses stack up against a realistic attacker scenario:

**Attack scenario: brute-force passwords + spam our customers via SMTP amplification**

1. Attacker writes a script that tries common passwords against `/auth/login`.
2. They also POST to `/feedback` with a victim's email to spam them.

Our defenses:
- **`trust proxy = 1`** ensures their per-IP throttle is real.
- **`/auth/login` 10/15min** caps their attempts on any single IP.
- **Account lockout** caps their attempts on any single account regardless of IP.
- **bcrypt 12 rounds** makes each attempt CPU-expensive.
- **`/feedback` no longer accepts client-supplied email** so the SMTP amplification vector is closed.
- **`/feedback` 7/15min** caps the request rate per IP.
- **Disposable-email blocklist** stops them from registering throwaway accounts to bypass throttles.
- **MX check** stops typo'd / dead-domain signups even if the attacker uses real-looking emails.

No single layer is enough. The combination forces the attacker to **acquire a botnet AND** generate plausible per-victim emails AND compute bcrypt ~28 times per IP per hour. The economics fall apart.

That's what defense-in-depth looks like in practice.

---

## 14. Why every new subscription requires client confirmation (always-confirm policy)

### What we do
When an instructor creates any non-trial subscription for a client, we always create it on Stripe with `payment_behavior: 'default_incomplete'`. The subscription lands in `INCOMPLETE` status with an unpaid first invoice. We email the client a link to that invoice's Stripe-hosted page, where they see the plan name, amount, and cycle, and confirm by paying with a saved card or a new one. Only after they pay does the subscription activate.

This applies **even when the client already has a saved card on file from a previous subscription.**

### Why
The naive design — "client saved a card once, so future subscriptions just charge it silently" — looks like a UX win and is a compliance landmine.

**Ethically:** the card was authorized for one specific recurring service. Reusing it for a different service the trainer adds later isn't blanket consent; it's silent re-billing. The client never agreed to subscription #2.

**Legally (EU stack — most relevant for our user base):**
- **PSD2 / SCA**: recurring-payment exemptions from Strong Customer Authentication apply to the **same merchant for the same recurring agreement**. A new subscription is a new agreement; it requires fresh consent. Charging without it can void the SCA exemption and expose the platform to the full chargeback amount.
- **EU Consumer Rights Directive (the same OUG 34/2014 framework that governs our `requiresImmediateAccessWaiver` on one-off invoices)**: the consumer must affirmatively opt in to each recurring service.
- **GDPR Art. 6**: the card-on-file is processed under "performance of contract" for the original agreement. Using it for a different agreement is processing personal data outside the original lawful basis.

**Operationally:** silent re-billing is the #1 dispute trigger on Stripe Connect. Repeated chargebacks with reasons like `subscription_canceled` or `unrecognized` push the platform's dispute rate upward fast. Above 1% triggers Stripe enhanced monitoring; above 1.5% the connected account is blocked. One bad-actor instructor can torch the platform for everyone.

### How the flow looks now

| Actor | Action |
|---|---|
| Instructor | Clicks "Create membership" for a client. (Same UX as before.) |
| Backend | Creates subscription on Stripe with `payment_behavior: 'default_incomplete'` + `expand: ['latest_invoice']`. |
| Stripe | Returns subscription in `incomplete` state, with first invoice `open` and a `hosted_invoice_url`. |
| Backend | Sends client an email: *"Your trainer set up X membership for Y, billed Z. Confirm and start membership."* with the hosted URL. |
| Backend | Returns `{ subscription, pendingConfirmationUrl }` so the instructor sees a "Pending client confirmation" toast. |
| Client | Receives email, clicks the link, lands on Stripe's branded invoice page showing exact plan + amount + cycle, taps Pay. Sees their saved cards as one-tap options if any. |
| Stripe | Charges the chosen card, marks invoice paid, sends client a receipt, transitions subscription to `active`. |
| Stripe → us | `invoice.paid` and `customer.subscription.updated` webhooks fire. We sync local state via existing `syncFromWebhook` paths. |

Trial subscriptions are exempt from the confirmation step because there's no charge today to consent to. Stripe demands a payment method before the trial ends; that prompt to the client is Stripe-managed.

### What we deliberately do NOT do
- **Don't reuse `customer.invoice_settings.default_payment_method`** silently across subscriptions. Even when present, every new sub goes through the hosted confirmation page so the client opts in per-subscription.
- **Don't auto-charge "trusted" trainers.** Stripe supports a Mandates API for pre-authorized recurring billing, but it requires complex consent capture up front and is overkill for a coaching platform's risk profile.
- **Don't build our own "approve membership" UI inside the app.** Stripe's hosted invoice page is the legal record of consent — its branding, its TLS, its receipt. Reimplementing that UI ourselves shifts compliance burden to us with no upside.

### What this changes in code (for future readers)
- `SubscriptionService.create` always passes `payment_behavior: 'default_incomplete'` for non-trial subs. The previous `customerHasDefaultPaymentMethod()` shortcut and the entire setup-mode Checkout helper are gone.
- The webhook stack used to handle `setup_intent.succeeded` to attach a card after a setup-mode flow. That handler is removed — Stripe's hosted invoice page does the equivalent without our involvement.
- The "pending setup" UI label is now "pending client confirmation" because that's literally what we're waiting for.

### Two follow-up improvements worth considering later
1. **Per-instructor mandate (Option C)**: let a client check a box once per trainer authorizing future subscriptions up to a cap. Lower friction for power users who buy multiple membership tiers from the same trainer. Build only when there's evidence trainers want it.
2. **In-app confirmation surface**: replicate the consent UI in our app (with the same legal-record properties) so the client never leaves us. Higher engineering cost, marginally better engagement metrics.

