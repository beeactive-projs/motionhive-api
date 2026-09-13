# MotionHive API

> **Naming note:** The product is **MotionHive**. The repo directory is still `beeactive-api` (historical, not renamed to avoid breaking IDE workspaces, git remotes, and absolute paths). Code identifiers, Stripe metadata (`platform: 'beeactive'`), DB column names, and email template variables also still use "beeactive" — **intentionally, do not mass-rename**. Stripe stores that metadata on live records and a sed-rename would desync production state. A rename is a dedicated future sprint, not incidental cleanup.

## Project Overview
Fitness platform REST API built with NestJS. Manages instructors, clients, groups, sessions, profiles, blog, and Stripe Connect payments.

## Tech Stack
- **Framework**: NestJS 11 (TypeScript, ES2023)
- **ORM**: Sequelize 6 (sequelize-typescript) + PostgreSQL (Neon, driver: `pg`)
- **Auth**: Passport JWT (@nestjs/jwt 11), bcrypt, Google/Facebook OAuth
- **Queue**: BullMQ + @nestjs/bullmq + @nestjs/schedule (5 queues live: notifications, sessions, workouts, payments, maintenance — see "Jobs module" under Known Issues)
- **Email**: Resend
- **Images**: Cloudinary
- **Payments**: Stripe Connect Express (`stripe` 22.x)
- **Docs**: Swagger/OpenAPI at `/api/docs`
- **Logging**: Winston
- **Validation**: Joi (env) + class-validator (DTOs)
- **Security**: Helmet, Throttler rate limiting, CORS
- **Testing**: Jest 30

## Commands
```bash
npm run start:dev        # Development watch mode
npm run build            # Build to dist/
npm run start:prod       # Production
npm run lint             # ESLint fix
npm run migrate          # Run migrations (node migrations/run.js)
npm run migrate:fresh    # Drop + recreate
npm run railway:start    # Build + safe migrate + start (Railway deploy)
npm test                 # Jest
npm run test:cov         # Jest with coverage
```

## Architecture

### Directory Structure
```
src/
├── main.ts                    # Bootstrap, Swagger, CORS, Helmet, express.raw for Stripe webhooks
├── app.module.ts              # Root module, global guards/interceptors via APP_* tokens
├── config/                    # Database, JWT, env validation (Joi schema in env.validation.ts)
├── common/
│   ├── decorators/            # @ApiEndpoint, @Public, @Roles, @Permissions
│   ├── docs/                  # Per-module Swagger doc objects
│   ├── dto/                   # Shared DTOs (PaginationDto)
│   ├── filters/               # HttpExceptionFilter (applied globally in main.ts)
│   ├── guards/                # RolesGuard, PermissionsGuard
│   ├── constants/             # Shared constants (countries.ts: Stripe Connect whitelist + currency map)
│   ├── email/                 # One file per email template (auth/, group/, session/, …) + _layouts/base-layout
│   ├── interceptors/          # CamelCaseInterceptor (APP_INTERCEPTOR)
│   ├── middleware/            # RequestIdMiddleware (applied to all routes)
│   ├── services/              # CloudinaryService, CryptoService, EmailService, EmailVerifierService
│   ├── utils/                 # Pure helpers (html.utils:escapeHtml, search.utils:escapeLikeWildcards)
│   └── validators/            # StrongPasswordValidator
└── modules/
    ├── auth/         # Register, login, refresh, OAuth, password reset, change password, email verification (POST /auth/resend-verification)
    ├── user/         # User entity (with country_code + city), /users/me, GDPR data export
    ├── role/         # RBAC: Role, Permission, UserRole entities (service-only, no controller)
    ├── profile/      # InstructorProfile (location lives on user, not duplicated), discovery, unified update
    ├── group/        # CRUD, members, join links, discovery, ownership transfer, stats
    ├── session/      # Two-table model (template + instance + participant + reminder) — see "Session Module Shape" below. Migration 046 rewrote the legacy single-table design.
    ├── invitation/   # Group invitations
    ├── client/       # Instructor-client relationships & requests
    ├── blog/         # Blog posts, Cloudinary image upload, sitemap
    ├── analytics/    # Instructor summary, user activity, platform stats
    ├── notification/ # Phase 1 stub (@Global, logs only) — see NOTIFICATION_SYSTEM_PLAN.md
    ├── payment/      # Stripe Connect (9 entities, 13 services, 3 controllers, multi-country)
    ├── venue/        # Where instructors deliver sessions (gym/studio/park/online/client-home/other)
    ├── feedback/     # Public feedback (no userId from body — JWT-derived; submitter-supplied email)
    ├── waitlist/     # Landing-page email capture (NOT session overflow waitlist — that still doesn't exist)
    ├── search/       # Global search (search_doc index + GET /search) — see migration 029
    ├── exercise/     # Movement catalog (883 SYSTEM from free-exercise-db + instructor-authored), muscle/equipment links
    ├── workout/      # Programs, routines, assignments, logging — see "Workout Module Shape" below
    ├── progress/     # Trainee progress overview + per-exercise history, coach roster (read-only, raw SQL)
    └── health/       # Terminus health checks, app config (controller-only, no service)
```

### Global Pipeline (wired in main.ts + app.module.ts)
- **Global filter**: HttpExceptionFilter
- **Global interceptor**: CamelCaseInterceptor (APP_INTERCEPTOR)
- **Global guard**: `UserThrottlerGuard` (APP_GUARD) — 300 req/60s **per route**, keyed by the verified JWT subject when there is one, by IP otherwise
- **Global pipe**: ValidationPipe (whitelist + transform)
- **Middleware**: RequestIdMiddleware on all routes
- **Security**: Helmet, CORS (explicit origin list), `express.raw()` scoped to `/webhooks/stripe`

### Module Pattern
`module.ts` + `controller.ts` + `service.ts` + `entities/` + `dto/`. Controllers are thin; business logic lives in services.

### Key Patterns
- **`@ApiEndpoint()`** decorator centralizes Swagger docs — doc objects live in `common/docs/*.docs.ts` (one per module). Inline `@ApiEndpoint({...})` blocks are a code smell; add a docs file instead.
- **Guards**: `AuthGuard('jwt')` + `RolesGuard` + `PermissionsGuard`
- **DTOs**: class-validator for input, `PaginationDto` for lists. List DTOs that paginate **MUST** `extends PaginationDto` — do not redeclare `page`/`limit`. `@Query('foo')` raw strings are reserved for token/slug-shaped params; everything else gets a DTO.
- **`ParseUUIDPipe`** on every UUID `@Param` — bare `@Param('id') id: string` lets a malformed UUID 500 in Sequelize. Always: `@Param('id', ParseUUIDPipe) id: string`.
- **Entities**: Sequelize models with CHAR(36) UUID PKs, `underscored: true`
- **Soft deletes**: paranoid mode on user, group, session, blog_post
- **Transactions**: all multi-table operations wrap in a transaction. Webhook handlers receive `tx` from the caller and **every ORM call inside MUST pass `{ transaction: tx }`**. Controller-level services may call Stripe before saving locally (Stripe is source of truth; webhooks reconcile drift).
- **Pagination**: PrimeNG-compatible via `buildPaginatedResponse(data, totalItems, page, limit)` → `{ items, total, page, pageSize }`. This shape is a **frontend contract** — do not change.
- **Service constructor style**: every constructor parameter is `private readonly`. Logger goes last, just before the closing paren. Mixing `private` and `private readonly` in the same constructor is drift to be cleaned, not maintained.
- **Thin controllers**: controllers do request unwrap → service call → response. No HTML rendering, no caching state, no field-picking, no DTO-shape branching, no query-string parsing/clamping (use a DTO with `@Min/@Max` instead). When a controller method grows past ~10 lines of work, push it into the service.
- **Notifications**:
  - Producers call `notificationService.notify(builder(...))` — never object literals at the call site. Builders live in `<module>/notifications.ts` and take **primitive** arguments (id, name, cents, currency), never Sequelize entities (avoids partial-load bugs).
  - Shared formatters in `notification/format.ts`: `formatMoney(cents, currency)`, `formatDueDate(date)`.
  - `data.screen` must map to a real FE route; tabbed pages use `data.queryParams` (e.g. `screen: 'profile', queryParams: { tab: 'memberships' }`) instead of `entityId`.
  - Place `notify()` calls **after** the surrounding tx commits (search `// notify-after-commit` for examples). Never inside the tx callback — `notify()` opens its own tx and a rollback would orphan the alert.
  - For webhook flows you don't own the tx of, use `NotificationOutbox` + `outbox.add(builder(...))` + `outbox.flush()` post-commit / `outbox.discard()` on rollback. See `notification/notification-outbox.ts`.
- **Stripe**:
  - `StripeService.buildFeeParams()` for `application_fee_amount` — **omits the field entirely when 0**, never passes an explicit `0`
  - `StripeService.buildIdempotencyKey()` required on all write operations
  - Webhook raw body preserved via `express.raw()` middleware scoped to `/webhooks/stripe` in main.ts
  - `webhook_event` table has UNIQUE on `stripe_event_id` → idempotent replays
- **Email idempotency**: BullMQ enqueues with `jobId = receipt.id`, AND the worker checks `receiptService.isChannelDelivered(receiptId, 'email')` before sending. Both layers are needed — jobId dedups re-enqueue, the receipt check dedups worker retries (Resend has no idempotency-key support).
- **OAuth idempotency**: `social_account` has UNIQUE on `(provider, provider_user_id)`. `userService.findOrCreateFromOAuth` swallows a `UniqueConstraintError` on insert (concurrent-callback race) and returns the existing row.
- **Shared singletons**: `EmailService` is exported from a `@Global() EmailModule` registered in AppModule. Don't list `EmailService` as a provider in feature modules — just inject it.

### RBAC
Roles: `SUPER_ADMIN`, `ADMIN`, `SUPPORT`, `INSTRUCTOR`, `WRITER`, `USER`
- `@Roles('INSTRUCTOR')` + `@UseGuards(AuthGuard('jwt'), RolesGuard)`
- `@Public()` for unauthenticated routes
- `WRITER` role added in migration 017 for blog authorship

### Database
- PostgreSQL (Neon) via `DATABASE_URL` or individual `DB_*` vars
- Migrations in `/migrations/` (numbered `NNN_<snake>.sql` — read the directory; this list goes stale), run with `node migrations/run.js`
- Custom enum types for status fields (e.g. `venue_kind`, `meeting_provider`)
- CHAR(36) UUID primary keys everywhere
- **Migration 027** dropped `user_profile` (was unused), added `user.country_code` + `user.city`, dropped `instructor_profile.location_*` (location now lives on `user`), and created the `venue` table

### Payment Module Shape
- **9 entities**: `payment`, `invoice`, `product`, `subscription`, `stripe_account`, `stripe_customer`, `payment_consent`, `webhook_event`, `dispute`
- **3 controllers**: `PaymentController` (INSTRUCTOR), `PaymentClientController` (USER), `PaymentWebhookController` (@Public, raw body)
- **13 services**: `StripeService`, `ConnectService`, `CustomerService`, `ProductService`, `InvoiceService`, `CheckoutService`, `SubscriptionService`, `RefundService`, `EarningsService`, `WebhookHandlerService`, `PaymentRemindersService`, `BalanceCacheService`, `DisputeService`
- **Multi-country Connect**: `ConnectService.getOrCreateAccount` reads country from `user.countryCode` and validates against the Stripe Connect whitelist (`common/constants/countries.ts`). 400 if missing, 400 if not supported. Once a `stripe_account` row exists `user.countryCode` is locked — `UserService.updateUser` rejects changes with a clear message (Stripe doesn't allow country changes on a Connect account).
- **Currency resolution**: `StripeService.resolveCurrency({explicit, accountCurrency, countryCode})` — explicit → `stripe_account.default_currency` → country→currency map → `'usd'` fallback. Used by `ProductService`, `InvoiceService`, `EarningsService` so each instructor's products/invoices default to their settlement currency.
- Platform fee: 0 bps default, configurable per-instructor via `stripe_account.platform_fee_bps`
- 14-day refund window enforced in `RefundService`
- EU consumer rights (OUG 34/2014) waiver recorded in `payment_consent` table
- **Two-phase save** for Stripe writes (Product, Invoice, Subscription create): insert local row → call Stripe OUTSIDE the DB transaction → backfill Stripe IDs. Avoids holding a Postgres connection open across an HTTP round-trip and lets each create attempt have a unique idempotency key derived from the local row id.
- **Invoice lifecycle**: creation leaves the invoice in `DRAFT` (no finalize, no email) unless `sendImmediately=true`. `POST /payments/invoices/:id/send` finalizes (generates `hosted_invoice_url` + `invoice_pdf`) and emails — via Stripe native send, or via Resend when `overrideEmail` differs from the on-file email. Client list (`/payments/my/invoices`) filters to `OPEN` + `PAID` only; drafts/voids are instructor-only.
- **Invoice line items** are not mirrored locally — fetched on demand from Stripe via `/payments/invoices/:id/line-items` (instructor) and `/payments/my/invoices/:id/line-items` (client). Errors return `[]` and log (no user-facing error).
- **Subscription always-confirm policy**: every new subscription is created with `payment_behavior: 'default_incomplete'` and the client must confirm via the first invoice's hosted page (saved card or new card). PSD2/SCA + EU Consumer Rights compliance. Trial subs are exempt.
- **Manual status reconciliation**: `POST /payments/onboarding/refresh-status` pulls a live `account.retrieve` from Stripe and updates the local mirror — escape hatch for missed webhooks (localhost dev or dropped delivery).
- **Subscriptions list enrichment**: `listForInstructor` eager-loads `client` (id/name/email/avatar) and `product` (id/name/interval/intervalCount) so the FE table renders names instead of UUIDs.
- **Client billing counts**: `GET /payments/my/counts` returns `{invoices: {total, open}, memberships: {total, active}}` for profile badges.
- See `src/modules/payment/PAYMENT-FLOWS.md` for end-to-end flows

### Client Module
Two tables: `instructor_client` (active relationships) + `client_request` (invitation/request audit trail).
- Bidirectional: instructor invites OR user requests
- Lifecycle: PENDING → ACTIVE (accept) or DECLINED/CANCELLED
- Requests expire after 30 days

### Session Module Shape
Rewritten by migration 046 from a legacy single-table design into a **template + instance** model. Build progress tracked in `docs/research/sessions/SESSIONS_MASTER_BUILD_PLAN.md`.
- **4 entities**: `session_template`, `session_instance`, `session_participant`, `session_reminder_schedule`
- **Two-table semantics**: one template per "class concept"; N instances per template (one for one-off, many for recurring). Each instance owns per-occurrence overrides + denormalised participant counters (`confirmed_count`, `pending_approval_count`, `waitlisted_count`, `attended_count`).
- **Snapshot at booking**: every `session_participant` captures `snapshot_price_cents`, `snapshot_currency`, `snapshot_cancel_cutoff_h`, `snapshot_location_text`, `snapshot_meeting_url` at the moment of booking. Cancellation window math uses the snapshot, not the live template — terms-as-booked are immutable.
- **Recurrence engine**: `RecurrenceService` (Luxon, zone-aware). `daysOfWeek` is **1=Mon..7=Sun (ISO 8601)** — never 0=Sun. Handles DST correctly (preserves local wall-clock).
- **Ownership validation**: when creating/updating a template, **`venueId` and `groupId` are re-validated** against the caller via `VenueService.get` / `GroupService.getById` (which throw 404 on cross-instructor refs via `assertOwned({onMismatch:'hide'})`). Prevents the IDOR documented in `SESSIONS_AUDIT_2026-05-15.md` §2.1.
- **Sanitization**: `title` and `description` go through `stripHtml` (common/utils/text.utils.ts) before persist — drops `<script>`, collapses whitespace. Title rejected if empty after sanitization.
- **Future-date guard**: `firstStartAt` enforced by `@IsFutureOrCloseToNow({skewMinutes:5})` validator + service-level recheck.
- **Notifications**: 7 types declared in `notification-types.ts` with conservative defaults (reminders→push+email, cancel→email+push, participant churn→in-app only). Builders live in `src/modules/session/notifications.ts` — see `SESSION-FLOWS.md` for usage.
- **Reminder schedule rows** are written into `session_reminder_schedule` on booking and dispatched by the `sessions.reminder_dispatch` cron (sweep model; idempotent via `sentAt`).
- See `src/modules/session/SESSION-FLOWS.md` for the per-flow walkthrough.

### Workout Module Shape
One table drives both concepts users see as different things: `program`. `is_single_workout = true` is a **routine** (one repeatable session); `false` is a **multi-week program**. Do not rename either in the UI — users mean different things by them (migration 056 unified the storage, not the vocabulary).
- **Chain**: `exercise` (catalog) → `program` / `program_workout` / `prescribed_exercise` / `prescribed_set` (prescription) → copy-on-assign into `program_assignment` / `assigned_*` → `workout_log` / `logged_*` (what happened) → `one_rep_max`.
- **Provenance** (migration 058): `workout_log.source_program_id`, `logged_exercise.prescribed_exercise_id`, `logged_set.prescribed_set_id` — all nullable, `ON DELETE SET NULL`. A freestyle log has none; that is how "Freestyle" is detected.
- **Starters**: `owner_id IS NULL AND source = 'SYSTEM'` — the ten MotionHive routines from migration 057, readable by everyone. `lastPerformedAt` is deliberately **not** stamped on them: the row is shared across all accounts, so bumping it leaked one user's activity into everyone's list.
- **`program.level`** (`exercise_level` enum, nullable) carries editorial difficulty on curated content only. Filter via `GET /programs?level=BEGINNER`. A user's copy of a starter does not inherit it.
- **Discard vs skip**: `DELETE /workout-logs/:id` deletes an in-progress log outright ("changed my mind"); SKIPPED is a deliberate record that you chose not to train. Discard reverts `assigned_workout.status` to NULL and recomputes `lastPerformedAt`. Refuses on a completed log.
- **Coach privacy**: an instructor sees a client's off-plan logs and post-workout notes **only** when a `program_assignment.share_off_plan` flag allows it — `_visibleAssignmentIds` returns an allow-list, never an exclusion.
- **Completion feedback** arrives on a *second* `POST /workout-logs/:id/complete` after the log is already COMPLETED (the feedback screen runs post-completion), so that path must apply the rating and note rather than returning early.

### Venue Module
Where instructors deliver their service. One instructor has 0..N venues; sessions reference one via `session.venue_id` (nullable, ON DELETE SET NULL).
- **Kinds** (`venue_kind` enum): `GYM`, `STUDIO`, `PARK`, `OUTDOOR`, `CLIENT_HOME`, `ONLINE`, `OTHER`
- **Cross-field rules** enforced by `VenueService.normalizeAndValidate`:
  - `kind=ONLINE` ⇔ `isOnline=true` ⇔ `meetingUrl` required
  - `CLIENT_HOME` stores no address (client's address belongs to the booking); `travelRadiusKm` only applies here
  - Physical kinds require at least `city`
- DB-level CHECK constraints back the `is_online` ⇒ `meetingUrl` rule and the country-code format
- Soft delete (paranoid) + `is_active=false` archive
- Ownership returns 404 (not 403) on cross-instructor access — don't leak existence

### Email Templates
One file per email under `src/common/email/<domain>/<name>.template.ts`. The shared shell + helpers (`baseLayout`, `heading`, `paragraph`, `primaryButton`, `featureItem`, `divider`, etc.) live in `_layouts/base-layout.ts`. `_layouts/audience.ts` is a placeholder for future per-audience theming. Public surface re-exported from `src/common/email/index.ts` — services import from there, not deep paths.

**Security rule:** every user-controlled string interpolated into HTML MUST be escaped with `escapeHtml` from `src/common/utils/html.utils.ts`. New templates go through the same gate.

### Environment Variables
Full schema in `src/config/env.validation.ts` (Joi, `abortEarly: false`).

**Required**: `JWT_SECRET`, `JWT_REFRESH_SECRET` (min 32 chars each), `NODE_ENV`, `PORT`, DB connection (`DATABASE_URL` or `DB_HOST/PORT/USERNAME/PASSWORD`), `BCRYPT_ROUNDS` (10–15, default 12)

**Required in production**: `FRONTEND_URL`, `STRIPE_SECRET_KEY`

**Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (required for payments); `STRIPE_API_VERSION` (default `'2026-03-25.dahlia'`); `DEFAULT_PLATFORM_FEE_BPS` (default 0)

**Optional**: `REDIS_HOST`, `REDIS_PORT`, `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_APP_ID/SECRET`, `CLOUDINARY_*`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `RESEND_API_KEY`

## Known Issues & Technical Debt

- **Jobs module** — live (BullMQ via `@nestjs/bullmq` + `@nestjs/schedule`). Five queues run in-process: `notifications` (email_send), `sessions`, `workouts`, `payments`, `maintenance`.
  - **Pattern**: queue catalog + typed payloads in `src/modules/jobs/job-registry.ts`; producers call `JobsService.enqueue(name, payload, {jobId})`. Single-job queues extend `BaseWorker`; multi-job queues use one `@Processor`-per-queue worker extending `MultiJobWorker` (routes by `job.name`). `@Cron` schedulers under `schedulers/` **only enqueue** — never `setTimeout`, never DB work. Logic lives in domain services (workers are thin). **Invariant: every `QueueName` value must have a `registerQueue` in `jobs.module.ts`** (a dangling enum value crashes boot with "could not find BullQueue_x").
  - **Skip-on-no-Redis** (load-bearing): `JobsModule.register()` reads `REDIS_HOST` at the same point app.module's `forRoot` does; without it, queues still register (inert) but `@Processor` workers are NOT (they'd throw "Worker requires a connection") and `JobsService.enqueue` no-ops + logs. App boots fine; schedulers fire harmlessly.
  - **Live crons** — sessions: reminder_dispatch (5m), status_transition (5m), generate_recurring (daily), cleanup_stale_participants (hourly). workouts: auto_skip_past_workouts (02:00), auto_complete_assignments (02:30). payments: invoice_due_soon/overdue/dunning (06:00–06:30), card_expiring (07:00), refund_window_closing (07:30), dispute_deadline (08:00), earnings_summary (monthly 1st 08:00), balance_cache_refresh (hourly), reconcile_webhooks (30m). maintenance: cleanup_refresh_tokens/lockouts/invitations/client_requests (04:00–04:30). Reminder idempotency is via the `notification.fingerprint` dedup (remind-once or date-bucketed once-per-day), not DB flags.
  - **Webhooks are async**: the Stripe webhook controller verifies + inserts the `webhook_event` row, then enqueues `payments.process_webhook` and acks fast (BullMQ owns retries; `reconcile_webhooks` cron sweeps ORPHANED rows). With no Redis it processes inline. See `webhook-handler.service.ts` (`handleIncomingEvent`/`processQueued`/`processEvent`/`reconcileOrphaned`).
  - **Still pending** (see memory `project_jobs_module_pending.md`): push/SMS notification channels only. The `// TODO [jobs-module]:` markers elsewhere are resolved.
- **Bull Board** — admin UI at `/admin/queues`, HTTP basic auth via `BULL_BOARD_USER` + `BULL_BOARD_PASSWORD` env vars (both required to mount; missing either → route 404s, the "default off" posture). Queues auto-register from `QueueName`, so new queues appear without code changes. Never expose it unauthenticated in prod. Redis prod config: `REDIS_HOST` (required in production), `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TLS` ("true" for managed/Redis Cloud).
- **Notification system** — Phase 1 stub only (logs). See `NOTIFICATION_SYSTEM_PLAN.md`. Research notes for the upcoming jobs/workers system live under `docs/research/jobs-system/`.
- **Session overflow waitlist** — fully live (BE: `SessionWaitlistService` + `WAITLISTED` participant status + auto-promote on confirmed cancel; FE: "Join waitlist" CTA on session-showcase, status surfaced in my-sessions tabs + booking-confirmed dialog). Toggled per-template via `waitlistEnabled`. (Note: the `waitlist` module is for landing-page email capture — different feature.)
- **APPROVAL join policy** — fully live (BE + FE). Owners review pending requests on the group members tab; clients see request status on group preview / discover cards.
- **OAuth account linking** — rejects unverified email/password accounts, but still auto-links OAuth to verified accounts without explicit user consent.
- **Cascade deletes** — no cascade logic when a user is soft-deleted (orphaned groups, sessions, relationships). Venues do cascade from instructor_profile via FK.
- **Group invitation acceptance** — requires a registered account (invitations can be sent to any email but recipient must sign up first).
- **No batch invite** endpoint.
- **Sessions ↔ venues** — picker is live in session-form-dialog + quick-create-popover (conditional on `locationKind = IN_PERSON`). Minor polish gap: no inline "Create venue" CTA when the instructor has zero venues yet — they have to leave the dialog and use the Venues page first.
- **Incomplete modules**: `role` (service-only, no controller, empty `constants/` dir), `notification` (Phase 1 stub for delivery; in-app + email channels live, push/SMS not yet).
- **Test coverage**: 85 suites / 1023 tests. Includes the full jobs stack (notifications/sessions/workouts/payments/maintenance workers + schedulers), payment reminder/balance/dispute services, and async webhook processing + reconciliation. Notably still thin: blog, profile, venue, analytics, feedback, waitlist, search.

## Coding Conventions
- File names: **kebab-case** (`create-user.dto.ts`)
- Classes: **PascalCase + suffix** (`UserService`, `CreateUserDto`)
- Enums: PascalCase with UPPER_SNAKE values (`InstructorClientStatus.ACTIVE`)
- DB columns: snake_case (auto via `underscored: true`)
- Nullable Sequelize fields need `| null` in the type (never `as any`)
- Controllers are thin — business logic in services
- Errors: NestJS built-in exceptions (`NotFoundException`, `ConflictException`, etc.)
- **Always use transactions** for multi-table operations (pass `{ transaction }` to every ORM call)
- **Use `Op.iLike`** (not `Op.like`) for search on PostgreSQL, and escape the term with `escapeLikeWildcards` (common/utils/search.utils) — an unescaped `%` matches every row
- **Use PostgreSQL JSON operators** (`@>`, `?`, `->`) — never MySQL functions (`JSON_CONTAINS`)
- **Pagination limits**: `@Min(1)` and `@Max(100)` on every limit param
- **Never use `any`** — always use strict types; prefer `unknown` + narrowing, or define an explicit interface/type
- **Never commit `console.log`** — use Winston logger
- **Rate limit** sensitive endpoints with `@Throttle()`. The global 300/min/route/user ceiling is a bug-and-bot net, not a policy: a person by hand peaks at ~10/min on one route. **Never fix a 429 by raising it** — a UI action that touches many rows gets a bulk route in one transaction (`copy-week`, `reorder`, `defaultSets` on add-exercise), because a client loop of per-row writes is also non-atomic
- **Webhook handlers**: pass `{ transaction: tx }` to every ORM call inside the handler
- **Stripe writes**: always use `StripeService.buildIdempotencyKey()`; use `buildFeeParams()` for application_fee_amount (never pass explicit 0)
