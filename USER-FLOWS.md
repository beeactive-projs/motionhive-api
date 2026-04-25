# BeeActive API -- User Flows

This document describes **all user flows** for the BeeActive API. Use it as the single source of truth for understanding API behaviour and for frontend integration.

- **Flows 1-5:** Auth (register, login, Google/Facebook OAuth, password reset, refresh, email verification, logout).
- **Flows 6-7:** Profile (user/instructor, unified update, instructor activation).
- **Flow 8:** Groups (CRUD, members, leave, delete, discovery, public profile, self-join, join links).
- **Flow 9:** Invitations (send, accept/decline, cancel, resend).
- **Flow 10:** Sessions (create, update, delete, clone, recurring sessions, visibility rules).
- **Flow 11:** Session participation (join, leave, confirm, check-in, status updates).
- **Flow 12:** Discovery (groups, instructors, public profiles, public sessions).
- **Flow 13:** Client relationships (instructor-client, requests, accept/decline).

For **deployment and migrations**, see [DEPLOY.md](./DEPLOY.md).

---

## Roles

| Role | Description |
|------|-------------|
| `USER` | Default role assigned on registration. Can join groups, sessions, request to become a client. |
| `INSTRUCTOR` | Activated via POST /profile/instructor. Can create groups, sessions, manage clients. |
| `ADMIN` | Platform admin. |
| `SUPER_ADMIN` | Full platform access. |
| `SUPPORT` | Support staff. |

---

## Flow 1: User Registration

```
User submits (email, password, firstName, lastName, phone)
  |
  v
POST /auth/register [Public, Rate: 3/hour]
  |
  +-- Validate strong password (8+ chars, upper, lower, number, special)
  +-- Check email uniqueness
  |
  v
Transaction:
  +-- Create User record (password hashed, bcrypt 12 rounds)
  +-- Assign USER role (global)
  +-- Generate email verification token (hashed, 24h expiry)
  |
  v
Send Emails (via Resend):
  +-- Email verification email (with verification link)
  +-- Welcome email
  |
  v
Return { accessToken, refreshToken, user }
```

---

## Flow 2: User Login

```
User submits (email, password)
  |
  v
POST /auth/login [Public, Rate: 5/15min]
  |
  +-- Find user by email
  +-- Check if account locked (lockedUntil > now?)
  |   +-- YES -> Return "Account locked" error
  |
  +-- Validate password (bcrypt compare)
  |   +-- FAIL -> Increment failedLoginAttempts
  |             +-- >= 5 attempts -> Lock account for 15 min
  |
  +-- SUCCESS -> Reset failedLoginAttempts
  +-- Update lastLoginAt
  |
  v
Return { accessToken (2h), refreshToken (7d), user with roles }
  |
  v
Response includes isEmailVerified flag so frontend can prompt verification
```

---

## Flow 2b: Sign in with Google (OAuth)

Token-based flow: frontend obtains Google ID token (e.g. Google Sign-In / One Tap), sends it to the API. No redirect to the backend.

```
Frontend:
  +-- User clicks "Sign in with Google"
  +-- Google Sign-In / One Tap returns ID token (JWT)
  |
  v
POST /auth/google [Public, Rate: 10/15min]
  Body: { "idToken": "<Google ID token>" }
  |
  +-- Verify ID token with GOOGLE_CLIENT_ID (google-auth-library)
  +-- Extract sub (provider user id), email, given_name, family_name
  +-- Find or create user:
  |   +-- If social_account exists for (GOOGLE, provider_user_id) -> return that user
  |   +-- If user exists by email -> link new social_account, return user
  |   +-- Else -> create user (no password, isEmailVerified=true),
  |              create social_account, assign USER role
  |
  v
Return { accessToken, refreshToken, user } (same shape as login/register)
```

**Requirements:** `GOOGLE_CLIENT_ID` in env. Frontend must use the same Client ID and run on an authorized JavaScript origin.

**Frontend (e.g. Angular) after receiving the Google ID token:**

1. **Call the API:** `POST /auth/google` with body `{ "idToken": "<Google ID token>" }`.
2. **Store the response:** Save `accessToken` (and optionally `refreshToken`) in your auth service (e.g. in memory or secure storage). Use the same approach as for email/password login.
3. **Use the token:** Send `Authorization: Bearer <accessToken>` on all subsequent API requests.
4. **Use the user object:** The response includes `user` (id, email, firstName, lastName, isEmailVerified, roles)—use it for UI and permissions.

**Sign up vs login:** The same endpoint and flow work for both. The API finds or creates the user; first-time users get a new account, returning users get the existing one. No separate “Google sign up” vs “Google login” call.

---

## Flow 2c: Sign in with Facebook (OAuth)

Same token-based pattern as Google: frontend sends Facebook **access token**; API verifies it and finds or creates user.

```
POST /auth/facebook [Public, Rate: 10/15min]
  Body: { "accessToken": "<Facebook access token>" }
  |
  +-- Verify token via Graph API debug_token
  +-- Fetch profile (id, email, first_name, last_name)
  +-- Find or create user (same logic as Google)
  |
  v
Return { accessToken, refreshToken, user }
```

**Backend requirements:**

- In [Facebook for Developers](https://developers.facebook.com/): create an app → **Facebook Login** product → get **App ID** and **App Secret**.
- Set env: `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`. If missing, `POST /auth/facebook` returns 400 “Facebook Sign-In is not configured”.
- In the Facebook app: add your frontend origin (e.g. `https://yourapp.com`, `http://localhost:4200`) under **Facebook Login → Settings → Valid OAuth Redirect URIs** (and Client OAuth Login / Web OAuth Login enabled).

**Test page:** Use `facebook-token-test.html` in the repo: set `FB_APP_ID` in the file, run `npx serve -p 4200 .`, open http://localhost:4200/facebook-token-test.html. Sign in with Facebook → click **Send to API** to get the app JWT and create/find user.

**Frontend (e.g. Angular) after receiving the Facebook access token:**

1. **Call the API:** `POST /auth/facebook` with body `{ "accessToken": "<Facebook access token>" }`.  
   Unlike Google, Facebook uses the **access token** from the Facebook Login SDK (the one you get after the user logs in), not an ID token.
2. **Request permissions:** When initialising Facebook Login, request at least `email` and `public_profile` so the API can read email, first_name, last_name. Without email, the API returns 400 “email is required”.
3. **Store the response:** Same as Google: save `accessToken` and `refreshToken` from the response, use `Authorization: Bearer <accessToken>` for API calls, use `user` for UI.
4. **Sign up vs login:** Same as Google: one endpoint for both; API finds or creates the user.

---

## Flow 3: Password Reset

```
Step 1: Request Reset
  POST /auth/forgot-password [Public, Rate: 3/hour]
  +-- Find user by email (returns success even if not found)
  +-- Generate 32-byte hex token
  +-- Hash token (SHA-256), store in passwordResetToken
  +-- Set passwordResetExpires = now + 1 hour
  +-- Send email with link: ${FRONTEND_URL}/reset-password?token=${plainToken}
  +-- Return { message: "If email exists, reset link sent" }

Step 2: Reset Password
  POST /auth/reset-password [Public, Rate: 5/hour]
  +-- Hash submitted token (SHA-256)
  +-- Find user by hashed token + check expiration
  +-- Validate new password strength
  +-- Update password (bcrypt hash)
  +-- Clear passwordResetToken & passwordResetExpires
  +-- Return { message: "Password reset successful" }
```

---

## Flow 4: Token Refresh

```
POST /auth/refresh [Public, Rate: 10/15min]
  Body: { "refreshToken": "<refresh token>" }
  |
  +-- Verify refresh token signature (JWT_REFRESH_SECRET)
  +-- Extract userId
  +-- Find user, verify active
  |
  v
Return { accessToken } (new access token)
```

---

## Flow 4b: Logout

```
POST /auth/logout [Authenticated, Rate: 10/15min]
  Body: { "refreshToken": "<refresh token>" }
  |
  +-- Verify refresh token belongs to the requesting user
  +-- Invalidate the refresh token
  |
  v
Return { message: "Logged out successfully" }

Frontend should discard both tokens after calling this.
```

---

## Flow 5: Email Verification

```
Step 1: On Registration (automatic)
  +-- Generate 32-byte hex verification token
  +-- Hash token (SHA-256), store in emailVerificationToken
  +-- Set emailVerificationExpires = now + 24 hours
  +-- Send verification email via Resend

Step 2: User clicks link
  POST /auth/verify-email { token } [Public]
  +-- Hash submitted token (SHA-256)
  +-- Find user by hashed token
  +-- Check expiration (24h)
  +-- Set isEmailVerified = true
  +-- Clear verification token & expiry
  +-- Return { message: "Email verified successfully" }

Step 3: Resend verification (if needed)
  POST /auth/resend-verification { email } [Public, Rate: 2/hour]
  +-- Generate new token, send new verification email
  +-- Return { message: "If email exists and is not verified, a new link was sent" }
```

---

## Flow 6: Profile Management

```
User Profile:
  GET    /users/me         -> Get user data (core fields + roles)
  PATCH  /users/me         -> Update core fields (name, phone, avatar, language, timezone)
  DELETE /users/me         -> Delete account (GDPR soft-delete)

Unified Profile Update:
  PATCH  /profile/me       -> Update user (personal info) + instructor profile in ONE call

Individual Profiles:
  GET    /profile/me              -> Full profile overview (user + instructor profile)
  POST   /profile/instructor      -> Activate instructor profile + assign INSTRUCTOR role
  GET    /profile/instructor      -> Get instructor profile
  PATCH  /profile/instructor      -> Update instructor professional data
```

---

## Flow 7: Instructor Activation

```
User wants to become an instructor
  |
  v
POST /profile/instructor [Authenticated]
  Body: { displayName: "Coach John", bio?, specializations?, ... }
  |
  +-- Check if instructor profile already exists (409 if so)
  +-- Create InstructorProfile record
  +-- Assign INSTRUCTOR role (global scope)
  |
  v
User can now: create groups, create sessions, manage clients, send client invitations
```

---

## Flow 8: Group Management

Groups are the core organizational unit (fitness groups, training crews, studios).

### Group Properties

| Field | Type | Description |
|-------|------|-------------|
| `isPublic` | boolean | Whether the group appears in discovery |
| `joinPolicy` | OPEN / APPROVAL / INVITE_ONLY | How users can join |
| `tags` | string[] | Flexible categorization (e.g. ["fitness", "yoga", "wellness"]) |
| `instructorId` | UUID | The instructor who owns the group |
| `joinToken` | string | Token for invite link joining |

### Join Policy Matrix

| isPublic | joinPolicy | Discovery | Self-Join | Join Link | Invitation |
|----------|------------|-----------|-----------|-----------|------------|
| true | OPEN | Yes | Yes | Yes | Yes |
| true | APPROVAL | Yes | No (future) | Yes | Yes |
| true | INVITE_ONLY | Yes | No | Yes | Yes |
| false | any | No | No | Yes | Yes |

### Endpoints

```
Create (requires INSTRUCTOR role):
  POST /groups -> Create group + creator becomes owner
    Body: { name, description, timezone, isPublic, joinPolicy, tags, contactEmail, ... }

Read:
  GET    /groups          -> List my groups
  GET    /groups/:id      -> Get group details (members only)

Update/Delete:
  PATCH  /groups/:id      -> Update group (owner only, slug auto-regenerates on name change)
  DELETE /groups/:id      -> Delete group (owner only, soft delete)

Members:
  GET    /groups/:id/members        -> Paginated member list (includes isClient flag)
  PATCH  /groups/:id/members/me     -> Update own membership (nickname, health sharing)
  DELETE /groups/:id/members/me     -> Leave group (owners cannot leave)
  DELETE /groups/:id/members/:userId -> Remove member (owner only)

Discovery (no auth required):
  GET    /groups/discover       -> Browse/search public groups
    Filters: ?search=yoga&tags=fitness&city=Bucharest&country=RO&page=1&limit=20
    Sorted by: member count (most popular first)

  GET    /groups/:id/public     -> Public group profile
    Returns: group info, instructor info, upcoming sessions

Self-Join:
  POST   /groups/:id/join       -> Join public OPEN group (authenticated)

Join Links:
  POST   /groups/:id/join-link  -> Generate join link (owner only, 7d expiry)
  DELETE /groups/:id/join-link  -> Revoke join link (owner only)
  POST   /groups/join/:token    -> Join group via link (any authenticated user)
```

### Member List Response

The `GET /groups/:id/members` endpoint returns an `isClient` flag for each member, indicating whether the member is a client of the group's instructor. This allows instructors to see which group members are also their clients.

```json
{
  "data": [
    {
      "id": "member-uuid",
      "userId": "user-uuid",
      "firstName": "Jane",
      "lastName": "Doe",
      "isOwner": false,
      "isClient": true,
      "joinedAt": "2026-01-15T10:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "totalItems": 1, "totalPages": 1 }
}
```

---

## Flow 9: Invitation Flow

Invitations are for inviting users to join **groups**. Group owners can send invitations to any email address.

```
Owner sends invitation:
  POST /invitations -> Generate hashed token -> Send email via Resend
    Body: { groupId, email, role? }

Recipient actions:
  GET  /invitations/pending          -> My pending invitations
  POST /invitations/:token/accept    -> Verify email match -> Join group -> Notify inviter
  POST /invitations/:token/decline   -> Mark declined

Owner management:
  POST /invitations/:id/cancel       -> Cancel pending invitation (owner only)
  POST /invitations/:id/resend       -> Resend with new token (owner only)

Group view:
  GET /invitations/group/:id         -> Group's sent invitations (paginated)
```

---

## Flow 10: Session Management (Instructor)

### Session Visibility

| Visibility | Who Can See | Description |
|------------|-------------|-------------|
| `PUBLIC` | Anyone | Shows in session discovery, anyone can register |
| `GROUP` | Group members only | Only members of the session's group can see and join |
| `CLIENTS` | Instructor's clients only | Only the instructor's active clients can see and join |
| `PRIVATE` | Instructor only | Draft/planning, not visible to others |

### Endpoints

```
Create Session (requires INSTRUCTOR role):
  POST /sessions -> Create session with visibility, schedule, capacity
    Body: { title, groupId?, visibility, scheduledAt, durationMinutes, maxParticipants, price?, ... }
    Optional: isRecurring + recurringRule (see Recurring Sessions below)

Recurring sessions (instructor only):
  GET  /sessions/:id/recurrence-preview?weeks=12  -> Upcoming occurrence dates
  POST /sessions/:id/generate-instances { weeks? } -> Create session rows for next N weeks

Manage:
  GET    /sessions          -> List visible sessions (filtered by visibility rules)
  GET    /sessions/discover -> Browse public sessions (search by title/description/location)
  GET    /sessions/:id      -> Get session details
  PATCH  /sessions/:id      -> Update session (instructor only)
  DELETE /sessions/:id      -> Delete session (instructor only, soft delete)
  POST   /sessions/:id/clone -> Duplicate session with new date
```

### Visibility Logic for GET /sessions

A user sees a session if any of these are true:
- They are the instructor who created it
- They are registered as a participant
- Session visibility is PUBLIC
- Session visibility is GROUP and they are a member of the session's group
- Session visibility is CLIENTS and they are an active client of the instructor

### Recurring Sessions

Recurring sessions let instructors define a rule (e.g. "every Monday, Wednesday, Friday at 9:00") and generate concrete session rows.

#### Recurrence rule format (`recurringRule`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `frequency` | `WEEKLY` / `DAILY` / `MONTHLY` | Yes | When to repeat |
| `interval` | number (1-99) | No (default 1) | Every N periods |
| `daysOfWeek` | number[] (0-6) | For WEEKLY | 0=Sun, 1=Mon, ... 6=Sat |
| `endDate` | ISO date string | No | Stop generating after this date |
| `endAfterOccurrences` | number (1-365) | No | Stop after N occurrences |

**Examples:**
- Every Mon/Wed/Fri: `{ frequency: "WEEKLY", daysOfWeek: [1, 3, 5] }`
- Every 2 weeks on Tuesday: `{ frequency: "WEEKLY", interval: 2, daysOfWeek: [2] }`
- Every 3 days: `{ frequency: "DAILY", interval: 3 }`

---

## Flow 11: Session Participation

```
Join Session:
  POST /sessions/:id/join -> Check visibility + capacity -> Register -> Notify instructor

Confirm Attendance:
  POST /sessions/:id/confirm -> REGISTERED -> CONFIRMED

Self Check-In:
  POST /sessions/:id/checkin -> Available 15 min before to 30 min after start -> ATTENDED

Leave Session:
  POST /sessions/:id/leave -> 2-hour cancellation policy -> CANCELLED -> Notify instructor

Instructor Attendance:
  PATCH /sessions/:id/participants/:userId -> Update status (ATTENDED, NO_SHOW, etc.)

Status Flow:
  REGISTERED -> CONFIRMED -> ATTENDED (showed up)
                           -> NO_SHOW (didn't show)
            -> CANCELLED (user cancelled within policy)
```

---

## Flow 12: Discovery & Public Browsing

No authentication required for discovery endpoints.

```
GROUP DISCOVERY:
  GET /groups/discover
    Filters: ?search=yoga&tags=fitness&city=Bucharest&country=RO
    Sorted by: member count (most popular first)
    Returns: { data: [{ id, name, slug, description, tags, joinPolicy, city, country, memberCount }], meta }

GROUP PUBLIC PROFILE:
  GET /groups/:id/public
    Returns: group info + instructor info + upcoming sessions (next 10)

INSTRUCTOR DISCOVERY:
  GET /profile/instructors/discover
    Filters: ?search=hiit&city=Bucharest&country=RO
    Sorted by: years of experience (most experienced first)
    Returns: { data: [{ firstName, lastName, displayName, bio, specializations,
                        yearsOfExperience, isAcceptingClients, city, country }], meta }

SESSION DISCOVERY:
  GET /sessions/discover
    Filters: ?search=yoga&page=1&limit=20
    Only returns PUBLIC visibility sessions

SELF-JOIN:
  POST /groups/:id/join -> For public OPEN groups (authenticated)

JOIN VIA LINK:
  POST /groups/join/:token -> For any group with a valid join link (authenticated)
```

---

## Flow 13: Client Relationships (Instructor-Client)

Client relationships are professional 1-to-1 connections between instructors and users. Either side can initiate, but both must agree. Separate from group membership.

### Why Clients?

- Instructors can create CLIENTS-visibility sessions (only their clients can see/join)
- Instructors can track notes about each client
- Group member lists show an `isClient` flag for each member
- Enables personal training workflows alongside group classes

### Request Flow

```
INSTRUCTOR INVITES A CLIENT:
  POST /clients/invite [INSTRUCTOR role]
    Body: { toUserId, message? }
    |
    +-- Check instructor has INSTRUCTOR role
    +-- Check no existing relationship or pending request
    +-- Create client_request (type: INSTRUCTOR_TO_CLIENT, status: PENDING)
    |
    v
  Pending request appears in user's incoming requests

USER REQUESTS TO BECOME A CLIENT:
  POST /clients/request/:instructorId [Authenticated]
    Body: { message? }
    |
    +-- Check target user has INSTRUCTOR role and isAcceptingClients=true
    +-- Check no existing relationship or pending request
    +-- Create client_request (type: CLIENT_TO_INSTRUCTOR, status: PENDING)
    |
    v
  Pending request appears in instructor's incoming requests

ACCEPT REQUEST:
  POST /clients/requests/:requestId/accept [Authenticated]
    |
    +-- Verify user is the recipient of the request
    +-- Create instructor_client record (status: ACTIVE)
    +-- Update request status to ACCEPTED
    |
    v
  Relationship is now active

DECLINE REQUEST:
  POST /clients/requests/:requestId/decline [Authenticated]
    +-- Verify user is the recipient
    +-- Update request status to DECLINED

CANCEL REQUEST:
  POST /clients/requests/:requestId/cancel [Authenticated]
    +-- Verify user is the sender
    +-- Update request status to CANCELLED
```

### Management Endpoints

```
Instructor endpoints:
  GET    /clients                -> List my clients (with pagination, status filter)
  PATCH  /clients/:clientId      -> Update notes or status (ACTIVE/ARCHIVED)
  DELETE /clients/:clientId      -> Archive client relationship

User endpoints:
  GET    /clients/my-instructors -> List instructors I'm a client of

Shared endpoints:
  GET    /clients/requests/pending              -> My pending incoming requests
  POST   /clients/requests/:requestId/accept    -> Accept
  POST   /clients/requests/:requestId/decline   -> Decline
  POST   /clients/requests/:requestId/cancel    -> Cancel own request
```

### Client Status

| Status | Description |
|--------|-------------|
| `ACTIVE` | Active client relationship |
| `ARCHIVED` | Instructor has archived the client (soft removal) |

---

## User Journeys

### Journey: New User Finding a Fitness Class

```
1. Open app (no auth required)
       |
2. Browse groups -> GET /groups/discover?tags=yoga&city=Bucharest
       |
3. Click on "Zen Yoga Studio" -> GET /groups/:id/public
       Shows: instructor bio, upcoming classes, member count
       |
4a. joinPolicy=OPEN -> Click "Join" -> POST /groups/:id/join
       Now a member! Can see GROUP-visibility sessions
       |
4b. joinPolicy=INVITE_ONLY -> Get a join link from the instructor
       POST /groups/join/:token
       |
5. Browse sessions -> GET /sessions (now sees group sessions too)
       |
6. Join a session -> POST /sessions/:id/join
       |
7. Before session -> POST /sessions/:id/confirm (optional)
       |
8. At session -> POST /sessions/:id/checkin
```

### Journey: Instructor Setting Up

```
1. Register -> POST /auth/register
       |
2. Verify email -> click link in email
       |
3. Become instructor -> POST /profile/instructor { displayName: "Coach Maria" }
       |
4. Complete profile -> PATCH /profile/instructor {
       bio, specializations, yearsOfExperience,
       isPublic: true,  <-- makes discoverable
       city, country, isAcceptingClients: true
     }
       |
5. Create group -> POST /groups {
       name: "Maria's Yoga & Pilates",
       tags: ["yoga", "pilates"],
       isPublic: true,   <-- makes discoverable
       joinPolicy: "OPEN", <-- anyone can join
       city: "Bucharest", country: "RO"
     }
       |
6. Generate join link -> POST /groups/:id/join-link
       Share link with potential members
       |
7. Create sessions -> POST /sessions {
       visibility: "PUBLIC",  <-- shows in session discovery
       groupId: "...",        <-- tied to the group
       ...schedule, capacity, pricing
     }
       |
8. Members join automatically or via join link or via invitation
       |
9. Manage attendance -> PATCH /sessions/:id/participants/:userId { status: "ATTENDED" }
```

### Journey: Instructor Managing Clients

```
1. Instructor invites a user to become a client
       POST /clients/invite { toUserId: "user-uuid" }
       |
2. User sees pending request
       GET /clients/requests/pending
       |
3. User accepts
       POST /clients/requests/:requestId/accept
       |
4. Instructor can now:
       +-- See user in client list: GET /clients
       +-- Add notes: PATCH /clients/:clientId { notes: "Working on flexibility" }
       +-- Create CLIENTS-visibility sessions only they can see
       +-- See isClient=true flag in group member lists
       |
5. To end the relationship:
       DELETE /clients/:clientId  -> archives the relationship
```

### Journey: User Requesting an Instructor

```
1. Browse instructors -> GET /profile/instructors/discover
       |
2. Find instructor with isAcceptingClients=true
       |
3. Request to become client -> POST /clients/request/:instructorId { message: "I'd like to train with you" }
       |
4. Instructor sees pending request -> GET /clients/requests/pending
       |
5. Instructor accepts -> POST /clients/requests/:requestId/accept
       |
6. User can now see CLIENTS-visibility sessions from this instructor
```

---

## Pagination

All list endpoints support pagination via query parameters:

```
GET /sessions?page=1&limit=20
GET /groups/:id/members?page=2&limit=10
GET /clients?page=1&limit=20&status=ACTIVE
```

| Parameter | Default | Min | Max |
|-----------|---------|-----|-----|
| `page` | 1 | 1 | - |
| `limit` | 20 | 1 | 100 |

Response shape:

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

## Future Improvements

| Category | Feature | Priority |
|----------|---------|----------|
| Auth | Refresh token rotation | Medium |
| Auth | Token invalidation on password reset | High |
| User | Email change flow with re-verification | Medium |
| Group | Ownership transfer | Medium |
| Group | APPROVAL join policy workflow | Medium |
| Session | Automated status transitions (SCHEDULED -> IN_PROGRESS -> COMPLETED) | Medium |
| Session | Reminder system (email/push before session) | Medium |
| Session | Waitlist when session is full | Low |
| Payment | Price/currency integration | Low |


Nice to Have
Ownership transfer for groups — Owner currently can't leave or transfer; must delete
Bulk invite for clients and group invitations
Configurable check-in window and cancellation cutoff — Currently hardcoded (15min before / 30min after; 2h cancellation policy)
Invitation expiry cleanup job — Expired invitations stay in DB forever