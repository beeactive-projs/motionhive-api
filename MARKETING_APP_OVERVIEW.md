# MotionHive — Full App Overview for Marketing

> Domain: **motionhive.fit**

> Purpose: give a marketing/content AI a complete mental model of what MotionHive actually does today — who uses it, what they can do, and how the pieces fit together. Structure-first, no code.

---

## 1. What MotionHive Is

A community fitness platform that connects **people who lead activities** (instructors, coaches, club organizers) with **people who show up to them** (clients, participants). One app for both sides.

It replaces the usual chaos of WhatsApp groups + spreadsheets + DMs + separate payment tools with a single place to run a fitness community: groups, sessions, clients, invoices, subscriptions.

**Core promise**: "The hive is open — for those who lead and those who show up."

**Market position**: sits between "just use WhatsApp" (too messy) and "pay €200/mo for Mindbody" (too heavy). Built for the coach with 15–50 regulars.

**Geography**: Multi-country from day one — Stripe Connect supports 46 countries; the instructor's `user.countryCode` drives both the Connect account country and the payout currency. EU consumer-rights compliance (OUG 34/2014) built in for EU residents.

---

## 2. User Roles

| Role | Who they are | What they do |
|---|---|---|
| **USER / Participant** | Person who joins groups, attends sessions, pays invoices | Discover instructors and groups, join sessions, manage own profile, pay invoices, manage subscriptions |
| **INSTRUCTOR** | Coach, trainer, club organizer, studio owner | Create groups and sessions, manage clients, issue invoices, sell subscriptions, view earnings, publish blog posts about their practice |
| **WRITER** | Internal content role | Create and edit blog posts |
| **SUPPORT** | Customer support | (Role exists in RBAC; no dedicated UI yet) |
| **ADMIN / SUPER_ADMIN** | Platform operators | Super-admin dashboard: users list, groups list, platform stats |

A user can hold multiple roles. A USER can become an INSTRUCTOR from inside the app ("Become instructor" flow) — this creates the instructor profile and adds the INSTRUCTOR role without a re-signup.

---

## 3. The Big Feature Map

Everything below is **live in the codebase today** unless marked otherwise.

### 3.1 Auth & Account
- Email + password signup with strong-password validation
- Email verification
- Login with JWT (2h access + 7d refresh, DB-backed rotation)
- Google OAuth, Facebook OAuth
- Forgot password / reset password
- Change password (invalidates existing tokens)
- Rate-limited on all sensitive endpoints
- GDPR data export (`/users/me/data-export`)

### 3.2 Profiles
- **User profile**: personal info (name, phone, country, city, avatar)
- **Instructor profile**: bio, specialties, experience, photo, discoverable card
- Unified profile update endpoint (PATCH multiple sections in one call)
- Instructor discovery: participants can search/filter instructors
- "Become an instructor" upgrade flow for existing users

### 3.3 Groups
- Instructor-owned groups (e.g. "Tuesday Running Club", "Morning Yoga")
- Create/edit/delete, soft-deleted (recoverable)
- Members list with roles inside the group
- Tags for discovery (PostgreSQL JSON tag search)
- Join policies: `OPEN` (self-join), `INVITE_ONLY` (link or invitation); `APPROVAL` exists in the enum but is not yet wired
- Public group profile page
- Join links (shareable URL, token-based)
- Group discovery / search
- Group ownership transfer
- Group stats (member count, session count, activity)
- Health-data sharing consent per member

### 3.4 Sessions (Classes / Training Events)
- Create one-off or recurring sessions attached to a group
- Capacity, location, date/time, description
- Visibility rules:
  - `PUBLIC` — anyone
  - `GROUP` — group members only
  - `CLIENTS` — instructor's clients only
  - `PRIVATE` — instructor only
- Join / leave, with pessimistic locking so capacity can't be over-booked
- Participant status (registered, attended, no-show, etc.)
- Reschedule with notifications
- Calendar view endpoint
- Conflict detection (overlapping sessions for same instructor)
- Session discovery with filters (activity type, time, location)
- Sessions return "full" with no waitlist yet (known gap)

### 3.5 Invitations (Group)
- Instructor invites a user (registered or external email) to a group
- Accept / decline / cancel / resend
- Invitations to external emails are held until that email registers (linking on signup)

### 3.6 Client Relationships (Instructor ↔ User)
Two tables: `instructor_client` (the active relationship) + `client_request` (the audit trail of how it got there).

- **Invite flow**: instructor invites a user to be their client
- **Request flow**: user requests an instructor
- Both go PENDING → ACTIVE on accept, or DECLINED / CANCELLED
- Requests expire after 30 days
- Instructor keeps per-client notes
- Client relationship unlocks visibility of `CLIENTS`-only sessions

### 3.7 Blog
- Writer (or instructor with the role) creates HTML blog posts
- Categories: Product, Community, Fitness, Founders, Guide, Insight
- Server-side pagination, category filter, search (title / excerpt / tags)
- Cover images on Cloudinary
- Public at `/blog`; detail at `/blog/:slug`

### 3.8 Notifications
- Central service used by every feature that should notify someone
- Phase 1 (current): logs notifications, does not yet deliver them to inbox/push
- Phase 2+: email, in-app inbox, push (not built yet)

### 3.9 Analytics
- **Instructor summary**: their clients, groups, sessions, revenue snapshot
- **User activity**: the current user's own participation history
- **Platform stats** (super-admin): totals across the platform

### 3.10 Feedback & Waitlist
- **Feedback**: in-app modal, logged-in or guest, captures bug reports / suggestions
- **Waitlist**: pre-launch signup (`POST /waitlist`) with role (leader/participant), source tracking, duplicate-email protection, public count endpoint

### 3.11 Payments & Invoicing (Stripe Connect Express)
Full module — this is the biggest recent addition. See section 4 for the role-by-role breakdown.

### 3.12 Health & Ops
- Terminus health checks
- App config endpoint (feature flags / public config for the FE)
- Global rate limiting, request IDs, structured Winston logs, Helmet, CORS

---

## 4. Payments — Role-by-Role

MotionHive uses **Stripe Connect Express**: instructors onboard via Stripe-hosted KYC; MotionHive never sees card data or banking info. Platform fee is 0% today, configurable per-instructor.

### 4.1 Instructor can…

**Onboarding**
- Start Stripe onboarding → land on Stripe-hosted KYC (ID, IBAN, etc.)
- See account status (charges enabled, payouts enabled, what's missing)
- Open the Stripe Express Dashboard in one click

**Products / Price list** (their services priced for sale)
- Create a product (one-off OR recurring subscription)
- List, update, soft-delete products

**Invoices**
- Send an invoice to a registered client OR to any external email (guest invoicing)
- See the Stripe-hosted invoice page + branded PDF
- Finalize & send via Stripe email
- Void an unpaid invoice
- Mark an invoice as paid "out of band" (cash / bank transfer, no fees)
- Refund a paid invoice, full or partial, within 14 days

**Subscriptions**
- Put a client on a recurring plan (monthly memberships, etc.)
- Cancel at period-end (default) or immediately
- Trial periods supported
- Can't start subs until Stripe onboarding is complete

**Earnings dashboard**
- Lifetime total, month-to-date, outstanding, paginated payment history

**Blocked until onboarding completes**: cannot create invoices or subscriptions until Stripe confirms `charges_enabled`.

### 4.2 Client / Participant can…

- See their own invoices (only OPEN and PAID — not drafts)
- Open an invoice detail page with the Stripe-hosted pay URL + PDF
- Pay via the Stripe-hosted page (cards + 3DS handled by Stripe)
- Save a card for future use (Stripe SetupIntent)
- Open the Stripe Customer Portal to manage saved cards and subscriptions
- See their active subscriptions
- On EU-regulated digital services: accept an immediate-access waiver checkbox before paying (Romanian OUG 34/2014)

### 4.3 Guest (no account) can…
- Receive an invoice by email (instructor invoiced their email)
- Pay via the Stripe-hosted page without signing up
- If the guest later registers with that email, their payment history auto-links to their new account

### 4.4 Admin / Support
- No dedicated payment UI yet. Reconciliation today relies on Stripe Dashboard + webhook handlers.

### 4.5 Automatic (no human action)
Stripe webhooks keep the local DB in sync:
- Instructor account state (ready, restricted, deauthorized)
- Invoice lifecycle (created, finalized, paid, voided, payment failed)
- Subscription lifecycle (created, updated, trial ending, canceled)
- Payment attempts (succeeded / failed)
- Refunds
- Disputes & payouts (logged today, alerts in future)

Every webhook is signature-verified, idempotent (unique Stripe event ID), and wrapped in a DB transaction.

---

## 5. Frontend Structure (Angular + PrimeNG)

The web app splits routes by role. Every route below is guarded by the role shown.

### 5.1 Public pages (no login)
- Landing / marketing pages
- `/blog` + `/blog/:slug`
- `/auth/sign-up`, `/auth/login`, `/auth/reset-password`, `/auth/new-password`
- `/auth/facebook-callback`, Google callback
- Waitlist dialog (modal on landing)
- Feedback dialog (globally available)

### 5.2 Shared (any logged-in user)
- `/profile` — unified profile editor (personal, instructor-if-applicable)
- `/join/:token` — accept a group invite link

### 5.3 Instructor routes (`instructorGuard`)
- `/dashboard` — instructor home
- `/clients` — client list, invite client, edit notes
- `/groups` + `/groups/:id` — groups CRUD + group detail (members, sessions)
- **Payments**
  - `/payments` — Stripe onboarding card + status
  - `/payments/products` — price list manager
  - `/payments/invoices` + `/payments/invoices/:id` — invoice list + detail
  - `/payments/subscriptions` — subscription list + create
  - `/payments/earnings` — earnings dashboard
  - `/payments/onboarding/return` + `/onboarding/refresh` — Stripe redirect landing pages

### 5.4 Participant routes (`participantGuard`)
- `/user/dashboard` — participant home
- `/user/instructors` — my instructors + discover instructors
- **Payments**
  - `/user/invoices` + `/user/invoices/:id` — my invoices
  - `/user/subscriptions` — my subscriptions + Customer Portal link
  - `/user/checkout/return` — post-payment landing page

### 5.5 Writer routes (`writerGuard`)
- `/writer/posts` — blog post list
- `/writer/posts/new`, `/writer/posts/:slug` — create/edit

### 5.6 Super-admin routes (`superAdminGuard`)
- `/super-admin/dashboard` — platform stats
- `/super-admin/users` — user management
- `/super-admin/groups` — group management

### 5.7 Cross-cutting UI
- Sidenav layout with role-aware menu
- Theme toggle (dark / light)
- Profile menu
- Error dialog, feedback dialog, waitlist dialog
- PrimeNG tables with server-side pagination (`{ items, total, page, pageSize }`)

---

## 6. Backend Structure (NestJS + Sequelize + PostgreSQL)

One module per feature. Each module = controller + service + entities + DTOs.

| Module | Responsibility |
|---|---|
| `auth` | Register, login, refresh, OAuth, password reset, change password, email verification |
| `user` | User entity, `/users/me`, GDPR data export |
| `role` | RBAC: roles, permissions, user-role links, guards, decorators |
| `profile` | User profile + instructor profile + discovery + unified update |
| `group` | Group CRUD, members, join links, discovery, ownership transfer, stats |
| `session` | Sessions, participants, recurring rules, visibility, reschedule, calendar |
| `invitation` | Group invitations (send / accept / decline / cancel / resend) |
| `client` | Instructor ↔ client relationships + request audit trail |
| `blog` | Blog posts, Cloudinary uploads, seed posts |
| `analytics` | Instructor summary, user activity, platform stats |
| `notification` | Central notify service (@Global, Phase 1 = logs) |
| `payment` | Stripe Connect — 3 controllers (instructor, client, webhook), 10 services, 8 entities |
| `feedback` | User feedback form |
| `waitlist` | Pre-launch signups |
| `health` | Terminus health checks + app config |

**Global cross-cutting**: Helmet, CORS, rate limiting (Throttler), Winston logging, request ID middleware, camelCase response interceptor, global exception filter.

**Infra hooks**: Bull + Redis imported, `ScheduleModule` imported — but **no queue processors or cron jobs run yet** (session reminders, dunning, recurring generation, etc. are pending).

---

## 7. Status Cheat-Sheet (what's live vs. pending)

### Live and usable today
- Full auth stack (email+pw, OAuth, reset, change, email verification)
- Profiles + instructor discovery
- Groups + members + join links + discovery + ownership transfer
- Sessions + recurring + visibility + reschedule + calendar + conflicts
- Invitations + client relationships
- Blog (with search, categories, pagination)
- Payments end-to-end: onboarding, products, invoices (incl. guest), subscriptions, refunds, earnings, Customer Portal, webhook sync
- Analytics (instructor, user, platform)
- GDPR export
- Feedback + waitlist
- Admin panel (users, groups, stats)

### Known gaps / pending
- **No background jobs yet** — no session reminders, no dunning, no recurring-session auto-generation, no invoice due-soon reminders, no payment orphan reconciliation
- **Notifications are log-only** — email/push delivery is Phase 2
- **APPROVAL join policy** exists in enum but is not implemented
- **No waitlist** for full sessions
- **No batch invite** endpoint
- **Admin/support** has no payment-specific UI
- **No iOS / Android native app** (web only)
- **No in-app messaging**
- **No attendance check-in**
- **Multi-currency** not yet — RON only
- **e-Factura / EU VAT / Stripe Tax** not integrated
- **Dispute workflow** — logged only, no response UI

---

## 8. Brand & Tone (for marketing output)

- **Voice**: direct, warm, community-first. Honest founder tone, not corporate, not hustle-culture.
- **We write as "we"** for product and founders content.
- **Specificity over fluff** — real examples, real numbers, real coach stories beat "unlock your potential" copy.
- **Target readers**:
  - Coach at 11pm stressed about attendance
  - Someone new in a city searching for their people
  - A leader comparing MotionHive to Facebook Groups / Mindbody / WhatsApp / Meetup
- **Differentiator one-liner**: the simple, community-first layer between "just use WhatsApp" and "pay for a studio management platform." Built for leaders with 15–50 regulars who want a real community without running a back office.
- **Colors**: Amber primary, Midnight Navy secondary, Teal accent.
- **Taglines in use**: "Move together.", "The hive is open.", "For those who lead and those who show up."

---

## 9. Source-of-Truth Docs (for deeper lookups)

- `CLAUDE.md` — codebase conventions (BE)
- `PAYMENTS_OVERVIEW.md` — full payment endpoint + webhook map
- `src/modules/payment/PAYMENT-FLOWS.md` — sequence diagrams for every payment flow
- `USER-FLOWS.md` — user journey docs
- `NOTIFICATION_SYSTEM_PLAN.md` — notification roadmap
- `IMPROVEMENT_PLAN.md` — technical debt + sprint history
- `projects/web/src/app/main/main.routes.ts` — canonical FE route list
- `BEEACTIVE_CONTEXT.md` (FE repo, legacy filename — content is MotionHive) — marketing context + blog strategy
