# BeeActive API

## Project Overview
Fitness platform REST API built with NestJS. Manages instructors, clients, groups, sessions, and profiles.

## Tech Stack
- **Framework**: NestJS 11 (TypeScript, ES2023)
- **ORM**: Sequelize (sequelize-typescript) with PostgreSQL (Neon)
- **Auth**: JWT (Passport), bcrypt, Google/Facebook OAuth
- **Queue**: Bull (Redis)
- **Email**: Resend
- **Images**: Cloudinary
- **Docs**: Swagger/OpenAPI at `/api/docs`
- **Logging**: Winston
- **Payments**: Stripe Connect Express (invoices, subscriptions, refunds, earnings)
- **Security**: Helmet, Throttler (rate limiting), CORS

## Commands
```bash
npm run start:dev        # Development with watch
npm run build            # Build to dist/
npm run start:prod       # Production
npm run lint             # ESLint fix
npm run migrate          # Run migrations
npm run railway:start    # Build + migrate --safe + start (Railway deploy)
npm test                 # Jest tests
```

## Architecture

### Directory Structure
```
src/
├── main.ts                    # Bootstrap, Swagger setup, CORS
├── app.module.ts              # Root module
├── config/                    # Database, JWT, env validation (Joi)
├── common/
│   ├── decorators/            # @ApiEndpoint, @Public, @Roles, @Permissions
│   ├── docs/                  # Per-module Swagger doc objects
│   ├── dto/                   # Shared DTOs (PaginationDto)
│   ├── filters/               # Global HttpExceptionFilter
│   ├── guards/                # RolesGuard, PermissionsGuard
│   ├── interceptors/          # CamelCaseInterceptor
│   ├── middleware/             # RequestIdMiddleware
│   ├── services/              # CloudinaryService, CryptoService, EmailService
│   └── validators/            # StrongPasswordValidator
└── modules/
    ├── auth/                  # Register, login, refresh, OAuth, password reset, change password
    ├── user/                  # User entity, /users/me, GDPR data export
    ├── role/                  # RBAC: Role, Permission, UserRole entities
    ├── profile/               # UserProfile, InstructorProfile, discovery
    ├── group/                 # Group CRUD, members, join links, discovery, ownership transfer, stats
    ├── session/               # Sessions, participants, recurring, visibility, reschedule, calendar
    ├── invitation/            # Group invitations
    ├── client/                # Instructor-client relationships & requests
    ├── blog/                  # Blog posts, Cloudinary image upload
    ├── analytics/             # Instructor summary, user activity, platform stats
    ├── notification/          # Notification system (Phase 1 — dummy/logger, @Global)
    ├── payment/               # Stripe Connect payments, invoices, subscriptions, refunds, earnings
    └── health/                # Terminus health checks, app config
```

### Module Pattern
Each module follows: `module.ts` + `controller.ts` + `service.ts` + `entities/` + `dto/`

### Key Patterns
- **@ApiEndpoint()** decorator wraps Swagger docs consistently (in `common/docs/*.docs.ts`)
- **Guards**: `AuthGuard('jwt')` + `RolesGuard` + `PermissionsGuard`
- **DTOs**: class-validator for input validation, PaginationDto for lists
- **Entities**: Sequelize models with CHAR(36) UUID PKs, `underscored: true`
- **Soft deletes**: paranoid mode on user, group, session, blog_post
- **Transactions**: Sequelize transactions for multi-table operations. Webhook handlers receive `tx` from the caller — every ORM call inside MUST pass `{ transaction: tx }`. Controller-level services that call Stripe before saving locally are acceptable (Stripe is source of truth; webhooks reconcile drift).
- **Pagination**: PrimeNG-compatible format via `buildPaginatedResponse(data, totalItems, page, limit)` → returns `{ items, total, page, pageSize }`
- **Notifications**: Use `NotificationService.notify()` / `notifyMany()` for all notifications (currently logs, will deliver in Phase 2+)
- **Stripe patterns**: `StripeService.buildFeeParams()` for application_fee_amount (OMIT when 0, never pass explicit 0). `StripeService.buildIdempotencyKey()` for all write operations. Webhook raw body preserved via `express.raw()` middleware scoped to `/webhooks/stripe` in `main.ts`.

### RBAC
Roles: `SUPER_ADMIN`, `ADMIN`, `SUPPORT`, `INSTRUCTOR`, `USER`
- Use `@Roles('INSTRUCTOR')` + `@UseGuards(AuthGuard('jwt'), RolesGuard)`
- Use `@Public()` for unauthenticated routes

### Database
- PostgreSQL (Neon) via `DATABASE_URL` or individual `DB_*` vars
- Migrations in `/migrations/` (000-013), run with `node migrations/run.js`
- Custom enum types for status fields

### Client Module (Instructor-Client Relationships)
Two tables: `instructor_client` (active relationships) + `client_request` (invitation/request audit trail)
- Bidirectional: instructor invites OR user requests
- Lifecycle: PENDING -> ACTIVE (accept) or DECLINED/CANCELLED
- Requests expire after 30 days

### Environment Variables
Required: `JWT_SECRET`, `JWT_REFRESH_SECRET`
Recommended: `DATABASE_URL`, `PORT`, `FRONTEND_URL` (prod), `RESEND_API_KEY`
Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (required for payments); `STRIPE_API_VERSION` (default '2026-03-25.dahlia'), `DEFAULT_PLATFORM_FEE_BPS` (default 0)
Optional: `REDIS_HOST`, `REDIS_PORT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `CLOUDINARY_*`, `BCRYPT_ROUNDS`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `EMAIL_FROM`, `EMAIL_FROM_NAME`

## Known Issues & Technical Debt

> See `IMPROVEMENT_PLAN.md` for the full detailed plan with file paths, line numbers, and implementation order.

### Remaining Issues
- **OAuth account linking**: Partially fixed — rejects unverified email/password accounts, but still auto-links OAuth to verified accounts without explicit user consent
- **Cascade deletes**: No cascade logic when user is soft-deleted (orphaned groups, sessions, relationships)
- **Job system**: Bull/Redis imported but no processors exist. No session reminders, no auto status transitions, no recurring session generation, no expiry cleanup. Payment features also need jobs for: orphaned webhook reconciliation, invoice due-soon reminders, dunning, earnings summaries (see `project_jobs_module_pending.md` in memory)
- **Notification system**: Phase 1 dummy module created (logs only). See `NOTIFICATION_SYSTEM_PLAN.md` for full plan
- **APPROVAL join policy**: Exists in enum but not implemented (dead code path)
- **Waitlist**: Sessions return "full" with no waitlist option
- No batch invite endpoint
- Group invitation acceptance requires a registered account (invitations can be sent to any email)

### Previously Fixed (Sprints 1-7)
- ~~PostgreSQL compatibility~~ **FIXED** — `@>` jsonb, `Op.iLike`
- ~~Wrong email templates~~ **FIXED** — proper templates added
- ~~Debug console.log~~ **FIXED**
- ~~Transaction gaps~~ **FIXED** — all multi-table operations now use transactions
- ~~Race conditions~~ **FIXED** — pessimistic locking on session capacity, retry on slug uniqueness
- ~~Stateless refresh tokens~~ **FIXED** — DB-backed with rotation and revocation
- ~~No change password~~ **FIXED** — `PATCH /auth/change-password` with `passwordChangedAt` invalidation
- ~~No session rescheduling~~ **FIXED** — `PATCH /sessions/:id/reschedule`
- ~~No calendar view~~ **FIXED** — `GET /sessions/calendar`
- ~~No analytics~~ **FIXED** — full analytics module (instructor summary, user activity, platform stats)
- ~~Missing rate limiting~~ **FIXED** — `@Throttle()` on all sensitive endpoints
- ~~Pagination validation~~ **FIXED** — PrimeNG-compatible `{ items, total, page, pageSize }`
- ~~Password reset lockout~~ **FIXED** — clears `failedLoginAttempts` and `lockedUntil`
- ~~lastLoginAt~~ **FIXED** — set on successful login

## Coding Conventions
- File names: kebab-case (`create-user.dto.ts`)
- Classes: PascalCase + suffix (`UserService`, `CreateUserDto`)
- Enums: PascalCase with UPPER_SNAKE values (`InstructorClientStatus.ACTIVE`)
- DB columns: snake_case (auto via `underscored: true`)
- Nullable Sequelize fields need `| null` type (not `as any`)
- Controllers are thin - business logic lives in services
- Errors: use NestJS built-in exceptions (`NotFoundException`, `ConflictException`, etc.)
- **Always use transactions** for multi-table operations (pass `{ transaction }` to each call)
- **Use `Op.iLike`** (not `Op.like`) for search queries on PostgreSQL
- **Use PostgreSQL JSON operators** (`@>`, `?`, `->`) not MySQL functions (`JSON_CONTAINS`)
- **Add `@Min(1)` and `@Max(100)`** to all pagination limit parameters
- **Never commit debug console.log** statements — use Winston logger instead
- **Rate limit** sensitive endpoints with `@Throttle()` decorator
