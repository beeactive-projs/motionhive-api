# BeeActive API - Comprehensive Improvement Plan

> Generated from deep codebase analysis + industry best practices research.
> All issues verified against actual source code with file paths and line numbers.

---

## Table of Contents

1. [Critical Bugs & Security Fixes (Do First)](#1-critical-bugs--security-fixes)
2. [Transaction & Data Integrity Fixes](#2-transaction--data-integrity-fixes)
3. [Logic Flaws & Race Conditions](#3-logic-flaws--race-conditions)
4. [Missing Input Validation](#4-missing-input-validation)
5. [PostgreSQL Compatibility Fixes](#5-postgresql-compatibility-fixes)
6. [Auth & Token Improvements](#6-auth--token-improvements)
7. [Invitation Flow Improvements](#7-invitation-flow-improvements)
8. [Session Module Improvements](#8-session-module-improvements)
9. [Group Module Improvements](#9-group-module-improvements)
10. [Client Module Improvements](#10-client-module-improvements)
11. [Job System & Cron Jobs (Activate Bull/Redis)](#11-job-system--cron-jobs)
12. [Notification System (New Module)](#12-notification-system)
13. [Rate Limiting Per-Endpoint](#13-rate-limiting-per-endpoint)
14. [Database Indexes & Performance](#14-database-indexes--performance)
15. [Missing Endpoints & API Gaps](#15-missing-endpoints--api-gaps)
16. [Analytics Module (New)](#16-analytics-module)
17. [Calendar & Scheduling Improvements](#17-calendar--scheduling)
18. [Search & Discovery Enhancements](#18-search--discovery)
19. [Privacy & GDPR Compliance](#19-privacy--gdpr)
20. [Mobile-First API Improvements](#20-mobile-first-api)
21. [Future Phases (Backlog)](#21-future-phases)

---

## 1. Critical Bugs & Security Fixes

**Priority: IMMEDIATE — Fix before any new features**

### 1.1 Remove debug console.log in production code
- **File**: `src/modules/client/client.controller.ts:90-91`
- **Issue**: `console.log('i am heree')` and `console.log(req)` — logs entire request including auth tokens
- **Fix**: Delete both lines immediately
- **Severity**: CRITICAL (information leak)

### 1.2 Wrong email sent on invitation accept
- **File**: `src/modules/invitation/invitation.service.ts:232`
- **Issue**: `sendWelcomeEmail(inviterUser.email, ...)` sends a welcome email to the **inviter** instead of an "invitation accepted" notification
- **Fix**: Create `sendInvitationAcceptedEmail()` template and use it here
- **Severity**: HIGH (silent notification failure)

### 1.3 Wrong email sent on client invitation for existing users
- **File**: `src/modules/client/client.service.ts:401`
- **Issue**: When an instructor invites an existing user as a client, `sendWelcomeEmail` is called instead of `sendClientInvitationEmail`
- **Fix**: Call `sendClientInvitationEmail()` with proper context

### 1.4 Session notification emails use wrong template
- **File**: `src/modules/session/session.service.ts:858-863, 888-890`
- **Issue**: `notifyParticipantsOfCancellation` and `updateParticipantStatus` call `sendWelcomeEmail` as placeholder
- **Fix**: Use `sendSessionCancelledEmail()` (already exists) and create `sendParticipantStatusEmail()`

### 1.5 OAuth account linking without user consent
- **File**: `src/modules/auth/auth.service.ts:136-149`
- **Issue**: If a user with the same email already exists (registered via email/password), OAuth login silently links the accounts. An attacker who knows a victim's email and has a Google account with that email can gain access.
- **Fix**: When OAuth email matches an existing non-OAuth user, require explicit linking confirmation (show "An account with this email exists. Would you like to link your Google account?" flow)

### 1.6 lastLoginAt never updated
- **File**: `src/modules/auth/auth.service.ts` — `login()` method
- **Issue**: `lastLoginAt` column exists on User entity but is never set during login
- **Fix**: Add `await user.update({ lastLoginAt: new Date() })` after successful login

---

## 2. Transaction & Data Integrity Fixes

**Priority: HIGH — Data corruption risks**

### 2.1 invitation.accept() — NOT transactional
- **File**: `src/modules/invitation/invitation.service.ts:206-217`
- **Operations**: `groupService.addMember()` → `roleService.assignRoleToUser()` → `invitation.update()`
- **Risk**: If step 2 or 3 fails, user is in group but has no role, and invitation is not marked accepted
- **Fix**: Wrap all three operations in a single Sequelize transaction. Pass `{ transaction }` to each call.

### 2.2 profile.createInstructorProfile() — NOT transactional
- **File**: `src/modules/profile/profile.service.ts:104-132`
- **Operations**: Create profile → assign INSTRUCTOR role
- **Risk**: If role assignment fails, instructor profile exists but user has no INSTRUCTOR permissions
- **Fix**: Wrap in transaction

### 2.3 session.joinSession() — NOT transactional
- **File**: `src/modules/session/session.service.ts:633-695`
- **Operations**: Check capacity → create SessionParticipant → notify instructor
- **Risk**: Race condition + orphaned records if notification step affects state
- **Fix**: Wrap in transaction with `LOCK.UPDATE` on session row

### 2.4 session.leaveSession() — NOT transactional
- **File**: `src/modules/session/session.service.ts:703-740`
- **Fix**: Wrap status update in transaction

### 2.5 session.updateParticipantStatus() — NOT transactional
- **File**: `src/modules/session/session.service.ts:818-864`
- **Fix**: Wrap in transaction

### 2.6 session.generateUpcomingInstances() — Loop without transaction
- **File**: `src/modules/session/session.service.ts:464+`
- **Risk**: If process crashes mid-loop, partial instances created
- **Fix**: Use `bulkCreate` inside a single transaction

### 2.7 Cascade soft-delete logic missing
- **Issue**: When a user is soft-deleted, their owned groups, sessions, client relationships, and invitations become orphaned
- **Fix**: Add cascade logic: user soft-delete → archive client relationships, cancel pending invitations, notify group members, transfer or archive owned groups

---

## 3. Logic Flaws & Race Conditions

### 3.1 Session capacity race condition (CRITICAL)
- **File**: `src/modules/session/session.service.ts:661-669`
- **Issue**: Between loading `session.participants` count and `participantModel.create()`, another user could join, exceeding `maxParticipants`
- **Fix**: Use pessimistic locking:
```typescript
const session = await this.sessionModel.findByPk(sessionId, {
  lock: transaction.LOCK.UPDATE,
  transaction,
  include: [SessionParticipant],
});
```
Or use a DB-level check constraint on participant count.

### 3.2 Slug generation race condition
- **File**: `src/modules/group/group.service.ts:78-87`
- **Issue**: `ensureUniqueSlug` uses a while loop querying DB. Two concurrent creates with same name can both pass check before either commits.
- **Fix**: Add UNIQUE constraint on `slug` column + handle unique violation with retry

### 3.3 APPROVAL join policy is dead code
- **File**: `src/modules/group/group.service.ts:679`
- **Issue**: `JoinPolicy.APPROVAL` exists in enum but `selfJoinGroup()` only handles `OPEN`. Users get a generic error with no way to request approval.
- **Fix**: Either implement the full approval flow (create join_request, notify owner, approve/decline endpoints) or remove APPROVAL from the enum until implemented

### 3.4 No guard against joining DRAFT sessions
- **File**: `src/modules/session/session.service.ts` — `joinSession()`
- **Issue**: Sessions with `status: 'DRAFT'` can be joined by participants
- **Fix**: Add `if (session.status === 'DRAFT') throw new BadRequestException('Session is not published yet')`

### 3.5 Cancellation policy ignores timezone
- **File**: `src/modules/session/session.service.ts:724-732`
- **Issue**: Uses local server time, not session/group timezone for cutoff calculation
- **Fix**: Use session's timezone context for cancellation window

### 3.6 Check-in window hardcoded
- **File**: `src/modules/session/session.service.ts:795-805`
- **Issue**: ±15/30 min hardcoded — should be configurable per group or instructor
- **Fix**: Add `checkInWindowMinutes` to group settings or instructor profile

### 3.7 Password reset doesn't clear lockout
- **File**: `src/modules/auth/auth.service.ts:530`
- **Issue**: After successful password reset, `failedLoginAttempts` and `lockedUntil` are NOT cleared
- **Fix**: Add `failedLoginAttempts: 0, lockedUntil: null` to the password reset update

### 3.8 Refresh token rotation missing
- **File**: `src/modules/auth/auth.service.ts:313`
- **Issue**: `refreshAccessToken()` issues new access token but doesn't rotate the refresh token. A stolen refresh token remains valid for full 7-day window.
- **Fix**: Issue new refresh token on every refresh, invalidate old one (requires DB tracking — see section 6)

### 3.9 memberCount denormalization drift risk
- **File**: `src/modules/group/group.service.ts:125, 254, 417, 704, 825`
- **Issue**: If any non-transactional path modifies members, or a migration/admin tool touches data directly, count drifts
- **Fix**: Add a periodic reconciliation cron job, or compute from COUNT query on member reads

---

## 4. Missing Input Validation

### 4.1 Pagination parameters unvalidated
- **Files**: `BlogQueryDto`, `DiscoverGroupsDto`, `DiscoverSessionsDto`, `DiscoverInstructorsDto`
- **Issue**: `page` and `limit` accept any number — could be 0, negative, or extremely large (e.g., limit=999999)
- **Fix**: Add to `PaginationDto`:
```typescript
@IsOptional() @Type(() => Number) @Min(1) @Max(100) limit?: number = 20;
@IsOptional() @Type(() => Number) @Min(1) page?: number = 1;
```

### 4.2 Missing MaxLength on update DTOs
- `UpdateUserDto` — no `@MaxLength()` for name fields
- `UpdateGroupDto` — no validation on name length
- `UpdateMemberDto` — no `@MaxLength()` on nickname
- **Fix**: Add `@MaxLength(100)` or similar to all string update fields

### 4.3 Roles from JWT not verified against DB
- **File**: `src/modules/user/user.controller.ts:50`
- **Issue**: `getProfile()` returns `roles: req.user.roles` directly from JWT payload. If roles change in DB after token issuance, stale data is returned.
- **Fix**: Re-fetch roles from DB on `/users/me` or add `rolesChangedAt` timestamp and validate against JWT `iat`

---

## 5. PostgreSQL Compatibility Fixes

### 5.1 JSON_CONTAINS is MySQL syntax (BROKEN on PostgreSQL)
- **File**: `src/modules/group/group.service.ts:462`
- **Issue**: `JSON_CONTAINS(tags, ...)` is MySQL-only. PostgreSQL uses `@>` operator with `jsonb`
- **Fix**:
```typescript
// Replace:
literal(`JSON_CONTAINS(tags, ${sequelize.escape(JSON.stringify(tag))})`)
// With:
literal(`tags::jsonb @> '${JSON.stringify([tag])}'::jsonb`)
```

### 5.2 Op.like is case-sensitive on PostgreSQL
- **Files**: `session.service.ts` (discoverSessions), `group.service.ts` (discoverGroups)
- **Issue**: `Op.like` is case-sensitive in PostgreSQL (unlike MySQL). Search for "Yoga" won't find "yoga"
- **Fix**: Replace `Op.like` with `Op.iLike` everywhere search is used

---

## 6. Auth & Token Improvements

### 6.1 Implement refresh token storage and revocation
- **Current**: Refresh tokens are stateless JWTs — cannot be revoked on logout
- **Issue**: Stolen refresh token valid for 7 days with no way to invalidate
- **Fix**:
  - Use the existing `refresh_token` table (referenced in schema) to store issued tokens
  - On `login()`: create DB record with `{ userId, tokenHash, expiresAt, revokedAt: null }`
  - On `refresh()`: verify token exists in DB and `revokedAt IS NULL`, then rotate (new token, revoke old)
  - On `logout()`: set `revokedAt = new Date()` on the token record
  - Add `DELETE /auth/logout-all` to revoke all tokens for a user

### 6.2 Add change password endpoint
- **Endpoint**: `PATCH /auth/change-password`
- **DTO**: `{ currentPassword: string, newPassword: string }`
- **Logic**: Verify current password → hash new password → update user → revoke all refresh tokens
- **Why**: Currently users can only reset password via email flow

### 6.3 Add password change invalidation
- **Issue**: After password reset, old access tokens remain valid until expiry
- **Fix**: Add `passwordChangedAt` timestamp to User. In JWT strategy, reject tokens where `iat < passwordChangedAt`

### 6.4 OAuth email verification flag
- **File**: `src/modules/auth/auth.service.ts:183`
- **Issue**: Check whether OAuth users have `isEmailVerified` correctly set to `true`
- **Fix**: Explicitly set `isEmailVerified: true` in `findOrCreateFromOAuth` for OAuth users

---

## 7. Invitation Flow Improvements

### 7.1 Support group invitations for non-registered users
- **Current**: Group `Invitation` entity has no `invitedEmail` field. If invited email isn't a registered user, the invitation is orphaned.
- **The client invitation system** (`ClientRequest`) already handles this correctly with `invitedEmail` + `linkPendingInvitations`
- **Fix**:
  1. Add `invitedEmail` column to `invitation` table
  2. Allow creating invitations even when `toUserId` is null (store email only)
  3. In `auth.service.ts` `linkPendingInvitations()`, also query `Invitation` table by email (currently only queries `ClientRequest`)
  4. On registration match, set `toUserId` on the invitation

### 7.2 Add batch invitation endpoint
- **Endpoint**: `POST /groups/:id/members/batch-invite`
- **DTO**: `{ emails: string[], message?: string }`
- **Logic**: Loop through emails, create invitation for each, send emails via Bull queue
- **Why**: Instructors commonly need to invite 10-30 members at once

### 7.3 Preserve invitation token through registration
- **Issue**: Email for unregistered invitees points to `/auth/signup?ref=client-invite` but loses the token
- **Fix**: Include token in the redirect URL so after registration, the frontend can auto-accept

---

## 8. Session Module Improvements

### 8.1 Implement session waitlist
- **When**: `maxParticipants` reached
- **Flow**:
  1. Add `WAITLISTED` to `ParticipantStatus` enum
  2. When session is full, create participant with `status: WAITLISTED`
  3. When a participant cancels, auto-promote first waitlisted participant (by `createdAt`)
  4. Notify promoted participant via email + push

### 8.2 Add session rescheduling endpoint
- **Endpoint**: `PATCH /sessions/:id/reschedule`
- **DTO**: `{ scheduledAt: Date, reason?: string }`
- **Logic**: Update scheduledAt → notify all active participants of new time
- **Why**: Currently must delete + recreate, losing participant data

### 8.3 Session conflict detection
- **When**: Creating or updating a session
- **Logic**: Check if instructor already has a session overlapping the time window
- **Response**: Return warning (not hard block) — some instructors run parallel sessions

### 8.4 Configurable cancellation policy
- **Current**: `CANCELLATION_CUTOFF_HOURS = 2` is hardcoded
- **Fix**: Add `cancellationCutoffHours` to instructor profile or group settings

### 8.5 N+1 in session notifications
- **File**: `src/modules/session/session.service.ts:907-920`
- **Issue**: `notifyInstructorOfJoinLeave()` does separate `findByPk` for instructor and participant
- **Fix**: Use `Promise.all()` and pass pre-loaded user data from the caller

---

## 9. Group Module Improvements

### 9.1 Group ownership transfer
- **Endpoint**: `POST /groups/:id/transfer-ownership`
- **DTO**: `{ newOwnerId: string }`
- **Logic**: Verify new owner is a member → update `isOwner` flags → notify both parties
- **Why**: Groups become stranded when instructors go on leave

### 9.2 Group member roles (moderators)
- **Add**: `role` field to `group_member` entity (`OWNER`, `MODERATOR`, `MEMBER`)
- **Moderator permissions**: Can manage members, create sessions, send announcements
- **Why**: Large groups need delegation

### 9.3 Group statistics endpoint
- **Endpoint**: `GET /groups/:id/stats`
- **Response**: member count, session count, attendance rate, new members this month
- **Why**: Instructors need basic group analytics

### 9.4 Implement APPROVAL join policy (or remove from enum)
- **If implementing**: Create `join_request` flow with approve/decline endpoints
- **If deferring**: Remove `APPROVAL` from `JoinPolicy` enum to avoid dead code confusion

---

## 10. Client Module Improvements

### 10.1 Client offboarding flow
- **Endpoint**: `POST /clients/:clientId/archive` (instructor) and `POST /clients/instructors/:instructorId/leave` (client)
- **Logic**: Set `status = ARCHIVED` → send notification to both parties → add optional reason/note
- **Why**: No formal "end relationship" flow exists

### 10.2 Health data consent per instructor
- **Current**: `sharedHealthInfo` is on `group_member` (per-group, not per-instructor)
- **Fix**: Add `healthConsentGrantedAt` to `instructor_client` entity
- **Logic**: Instructor can only view client health data if consent is explicitly granted for that relationship

### 10.3 Fix declineRequest cleanup for CLIENT_TO_INSTRUCTOR type
- **File**: `src/modules/client/client.service.ts:609-625`
- **Issue**: Tries to destroy `instructor_client` with `status: PENDING` but this row doesn't exist for `CLIENT_TO_INSTRUCTOR` requests
- **Fix**: Guard with check: only destroy if request `type === 'INSTRUCTOR_TO_CLIENT'`

---

## 11. Job System & Cron Jobs

**Priority: HIGH — Infrastructure already wired (Bull + ScheduleModule imported), just needs processors**

### 11.1 Session reminder emails (QUICK WIN)
- **Cron**: `*/15 * * * *` (every 15 minutes)
- **Logic**: Find sessions where `scheduledAt` is 24h away AND `reminderSent = false` → send email to all active participants → set `reminderSent = true`
- **Note**: `reminderSent` field already exists on Session entity

### 11.2 Auto-transition session statuses (QUICK WIN)
- **Cron**: `*/5 * * * *` (every 5 minutes)
- **Logic**:
  - `SCHEDULED → IN_PROGRESS` when `now >= scheduledAt`
  - `IN_PROGRESS → COMPLETED` when `now >= scheduledAt + durationMinutes`
- **Note**: Currently sessions stay `SCHEDULED` forever after they pass

### 11.3 Auto mark NO_SHOW (QUICK WIN)
- **Cron**: Runs after session transitions to `COMPLETED`
- **Logic**: Set participants in `REGISTERED` or `CONFIRMED` status to `NO_SHOW`

### 11.4 Recurring session auto-generation
- **Cron**: `0 2 * * 0` (every Sunday at 2 AM)
- **Logic**: Find all `isRecurring = true` sessions → generate instances 2-4 weeks ahead
- **Why**: Currently manual — instructor must call `POST /sessions/:id/generate-instances`

### 11.5 Expire pending invitations/requests
- **Cron**: Daily
- **Logic**: Find `ClientRequest` and `Invitation` records past `expiresAt` with status `PENDING` → update to `EXPIRED`

### 11.6 memberCount reconciliation
- **Cron**: Daily
- **Logic**: `UPDATE group SET member_count = (SELECT COUNT(*) FROM group_member WHERE group_id = group.id AND left_at IS NULL)`

---

## 12. Notification System

**Priority: HIGH — New module**

### 12.1 Core entities
```
notification: id, userId, type, title, body, data (JSON), isRead, readAt, createdAt
notification_preference: userId, notificationType, emailEnabled, pushEnabled, inAppEnabled
device_push_token: id, userId, token (unique), platform, createdAt
```

### 12.2 Endpoints
```
GET    /notifications                        → Paginated, unread first
GET    /notifications/unread-count           → Badge count
PATCH  /notifications/:id/read              → Mark as read
POST   /notifications/read-all              → Mark all as read
DELETE /notifications/:id                   → Delete

GET    /notifications/preferences            → Get preferences
PATCH  /notifications/preferences           → Update preferences

POST   /devices/push-token                  → Register FCM/APNS token
DELETE /devices/push-token                  → Unregister
```

### 12.3 Notification types to implement
| Event | Recipients | Channels |
|-------|-----------|----------|
| Session starting in 24h | Registered participants | Email + Push + In-app |
| Session starting in 1h | Registered participants | Push + In-app |
| Session cancelled | Registered participants | Email + Push + In-app |
| Session rescheduled | Registered participants | Email + Push + In-app |
| New participant joined | Instructor | In-app |
| Client request received | Instructor | Email + In-app |
| Client request accepted | Client | Email + Push + In-app |
| Group invitation received | Invitee | Email + In-app |
| Group invitation accepted | Inviter | In-app |
| New group member | Instructor | In-app |

### 12.4 Architecture
```
Event → EventEmitter (in-process) → Bull Job → Delivery channels
                                                → Email (Resend)
                                                → Push (Firebase FCM)
                                                → In-app (DB row)
```

---

## 13. Rate Limiting Per-Endpoint

**Currently missing on sensitive endpoints:**

| Endpoint | Recommended Limit | Reason |
|----------|------------------|--------|
| `DELETE /users/me` | 1/hour | Account deletion |
| `POST /invitations` | 20/hour | Invitation spam |
| `POST /groups/:id/join` | 5/min | Join spam |
| `POST /sessions/:id/join` | 5/min | Join spam |
| `POST /clients/invite` | 10/hour | Invite spam |
| `POST /clients/request/:instructorId` | 5/hour | Request spam |
| `POST /auth/resend-verification` | 3/hour | Email spam |
| `POST /groups/:id/members/batch-invite` | 3/hour | Batch spam |

**Implementation**: Use `@Throttle({ default: { limit: X, ttl: Y } })` decorator per endpoint.

---

## 14. Database Indexes & Performance

### 14.1 Missing indexes (add via migration)
```sql
-- User
CREATE INDEX idx_user_email ON "user" (email);
CREATE INDEX idx_user_is_active ON "user" (is_active);

-- Group
CREATE INDEX idx_group_instructor_id ON "group" (instructor_id);
CREATE INDEX idx_group_is_public ON "group" (is_public);
CREATE INDEX idx_group_slug ON "group" (slug);
CREATE UNIQUE INDEX idx_group_slug_unique ON "group" (slug) WHERE deleted_at IS NULL;

-- Group Member
CREATE INDEX idx_group_member_group_id ON group_member (group_id);
CREATE INDEX idx_group_member_user_id ON group_member (user_id);
CREATE UNIQUE INDEX idx_group_member_unique ON group_member (group_id, user_id) WHERE left_at IS NULL;

-- Session
CREATE INDEX idx_session_instructor_id ON session (instructor_id);
CREATE INDEX idx_session_group_id ON session (group_id);
CREATE INDEX idx_session_scheduled_at ON session (scheduled_at);
CREATE INDEX idx_session_status ON session (status);
CREATE INDEX idx_session_visibility_status ON session (visibility, status, scheduled_at);

-- Session Participant
CREATE INDEX idx_session_participant_session_id ON session_participant (session_id);
CREATE INDEX idx_session_participant_user_id ON session_participant (user_id);
CREATE UNIQUE INDEX idx_session_participant_unique ON session_participant (session_id, user_id);

-- Instructor Client
CREATE INDEX idx_instructor_client_instructor_id ON instructor_client (instructor_id);
CREATE INDEX idx_instructor_client_client_id ON instructor_client (client_id);
CREATE UNIQUE INDEX idx_instructor_client_unique ON instructor_client (instructor_id, client_id) WHERE status = 'ACTIVE';

-- Client Request
CREATE INDEX idx_client_request_from ON client_request (from_user_id);
CREATE INDEX idx_client_request_to ON client_request (to_user_id);
CREATE INDEX idx_client_request_status ON client_request (status);

-- Invitation
CREATE INDEX idx_invitation_token ON invitation (token);
CREATE INDEX idx_invitation_group_id ON invitation (group_id);
CREATE INDEX idx_invitation_email ON invitation (email);
```

### 14.2 Caching opportunities (Redis)
- User roles → 15-min TTL, invalidate on role change
- Instructor profiles → 2-hour TTL
- Group public profiles → 1-hour TTL
- Blog posts list → 1-hour TTL
- Discovery results → 5-min TTL for popular queries

### 14.3 Cursor-based pagination
- Current offset pagination degrades with large offsets
- Implement cursor-based alternative for high-traffic endpoints (session feed, notifications)

---

## 15. Missing Endpoints & API Gaps

### 15.1 Auth Module
- `PATCH /auth/change-password` — Change password (authenticated)
- `DELETE /auth/logout-all` — Revoke all refresh tokens
- `POST /auth/complete-onboarding` — Mark onboarding complete (sets `onboardingCompletedAt`)

### 15.2 User Module
- `GET /users/:id` — Public user profile (limited fields)
- `GET /users` — Admin: list users with pagination, search, filters
- `PATCH /users/:id` — Admin: update user
- `DELETE /users/:id` — Admin: soft delete user
- `GET /users/me/settings` — User preferences (unified)
- `PATCH /users/me/settings` — Update preferences

### 15.3 Profile Module
- `GET /profile/completion` — Profile completion percentage
- `PATCH /profile/instructor/visibility` — Privacy settings per field

### 15.4 Group Module
- `POST /groups/:id/transfer-ownership` — Transfer group ownership
- `POST /groups/:id/members/batch-invite` — Batch invite by emails
- `GET /groups/:id/stats` — Group statistics
- `GET /groups/:id/export/members.csv` — Export member list

### 15.5 Session Module
- `PATCH /sessions/:id/reschedule` — Reschedule with notifications
- `GET /sessions/calendar` — Sessions grouped by day for date range
- `GET /sessions/:id/export.ics` — iCal export
- `POST /sessions/:id/feedback` — Post-session feedback (after COMPLETED)
- `GET /sessions/:id/feedback` — Instructor views feedback
- `PATCH /sessions/:id/participants/batch` — Batch update status (mark all attended)

### 15.6 Client Module
- `POST /clients/:clientId/archive` — Formal end-relationship
- `GET /clients/export.csv` — Export client list

### 15.7 Blog Module
- `GET /blog/search` — Blog search endpoint
- Blog comments, categories, tags — future phases

---

## 16. Analytics Module

**New module: `src/modules/analytics/`**

### Endpoints
```
GET /analytics/instructor/summary            → Key metrics (30 days)
GET /analytics/instructor/sessions           → Session stats (attendance, fill rates)
GET /analytics/instructor/clients            → Client growth over time
GET /analytics/me/activity                   → User's own session history + stats
GET /analytics/admin/platform                → Platform-wide stats (ADMIN+)
```

### Instructor summary response shape
```json
{
  "period": "last_30_days",
  "sessions": { "total": 24, "completed": 20, "cancelled": 2, "averageAttendanceRate": 0.78 },
  "clients": { "total": 43, "new": 7, "active": 38 },
  "groups": { "total": 3, "totalMembers": 87 }
}
```

---

## 17. Calendar & Scheduling

### 17.1 Calendar view endpoint
- `GET /sessions/calendar?start=2026-03-01&end=2026-03-31`
- Returns sessions grouped by date: `{ "2026-03-10": [...sessions], "2026-03-15": [...sessions] }`

### 17.2 Instructor availability system
```
GET    /availability/:instructorId           → Public available slots
GET    /availability/me                      → My schedule (INSTRUCTOR)
PUT    /availability/me                      → Set weekly availability
POST   /availability/me/blocked              → Block a time range (vacation)
DELETE /availability/me/blocked/:id          → Remove blocked time
```

### 17.3 Timezone handling
- Store `scheduledAt` always in UTC
- Add `timezone` field to Session entity (inherited from group or instructor)
- Return `scheduledAtLocal` computed field in responses

---

## 18. Search & Discovery Enhancements

### 18.1 Enhanced session discovery filters
- Add: `sessionType`, `dateFrom`, `dateTo`, `maxPrice`, `maxDurationMinutes`, `city`, `country`, `instructorId`, `tags`, `isFree`
- Add sorting: `scheduledAt`, `price`, `popularity`

### 18.2 Enhanced instructor discovery filters
- Add: specializations multi-select, rating filter, availability filter
- Add: location-based search (future: PostGIS with earthdistance extension)

### 18.3 Rating & review system (future phase)
```
POST   /reviews                              → Submit (must have attended session)
GET    /reviews/instructor/:instructorId     → Public reviews
PATCH  /reviews/:id/reply                   → Instructor reply
```

---

## 19. Privacy & GDPR

### 19.1 Data export (Article 20)
- `POST /users/me/data-export` → Request export (async, email when ready)
- Generate JSON with all user data, upload to Cloudinary (private), send link, auto-delete after 48h

### 19.2 Account hard deletion (Article 17)
- `DELETE /users/me` → Schedule deletion (30-day grace period)
- `POST /users/me/cancel-deletion` → Cancel scheduled deletion
- Cron: daily check for users past grace period → anonymize records, hard delete PII

### 19.3 Consent tracking
- New `consent_record` table: `userId, consentType, grantedTo, grantedAt, revokedAt, ipAddress`
- Endpoints: `GET /privacy/consents`, `POST /privacy/consents`, `DELETE /privacy/consents/:type`

---

## 20. Mobile-First API

### 20.1 Push token registration (required for notifications)
- Covered in Notification System (section 12)

### 20.2 App config endpoint
```
GET /app/config (no auth)
{
  "minimumVersion": "2.0.0",
  "latestVersion": "2.5.1",
  "forceUpdate": false,
  "maintenanceMode": false,
  "features": { "payments": false, "liveSession": false, "chat": false }
}
```

### 20.3 Conditional GET with ETags
- Return `ETag` headers for infrequently changing resources (profiles, group info)
- Support `If-None-Match` → return 304 Not Modified

---

## 21. Future Phases (Backlog)

These are significant features to consider for later development phases:

### Phase 3: Content & Programs
- Exercise library (CRUD, search)
- Workout programs (instructor-authored, assign to clients)
- Progress photos (client upload, consent-gated sharing with instructor)
- Blog expansion (categories, tags, instructor authorship, comments)

### Phase 4: Payments
- Stripe integration (PaymentIntent for sessions, Stripe Connect for instructor payouts)
- Subscription plans (monthly, quarterly, annual)
- Session packages (buy 10, use over 3 months)
- Revenue analytics

### Phase 5: Real-Time
- WebSocket gateway (Socket.io via NestJS)
- Live notification delivery
- Direct messaging (instructor-client threads)
- Live session room (status updates, participant changes)

### Phase 6: Advanced
- Webhook support for instructor integrations
- Location-based search (PostGIS)
- Audit log for all sensitive operations
- API versioning (`/v1/` prefix)
- Live video integration (Daily.co/Agora for ONLINE sessions)

---

## Implementation Order (Recommended Sprints)

### Sprint 1: Critical Fixes (1-2 days) ✅ COMPLETED
- [x] 1.1 Remove console.log
- [x] 1.2-1.4 Fix wrong email templates
- [x] 1.6 Update lastLoginAt
- [x] 5.1 Fix JSON_CONTAINS → PostgreSQL syntax
- [x] 5.2 Fix Op.like → Op.iLike
- [x] 3.7 Clear lockout on password reset
- [x] 4.1 Add pagination validation

### Sprint 2: Data Integrity (2-3 days) ✅ COMPLETED
- [x] 2.1-2.5 Add transactions to all multi-step operations
- [x] 3.1 Fix session capacity race condition
- [x] 3.2 Fix slug generation race condition
- [x] 3.4 Guard against joining DRAFT sessions

### Sprint 3: Auth Hardening (2-3 days) ✅ COMPLETED
- [x] 6.1 Implement refresh token storage + revocation (DB-backed, rotation, logout/logout-all)
- [x] 6.2 Add change password endpoint (PATCH /auth/change-password)
- [x] 6.3 Add password change invalidation (passwordChangedAt check in JWT strategy)
- [x] 1.5 Fix OAuth account linking (reject unverified email/password accounts)
- [x] 13.* Add rate limiting to sensitive endpoints (all controllers)

### Sprint 4: Job System & Notifications (3-5 days) — PARTIALLY DEFERRED
- [ ] 11.1-11.6 Implement all cron jobs — DEFERRED (to implement later with Redis/Bull attention)
- [ ] 12.1-12.4 Notification module — DEFERRED (dummy module in place, architecture TBD)
- [x] 7.1 Group invitations for non-registered users (linkPendingInvitations updated)

### Sprint 5: Missing Endpoints & Polish (3-5 days) ✅ COMPLETED
- [x] 14.1 Add database indexes (migration 012_add_indexes.sql — 50+ indexes)
- [x] 8.2 Session reschedule endpoint (PATCH /sessions/:id/reschedule)
- [x] 8.3 Session conflict detection (warning on create)
- [x] 9.1 Group ownership transfer (POST /groups/:id/transfer-ownership)
- [x] 9.3 Group statistics endpoint (GET /groups/:id/stats)
- [x] 17.1 Calendar view endpoint (GET /sessions/calendar)

### Sprint 6: Analytics & Discovery (2-3 days) ✅ COMPLETED
- [x] 16.* Analytics module (instructor summary, user activity, platform stats)
- [x] 17.* Calendar endpoint (GET /sessions/calendar?start=...&end=...)
- [x] 18.* Enhanced discovery filters (sessionType, dateFrom/To, maxDuration, sorting)

### Sprint 7: Privacy & Mobile (2-3 days) ✅ COMPLETED
- [x] 19.1 GDPR data export (POST /users/me/data-export)
- [x] 20.2 App config endpoint (GET /health/config)
- [ ] 19.2-19.3 Account hard deletion + consent tracking — DEFERRED (needs cron job system)

---

*Total estimated sprints: 7 (14-24 working days)*
*This plan should be reviewed and adjusted based on frontend needs and user feedback.*
