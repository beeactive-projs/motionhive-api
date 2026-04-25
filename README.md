# BeeActive API

A comprehensive REST API for managing fitness training sessions, trainers, and clients. Built with [NestJS](https://nestjs.com), [Sequelize](https://sequelize.org), and [MySQL](https://www.mysql.com).

**Production URL:** https://beeactive-api-production.up.railway.app  
**Swagger Docs:** https://beeactive-api-production.up.railway.app/api/docs

---

## Documentation

| Document | Description |
|----------|-------------|
| **[USER-FLOWS.md](./USER-FLOWS.md)** | All user flows (auth, profile, groups, invitations, sessions, clients, discovery), recurrence rules, and visibility model. Use it to understand API behaviour and for frontend integration. |
| **[DEPLOY.md](./DEPLOY.md)** | How migrations run on deploy, how to set the start command (e.g. `npm run railway:start`), and what to do if migrations did not run on the server. |
| **Swagger /api/docs** | Interactive API reference (endpoints, request/response schemas). |

---

## Tech Stack

- **Framework:** NestJS (TypeScript)
- **ORM:** Sequelize with MySQL
- **Auth:** Passport.js + JWT (access + refresh tokens)
- **Logging:** Winston (structured JSON logs)
- **Docs:** Swagger / OpenAPI
- **Deployment:** Railway

---

## Project Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your database credentials and secrets

# Run database migrations
cd migrations && sh RUN_MIGRATIONS.sh

# Start in development mode (watch)
npm run start:dev

# Start in production mode
npm run start:prod
```

**Swagger docs** are available at `http://localhost:3000/api/docs`  
**Health check** at `http://localhost:3000/health`

---

## Naming Conventions

### Database: `snake_case`

All database tables and columns use `snake_case`:

```sql
-- Tables
user, group, session_participant, instructor_profile, instructor_client, venue

-- Columns
first_name, last_name, created_at, is_active, country_code, city
```

### API Responses: `camelCase`

All API responses return `camelCase` keys:

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "isActive": true,
  "createdAt": "2026-01-15T10:30:00.000Z",
  "phone": "+40721234567",
  "countryCode": "RO",
  "city": "Bucharest"
}
```

### How It Works

1. **Sequelize `underscored: true`** — maps camelCase model properties (e.g., `firstName`) to snake_case DB columns (e.g., `first_name`) automatically.
2. **`CamelCaseInterceptor`** — a global NestJS interceptor that transforms all response object keys to camelCase. This acts as a safety net to ensure consistency even for manually constructed objects.
3. **Swagger doc examples** — all use camelCase to match the actual API response format.

### Rules

| Layer | Convention | Example |
|-------|-----------|---------|
| Database columns | `snake_case` | `first_name`, `created_at` |
| SQL migrations | `snake_case` | `ALTER TABLE user ADD COLUMN last_login_at` |
| Sequelize model properties | `camelCase` | `firstName`, `createdAt` |
| Sequelize queries | `camelCase` (model property names) | `where: { isActive: true }` |
| DTO properties | `camelCase` | `firstName`, `groupId` |
| API request bodies | `camelCase` | `{ "firstName": "John" }` |
| API responses | `camelCase` | `{ "firstName": "John" }` |
| Swagger examples | `camelCase` | `firstName`, `createdAt` |

---

## Project Structure

```
src/
├── common/                    # Shared utilities
│   ├── decorators/            # Custom decorators (@Public, @Roles, @ApiEndpoint)
│   ├── docs/                  # Swagger documentation (per module)
│   ├── filters/               # Exception filters
│   ├── guards/                # Auth & permission guards
│   ├── interceptors/          # Response interceptors (CamelCaseInterceptor)
│   ├── logger/                # Winston logger config
│   ├── middleware/             # Request ID middleware
│   ├── dto/                   # Shared DTOs (PaginationDto)
│   ├── services/              # Shared services (CryptoService, EmailService)
│   └── validators/            # Custom validators
├── config/                    # App configuration
│   ├── database.config.ts     # Sequelize/MySQL config
│   ├── env.validation.ts      # Environment variable validation (Joi)
│   └── jwt.config.ts          # JWT config
├── modules/
│   ├── auth/                  # Authentication (register, login, refresh, password reset, logout)
│   ├── client/                # Instructor-client relationships
│   ├── group/                 # Groups, members, join links, discovery
│   ├── health/                # Health check endpoint
│   ├── invitation/            # Group invitations
│   ├── profile/               # User & instructor profiles
│   ├── role/                  # RBAC (roles & permissions)
│   ├── session/               # Training sessions (with visibility rules)
│   └── user/                  # User management
├── app.module.ts              # Root module
└── main.ts                    # Application entry point
```

---

## Pagination

All list endpoints support pagination via query parameters:

```
GET /sessions?page=1&limit=20
GET /groups/:id/members?page=2&limit=10
GET /clients?page=1&limit=20&status=ACTIVE
GET /invitations/pending?page=1&limit=50
```

| Parameter | Default | Min | Max | Description |
|-----------|---------|-----|-----|-------------|
| `page` | 1 | 1 | - | Page number (1-indexed) |
| `limit` | 20 | 1 | 100 | Items per page |

All paginated endpoints return a standard response shape:

```json
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "limit": 20,
    "totalItems": 47,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

---

## Email Service

The API includes an `EmailService` foundation with methods for:
- Password reset emails
- Email verification
- Group invitation emails
- Welcome emails

Currently, emails are **logged to console** instead of sent. To activate real sending, install a provider SDK and replace the `send()` method in `src/common/services/email.service.ts`:

```bash
# Option 1: SendGrid
npm install @sendgrid/mail

# Option 2: Resend
npm install resend

# Option 3: AWS SES
npm install @aws-sdk/client-ses
```

Add the API key to `.env`:
```
SENDGRID_API_KEY=SG.xxxxx
# or
RESEND_API_KEY=re_xxxxx
```

---

## Security Features

- JWT access tokens (2h) + refresh tokens (7d)
- bcrypt password hashing (12 rounds)
- Account lockout after 5 failed login attempts
- Rate limiting (global + per-endpoint)
- Helmet security headers
- Strong password enforcement
- Token hashing (SHA-256) before DB storage with timing-safe comparison
- Input validation and sanitization (class-validator + whitelist)
- Environment validation on startup (Joi)
- Global error filter (no stack traces in production)
- Request ID tracking

---

## RBAC System

5 roles: `SUPER_ADMIN`, `ADMIN`, `SUPPORT`, `INSTRUCTOR`, `USER`
Granular permissions with role-permission mapping via junction table.

---

## Environment Variables

See `.env.example` for all required and optional variables.

Key variables:
- `DATABASE_URL` — MySQL connection string
- `JWT_SECRET` — Secret for signing access tokens (required)
- `JWT_REFRESH_SECRET` — Secret for signing refresh tokens (required)
- `JWT_EXPIRES_IN` — Access token lifetime (default: `2h`)
- `JWT_REFRESH_EXPIRES_IN` — Refresh token lifetime (default: `7d`)
- `BCRYPT_ROUNDS` — Password hashing rounds (default: `12`)
- `FRONTEND_URL` — Frontend URL for CORS and email links

---

## License

Private project.
