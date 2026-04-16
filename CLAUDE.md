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
│   ├── interceptors/          # CamelCaseInterceptor (APP_INTERCEPTOR)
│   ├── middleware/            # RequestIdMiddleware (applied to all routes)
│   ├── services/              # CloudinaryService, CryptoService, EmailService
│   └── validators/            # StrongPasswordValidator
└── modules/
    ├── auth/         # Register, login, refresh, OAuth, password reset, change password, email verification
    ├── user/         # User entity, /users/me, GDPR data export
    ├── role/         # RBAC: Role, Permission, UserRole entities (service-only, no controller)
    ├── profile/      # UserProfile, InstructorProfile, discovery, unified update
    ├── group/        # CRUD, members, join links, discovery, ownership transfer, stats
    ├── session/      # CRUD, participants, recurring, visibility, reschedule, calendar, conflicts
    ├── invitation/   # Group invitations
    ├── client/       # Instructor-client relationships & requests
    ├── blog/         # Blog posts, Cloudinary image upload, sitemap
    ├── analytics/    # Instructor summary, user activity, platform stats
    ├── notification/ # Phase 1 stub (@Global, logs only) — see NOTIFICATION_SYSTEM_PLAN.md
    ├── payment/      # Stripe Connect (7 entities, 10 services, 3 controllers)
    ├── feedback/     # User feedback collection
    ├── waitlist/     # Landing-page email capture (NOT session overflow waitlist — that still doesn't exist)
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
- Migrations in `/migrations/` (**001–019**), run with `node migrations/run.js`
- Custom enum types for status fields
- CHAR(36) UUID primary keys everywhere

### Payment Module Shape
- **7 entities**: `payment`, `invoice`, `product`, `subscription`, `stripe_account`, `stripe_customer`, `payment_consent`, `webhook_event`
- **3 controllers**: `PaymentController` (INSTRUCTOR), `PaymentClientController` (USER), `PaymentWebhookController` (@Public, raw body)
- **10 services**: `StripeService`, `ConnectService`, `CustomerService`, `ProductService`, `InvoiceService`, `CheckoutService`, `SubscriptionService`, `RefundService`, `EarningsService`, `WebhookHandlerService`
- Country hardcoded `'RO'` for Connect accounts (v1)
- Platform fee: 0 bps default, configurable per-instructor via `stripe_account.platform_fee_bps`
- 14-day refund window enforced in `RefundService`
- EU consumer rights (OUG 34/2014) waiver recorded in `payment_consent` table
- See `src/modules/payment/PAYMENT-FLOWS.md` for end-to-end flows

### Client Module
Two tables: `instructor_client` (active relationships) + `client_request` (invitation/request audit trail).
- Bidirectional: instructor invites OR user requests
- Lifecycle: PENDING → ACTIVE (accept) or DECLINED/CANCELLED
- Requests expire after 30 days

### Environment Variables
Full schema in `src/config/env.validation.ts` (Joi, `abortEarly: false`).

**Required**: `JWT_SECRET`, `JWT_REFRESH_SECRET` (min 32 chars each), `NODE_ENV`, `PORT`, DB connection (`DATABASE_URL` or `DB_HOST/PORT/USERNAME/PASSWORD`), `BCRYPT_ROUNDS` (10–15, default 12)

**Required in production**: `FRONTEND_URL`, `STRIPE_SECRET_KEY`

**Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (required for payments); `STRIPE_API_VERSION` (default `'2026-03-25.dahlia'`); `DEFAULT_PLATFORM_FEE_BPS` (default 0)

**Optional**: `REDIS_HOST`, `REDIS_PORT`, `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_APP_ID/SECRET`, `CLOUDINARY_*`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `RESEND_API_KEY`

## Known Issues & Technical Debt

- **Jobs module missing** — Bull and ScheduleModule are imported but no processors/cron exist. Blocks: session reminders, auto status transitions, recurring session generation, expiry cleanup, orphaned webhook reconciliation, invoice due-soon reminders, dunning, earnings summaries. See memory `project_jobs_module_pending.md`.
- **Notification system** — Phase 1 stub only (logs). See `NOTIFICATION_SYSTEM_PLAN.md`.
- **Session overflow waitlist** — still not implemented. Full sessions return "full" with no queue. (Note: the `waitlist` module that exists is for landing-page email capture, unrelated.)
- **APPROVAL join policy** — exists in enum, not implemented (dead code path).
- **OAuth account linking** — rejects unverified email/password accounts, but still auto-links OAuth to verified accounts without explicit user consent.
- **Cascade deletes** — no cascade logic when a user is soft-deleted (orphaned groups, sessions, relationships).
- **Group invitation acceptance** — requires a registered account (invitations can be sent to any email but recipient must sign up first).
- **No batch invite** endpoint.
- **Incomplete modules**: `health` (controller-only, no service logic), `role` (service-only, no controller, empty `constants/` dir), `notification` (Phase 1 stub).
- **Test coverage thin**: 6 spec files total (crypto, auth.service, user.service, and 3 payment services).

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
- **Never commit `console.log`** — use Winston logger
- **Rate limit** sensitive endpoints with `@Throttle()`
- **Webhook handlers**: pass `{ transaction: tx }` to every ORM call inside the handler
- **Stripe writes**: always use `StripeService.buildIdempotencyKey()`; use `buildFeeParams()` for application_fee_amount (never pass explicit 0)
