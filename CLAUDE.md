# MotionHive API

> **Naming note:** The product is **MotionHive**. The repo directory is still `beeactive-api` (historical, not renamed to avoid breaking IDE workspaces, git remotes, and absolute paths). Code identifiers, Stripe metadata (`platform: 'beeactive'`), DB column names, and email template variables also still use "beeactive" — **intentionally, do not mass-rename**. Stripe stores that metadata on live records and a sed-rename would desync production state. A rename is a dedicated future sprint, not incidental cleanup.

## Project Overview
Fitness platform REST API built with NestJS. Manages instructors, clients, groups, sessions, profiles, blog, and Stripe Connect payments.

## Tech Stack
- **Framework**: NestJS 11 (TypeScript, ES2023)
- **ORM**: Sequelize 6 (sequelize-typescript) + PostgreSQL (Neon, driver: `pg`)
- **Auth**: Passport JWT (@nestjs/jwt 11), bcrypt, Google/Facebook OAuth
- **Queue**: Bull + @nestjs/bull (imported, **no processors active yet**)
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
│   ├── utils/                 # Pure helpers (html.utils:escapeHtml)
│   └── validators/            # StrongPasswordValidator
└── modules/
    ├── auth/         # Register, login, refresh, OAuth, password reset, change password, email verification (POST /auth/resend-verification)
    ├── user/         # User entity (with country_code + city), /users/me, GDPR data export
    ├── role/         # RBAC: Role, Permission, UserRole entities (service-only, no controller)
    ├── profile/      # InstructorProfile (location lives on user, not duplicated), discovery, unified update
    ├── group/        # CRUD, members, join links, discovery, ownership transfer, stats
    ├── session/      # CRUD, participants, recurring, visibility, reschedule, calendar, conflicts (FK to venue)
    ├── invitation/   # Group invitations
    ├── client/       # Instructor-client relationships & requests
    ├── blog/         # Blog posts, Cloudinary image upload, sitemap
    ├── analytics/    # Instructor summary, user activity, platform stats
    ├── notification/ # Phase 1 stub (@Global, logs only) — see NOTIFICATION_SYSTEM_PLAN.md
    ├── payment/      # Stripe Connect (8 entities, 10 services, 3 controllers, multi-country)
    ├── venue/        # Where instructors deliver sessions (gym/studio/park/online/client-home/other)
    ├── feedback/     # Public feedback (no userId from body — JWT-derived; submitter-supplied email)
    ├── waitlist/     # Landing-page email capture (NOT session overflow waitlist — that still doesn't exist)
    ├── search/       # Global search (search_doc index + GET /search) — see migration 029
    └── health/       # Terminus health checks, app config (controller-only, no service)
```

### Global Pipeline (wired in main.ts + app.module.ts)
- **Global filter**: HttpExceptionFilter
- **Global interceptor**: CamelCaseInterceptor (APP_INTERCEPTOR)
- **Global guard**: ThrottlerGuard (APP_GUARD, default 100 req/60s)
- **Global pipe**: ValidationPipe (whitelist + transform)
- **Middleware**: RequestIdMiddleware on all routes
- **Security**: Helmet, CORS (explicit origin list), `express.raw()` scoped to `/webhooks/stripe`

### Module Pattern
`module.ts` + `controller.ts` + `service.ts` + `entities/` + `dto/`. Controllers are thin; business logic lives in services.

### Key Patterns
- **`@ApiEndpoint()`** decorator centralizes Swagger docs — doc objects live in `common/docs/*.docs.ts`
- **Guards**: `AuthGuard('jwt')` + `RolesGuard` + `PermissionsGuard`
- **DTOs**: class-validator for input, PaginationDto for lists
- **Entities**: Sequelize models with CHAR(36) UUID PKs, `underscored: true`
- **Soft deletes**: paranoid mode on user, group, session, blog_post
- **Transactions**: all multi-table operations wrap in a transaction. Webhook handlers receive `tx` from the caller and **every ORM call inside MUST pass `{ transaction: tx }`**. Controller-level services may call Stripe before saving locally (Stripe is source of truth; webhooks reconcile drift).
- **Pagination**: PrimeNG-compatible via `buildPaginatedResponse(data, totalItems, page, limit)` → `{ items, total, page, pageSize }`. This shape is a **frontend contract** — do not change.
- **Notifications**: use `NotificationService.notify()` / `notifyMany()` everywhere. Currently logs only; Phase 2 will deliver.
- **Stripe**:
  - `StripeService.buildFeeParams()` for `application_fee_amount` — **omits the field entirely when 0**, never passes an explicit `0`
  - `StripeService.buildIdempotencyKey()` required on all write operations
  - Webhook raw body preserved via `express.raw()` middleware scoped to `/webhooks/stripe` in main.ts
  - `webhook_event` table has UNIQUE on `stripe_event_id` → idempotent replays

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
- **8 entities**: `payment`, `invoice`, `product`, `subscription`, `stripe_account`, `stripe_customer`, `payment_consent`, `webhook_event`
- **3 controllers**: `PaymentController` (INSTRUCTOR), `PaymentClientController` (USER), `PaymentWebhookController` (@Public, raw body)
- **10 services**: `StripeService`, `ConnectService`, `CustomerService`, `ProductService`, `InvoiceService`, `CheckoutService`, `SubscriptionService`, `RefundService`, `EarningsService`, `WebhookHandlerService`
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

- **Jobs module missing** — Bull and ScheduleModule are imported but no processors/cron exist. Blocks: session reminders, auto status transitions, recurring session generation, expiry cleanup, orphaned webhook reconciliation, invoice due-soon reminders, dunning, earnings summaries. See memory `project_jobs_module_pending.md`.
- **Notification system** — Phase 1 stub only (logs). See `NOTIFICATION_SYSTEM_PLAN.md`. Research notes for the upcoming jobs/workers system live under `docs/research/jobs-system/`.
- **Session overflow waitlist** — still not implemented. Full sessions return "full" with no queue. (Note: the `waitlist` module that exists is for landing-page email capture, unrelated.)
- **APPROVAL join policy** — exists in enum, not implemented (dead code path).
- **OAuth account linking** — rejects unverified email/password accounts, but still auto-links OAuth to verified accounts without explicit user consent.
- **Cascade deletes** — no cascade logic when a user is soft-deleted (orphaned groups, sessions, relationships). Venues do cascade from instructor_profile via FK.
- **Group invitation acceptance** — requires a registered account (invitations can be sent to any email but recipient must sign up first).
- **No batch invite** endpoint.
- **Sessions ↔ venues** — `session.venue_id` exists at the DB level but the FE session create/edit form doesn't surface a venue picker yet.
- **Incomplete modules**: `health` (controller-only, no service logic), `role` (service-only, no controller, empty `constants/` dir), `notification` (Phase 1 stub).
- **Test coverage**: 9 suites / 78 tests (crypto, auth.service, user.service, 3 payment services, webhook-handler, profile, venue, html-utils, etc.). Still thin — no controller-level integration tests.

## Coding Conventions
- File names: **kebab-case** (`create-user.dto.ts`)
- Classes: **PascalCase + suffix** (`UserService`, `CreateUserDto`)
- Enums: PascalCase with UPPER_SNAKE values (`InstructorClientStatus.ACTIVE`)
- DB columns: snake_case (auto via `underscored: true`)
- Nullable Sequelize fields need `| null` in the type (never `as any`)
- Controllers are thin — business logic in services
- Errors: NestJS built-in exceptions (`NotFoundException`, `ConflictException`, etc.)
- **Always use transactions** for multi-table operations (pass `{ transaction }` to every ORM call)
- **Use `Op.iLike`** (not `Op.like`) for search on PostgreSQL
- **Use PostgreSQL JSON operators** (`@>`, `?`, `->`) — never MySQL functions (`JSON_CONTAINS`)
- **Pagination limits**: `@Min(1)` and `@Max(100)` on every limit param
- **Never use `any`** — always use strict types; prefer `unknown` + narrowing, or define an explicit interface/type
- **Never commit `console.log`** — use Winston logger
- **Rate limit** sensitive endpoints with `@Throttle()`
- **Webhook handlers**: pass `{ transaction: tx }` to every ORM call inside the handler
- **Stripe writes**: always use `StripeService.buildIdempotencyKey()`; use `buildFeeParams()` for application_fee_amount (never pass explicit 0)
