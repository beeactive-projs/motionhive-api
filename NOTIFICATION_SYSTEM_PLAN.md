# Notification System - Architecture Plan

> This document defines the long-term notification system for BeeActive.
> The dummy module (`src/modules/notification/`) provides placeholder methods
> that can be called from existing services now and wired to real delivery later.

---

## Architecture Overview

```
Event Source → NotificationService.notify() → Check Preferences → Deliver
                                                                   ├── In-app (DB row)
                                                                   ├── Email (Resend)
                                                                   └── Push (Firebase FCM)
```

**Phase 1 (Current)**: Dummy module with `notify()` that logs + stores in-app notification
**Phase 2**: Wire up email delivery through preferences check
**Phase 3**: Add push notifications via Firebase Cloud Messaging
**Phase 4**: Move to Bull queue for async processing

---

## Database Entities

### notification
| Column | Type | Notes |
|--------|------|-------|
| id | CHAR(36) UUID | PK |
| user_id | CHAR(36) | FK → user, indexed |
| type | VARCHAR(50) | Notification type enum key |
| title | VARCHAR(255) | Short notification title |
| body | TEXT | Notification body |
| data | JSONB | Deep link payload (screen, entityId, action) |
| is_read | BOOLEAN | Default false |
| read_at | TIMESTAMP | NULL until read |
| created_at | TIMESTAMP | |

### notification_preference
| Column | Type | Notes |
|--------|------|-------|
| id | CHAR(36) UUID | PK |
| user_id | CHAR(36) | FK → user |
| notification_type | VARCHAR(50) | Matches notification type |
| email_enabled | BOOLEAN | Default true |
| push_enabled | BOOLEAN | Default true |
| in_app_enabled | BOOLEAN | Default true |
| UNIQUE(user_id, notification_type) | | |

### device_push_token
| Column | Type | Notes |
|--------|------|-------|
| id | CHAR(36) UUID | PK |
| user_id | CHAR(36) | FK → user |
| token | VARCHAR(255) | FCM/APNS token, UNIQUE |
| platform | VARCHAR(10) | 'ios', 'android', 'web' |
| is_active | BOOLEAN | Default true |
| last_used_at | TIMESTAMP | Updated on push send |
| created_at | TIMESTAMP | |

---

## Notification Types

| Type Key | Trigger | Default Channels | Deep Link |
|----------|---------|-----------------|-----------|
| SESSION_REMINDER_24H | Cron: 24h before session | Email + Push + In-app | session-detail/:id |
| SESSION_REMINDER_1H | Cron: 1h before session | Push + In-app | session-detail/:id |
| SESSION_CANCELLED | Instructor cancels session | Email + Push + In-app | sessions |
| SESSION_RESCHEDULED | Instructor reschedules | Email + Push + In-app | session-detail/:id |
| SESSION_STATUS_CHANGED | Instructor changes participant status | Email + In-app | session-detail/:id |
| PARTICIPANT_JOINED | User joins instructor's session | In-app | session-detail/:id |
| PARTICIPANT_LEFT | User leaves instructor's session | In-app | session-detail/:id |
| CLIENT_REQUEST_RECEIVED | User requests to be client | Email + In-app | clients/requests |
| CLIENT_REQUEST_ACCEPTED | Instructor accepts request | Email + Push + In-app | my-instructors |
| CLIENT_INVITATION_RECEIVED | Instructor invites as client | Email + In-app | clients/requests |
| GROUP_INVITATION_RECEIVED | Owner invites to group | Email + In-app | invitations |
| GROUP_INVITATION_ACCEPTED | Invitee accepts | In-app | groups/:id/members |
| GROUP_MEMBER_JOINED | New member joins group | In-app | groups/:id/members |
| GROUP_MEMBER_LEFT | Member leaves group | In-app | groups/:id/members |

---

## API Endpoints

```
GET    /notifications                    → Paginated list (unread first, then by date)
GET    /notifications/unread-count       → { count: number } for badge
PATCH  /notifications/:id/read          → Mark single as read
POST   /notifications/read-all          → Mark all as read
DELETE /notifications/:id               → Delete single notification

GET    /notifications/preferences        → Get user's notification preferences
PATCH  /notifications/preferences       → Bulk update preferences

POST   /devices/push-token              → Register device push token
DELETE /devices/push-token/:token       → Unregister device token
```

---

## NotificationService Interface

```typescript
interface NotifyParams {
  userId: string;           // recipient
  type: NotificationType;   // enum key
  title: string;
  body: string;
  data?: {                  // deep link payload
    screen: string;
    entityId?: string;
    action?: string;
  };
}

class NotificationService {
  // Core method — called from any service that needs to notify
  async notify(params: NotifyParams): Promise<void>;

  // Batch notify — for session cancellations affecting many users
  async notifyMany(userIds: string[], params: Omit<NotifyParams, 'userId'>): Promise<void>;

  // Query methods
  async getNotifications(userId: string, page: number, limit: number): Promise<PaginatedResponse<Notification>>;
  async getUnreadCount(userId: string): Promise<number>;
  async markAsRead(notificationId: string, userId: string): Promise<void>;
  async markAllAsRead(userId: string): Promise<void>;
  async deleteNotification(notificationId: string, userId: string): Promise<void>;

  // Preferences
  async getPreferences(userId: string): Promise<NotificationPreference[]>;
  async updatePreferences(userId: string, updates: UpdatePreferencesDto): Promise<void>;
}
```

---

## Integration Points (Where notify() Should Be Called)

### Session Module
- `session.service.ts` → `joinSession()` → `notify(instructor, PARTICIPANT_JOINED)`
- `session.service.ts` → `leaveSession()` → `notify(instructor, PARTICIPANT_LEFT)`
- `session.service.ts` → `updateParticipantStatus()` → `notify(participant, SESSION_STATUS_CHANGED)`
- `session.service.ts` → `notifyParticipantsOfCancellation()` → `notifyMany(participants, SESSION_CANCELLED)`

### Invitation Module
- `invitation.service.ts` → `create()` → `notify(invitee, GROUP_INVITATION_RECEIVED)`
- `invitation.service.ts` → `accept()` → `notify(inviter, GROUP_INVITATION_ACCEPTED)`

### Client Module
- `client.service.ts` → `sendClientInvitation()` → `notify(targetUser, CLIENT_INVITATION_RECEIVED)`
- `client.service.ts` → `requestToBeClient()` → `notify(instructor, CLIENT_REQUEST_RECEIVED)`
- `client.service.ts` → `acceptRequest()` → `notify(requester, CLIENT_REQUEST_ACCEPTED)`

### Group Module
- `group.service.ts` → `selfJoinGroup()` → `notify(instructor, GROUP_MEMBER_JOINED)`
- `group.service.ts` → `joinViaLink()` → `notify(instructor, GROUP_MEMBER_JOINED)`
- `group.service.ts` → `leaveGroup()` → `notify(instructor, GROUP_MEMBER_LEFT)`

### Cron Jobs (Future)
- Session reminder cron → `notifyMany(participants, SESSION_REMINDER_24H)`
- Session reminder cron → `notifyMany(participants, SESSION_REMINDER_1H)`

---

## Migration (when implementing)

```sql
CREATE TABLE notification (
  id CHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id CHAR(36) NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  data JSONB,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_user_id ON notification(user_id);
CREATE INDEX idx_notification_user_unread ON notification(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notification_created_at ON notification(created_at DESC);

CREATE TABLE notification_preference (
  id CHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id CHAR(36) NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  notification_type VARCHAR(50) NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(user_id, notification_type)
);

CREATE TABLE device_push_token (
  id CHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id CHAR(36) NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_device_push_token_user_id ON device_push_token(user_id);
```

---

## Phase Timeline

| Phase | What | Dependencies |
|-------|------|-------------|
| 1 | Dummy module, in-app storage, REST endpoints | None |
| 2 | Email delivery through preference checks | EmailService (exists) |
| 3 | Push notifications via FCM | firebase-admin, device token API |
| 4 | Bull queue for async delivery | Redis (configured), Bull (imported) |
| 5 | WebSocket gateway for real-time delivery | socket.io |
