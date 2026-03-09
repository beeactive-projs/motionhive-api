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
    ├── auth/                  # Register, login, refresh, OAuth, password reset
    ├── user/                  # User entity, /users/me
    ├── role/                  # RBAC: Role, Permission, UserRole entities
    ├── profile/               # UserProfile, InstructorProfile, discovery
    ├── group/                 # Group CRUD, members, join links, discovery
    ├── session/               # Sessions, participants, recurring, visibility
    ├── invitation/            # Group invitations
    ├── client/                # Instructor-client relationships & requests
    ├── blog/                  # Blog posts, Cloudinary image upload
    ├── notification/          # Notification system (Phase 1 — dummy/logger, @Global)
    └── health/                # Terminus health checks
```

### Module Pattern
Each module follows: `module.ts` + `controller.ts` + `service.ts` + `entities/` + `dto/`

### Key Patterns
- **@ApiEndpoint()** decorator wraps Swagger docs consistently (in `common/docs/*.docs.ts`)
- **Guards**: `AuthGuard('jwt')` + `RolesGuard` + `PermissionsGuard`
- **DTOs**: class-validator for input validation, PaginationDto for lists
- **Entities**: Sequelize models with CHAR(36) UUID PKs, `underscored: true`
- **Soft deletes**: paranoid mode on user, group, session, blog_post
- **Transactions**: Sequelize transactions for multi-table operations
- **Pagination**: PrimeNG-compatible format via `buildPaginatedResponse(data, totalItems, page, limit)` → returns `{ items, total, page, pageSize }`
- **Notifications**: Use `NotificationService.notify()` / `notifyMany()` for all notifications (currently logs, will deliver in Phase 2+)

### RBAC
Roles: `SUPER_ADMIN`, `ADMIN`, `SUPPORT`, `INSTRUCTOR`, `USER`
- Use `@Roles('INSTRUCTOR')` + `@UseGuards(AuthGuard('jwt'), RolesGuard)`
- Use `@Public()` for unauthenticated routes

### Database
- PostgreSQL (Neon) via `DATABASE_URL` or individual `DB_*` vars
- Migrations in `/migrations/` (000-007), run with `node migrations/run.js`
- Custom enum types for status fields

### Client Module (Instructor-Client Relationships)
Two tables: `instructor_client` (active relationships) + `client_request` (invitation/request audit trail)
- Bidirectional: instructor invites OR user requests
- Lifecycle: PENDING -> ACTIVE (accept) or DECLINED/CANCELLED
- Requests expire after 30 days

### Environment Variables
Required: `JWT_SECRET`, `JWT_REFRESH_SECRET`
Recommended: `DATABASE_URL`, `PORT`, `FRONTEND_URL` (prod), `RESEND_API_KEY`
Optional: `REDIS_HOST`, `GOOGLE_CLIENT_ID`, `FACEBOOK_APP_ID`, `CLOUDINARY_*`

## Known Issues & Technical Debt

> See `IMPROVEMENT_PLAN.md` for the full detailed plan with file paths, line numbers, and implementation order.

### Critical (Fix Before New Features)
- ~~**PostgreSQL compatibility**: `JSON_CONTAINS` → `@>` jsonb, `Op.like` → `Op.iLike`~~ **FIXED**
- ~~**Wrong email templates**: `sendWelcomeEmail` placeholders~~ **FIXED** — proper templates added
- **OAuth account linking**: Silently links OAuth accounts to existing email/password accounts without user consent — account takeover risk
- ~~**Debug code**: `console.log(req)` in `client.controller.ts`~~ **FIXED**

### Data Integrity
- **Transaction gaps**: `invitation.accept()`, `profile.createInstructorProfile()`, `session.joinSession()`, `session.leaveSession()` perform multi-table operations without transactions
- **Race conditions**: Session capacity check (overbooking), slug generation (duplicates), pending request deduplication
- **Cascade deletes**: No cascade logic when user is soft-deleted (orphaned groups, sessions, relationships)

### Auth
- **Refresh tokens are stateless** — cannot be revoked on logout. Stolen token valid for 7 days
- **No refresh token rotation** — same token reused for entire lifetime
- ~~**Password reset doesn't clear lockout**~~ **FIXED** — now clears `failedLoginAttempts` and `lockedUntil`
- ~~**`lastLoginAt` never updated**~~ **FIXED** — now set on successful login

### Missing Infrastructure
- **Job system**: Bull/Redis imported but no processors exist. No session reminders, no auto status transitions, no recurring session generation, no expiry cleanup
- **Notification system**: Phase 1 dummy module created (logs only). See `NOTIFICATION_SYSTEM_PLAN.md` for full plan
- **APPROVAL join policy**: Exists in enum but not implemented (dead code path)
- **Waitlist**: Sessions return "full" with no waitlist option

### API Gaps
- No change password endpoint
- No batch invite endpoint
- No session rescheduling (must delete + recreate)
- No calendar view endpoint
- No analytics/stats endpoints
- Group invitations don't support non-registered users (unlike client invitations which do)
- ~~Missing pagination validation~~ **FIXED** — PaginationDto has `@Min(1)` and `@Max(100)`, PrimeNG-compatible format
- Missing rate limiting on join, invite, and delete endpoints

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
