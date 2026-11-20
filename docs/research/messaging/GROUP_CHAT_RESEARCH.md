# Group chat: research

Status: research only, 2026-11-20. Not scheduled. Direct messages and the request rules are in [WHO_CAN_MESSAGE.md](WHO_CAN_MESSAGE.md).

**Verdict: medium difficulty.** The data layer was built for group chats from the start, so this needs no rework. The effort is in four things around the chat: keeping its members in step with the group, notification noise, moderation, and the inbox and chat screens on both apps.

## 1. What already exists

**Database (migration 042, designed "group-ready from day one")**
- `conversation.type` is `DIRECT` or `GROUP`, with `name`, `avatar_url` and `created_by_id` reserved for groups.
- `conversation_participant.role` is `MEMBER`, `ADMIN` or `OWNER`. `left_at` plus a partial unique index let someone leave and rejoin later.
- `conversation_membership_event` records `JOINED`, `LEFT`, `ADDED`, `REMOVED` and `ROLE_CHANGED`, and `message.kind` has `SYSTEM_JOIN`, `SYSTEM_LEAVE`, `SYSTEM_RENAME` and `SYSTEM_ROLE_CHANGE`. `sender_id` is nullable for those system lines. Nothing writes any of these yet.
- Each person's state already works per participant: `last_read_at`, `muted_until`, cleared history (`cleared_at`, migration 070), marked unread (migration 068).

**Service and apps**
- Leaving already exists and refuses only DIRECT chats (`messaging.cannotLeaveDirect`).
- The core app model has `ConversationType = 'DIRECT' | 'GROUP'`, and `otherUser` is documented as null for groups.
- The web inbox already has a `system-event` component for join and leave lines.
- Group events exist for syncing: `group.membership.ended` and `group.deleted` (`src/modules/group/group.events.ts`).
- Groups already have a board that isn't live: posts and comments, with `memberPostPolicy` and approvals. A chat would be the live side. Posts stay for announcements that should last and be easy to find later.

## 2. What is missing

### API
1. **The link.** A migration adds `conversation.group_id` (FK to `group`, unique): one chat per group.
2. **Sending by conversation.** Today `sendMessage(senderId, recipientId, body)` addresses a person. Add `POST /conversations/:id/messages`, which checks participation and the group's write rule. The DM route stays as it is.
3. **Inbox rows for groups.** The group's name and logo, the member count, and the sender's first name in the preview ("Ana: see you at 7").
4. **Membership sync, the part that has to be right.** Joining (open join, approved request, accepted invitation, join link) adds a participant and a `SYSTEM_JOIN` line. Leaving or removal sets `left_at` (`group.membership.ended` already fires). Role changes map OWNER to OWNER and MODERATOR to ADMIN. Deleting the group archives its chat (`group.deleted`). There is no join event today, so add `group.membership.started`. Existing groups need a backfill when chat is switched on.
5. **Who can write.** Everyone, or only the owner and moderators (an announcements channel), the same idea as `memberPostPolicy`.
6. **Moderation.** The owner and moderators can remove any message (the `[deleted]` tombstone exists). Taking someone out of the chat means removing them from the group. Per-message reports already work.
7. **Blocks inside a group.** You can't keep someone you blocked out of a shared group. The usual answer: their messages show collapsed for you ("Message from someone you blocked", tap to show). Be honest in the copy that they can still read what you write in the group.
8. **History for newcomers.** Recommended: a new member sees the chat from the day they joined. Set their `cleared_at` to the join time, which already hides older messages. The privacy reasoning: people were talking before this person was there.
9. **Read state.** No per-person read receipts in groups (privacy, and the cost of the fan-out). Unread counts per person already work.
10. **Notifications, the hardest part to get right.**
    - No email for group chat messages.
    - Push collapses per chat: one push, then "4 new messages in Morning Runners", at most one per chat every few minutes while it's unread.
    - Big groups (say over 50 members) start with push muted. Later, @mentions push through the mute.
    - Push fan-out goes through the notifications queue (BullMQ), never inline in the send.
11. **Live delivery.** SSE emits per user, in process (`MessagingEventsService` on EventEmitter2, one API instance). A group message becomes one event per participant, which is fine on one instance for groups of a few hundred. Running several API instances would need Redis pub/sub, and Redis is already there for BullMQ.
12. **Limits.** The per-conversation send limit exists. Add a velocity alarm per group chat, and a size cap for chat (for example 500 members), or let the owner switch chat on per group.
13. **Legal check before public groups.** DSA recital 14 keeps private messaging between "a finite number of persons determined by the sender" outside the online platform rules. A chat in a public group that anyone can join may count as dissemination to the public, which brings notice-and-action duties: we have reports and moderation, but we'd also need to tell the author why a message was removed (a statement of reasons). Private and approval-only groups are the safer start.

### Mobile
- A group row in Messages (logo, "Ana: ...", unread count).
- The group chat screen: sender name and photo on others' bubbles, system lines for join and leave, the "announcements only" notice when you can't write.
- Chat details: members, mute, leave the chat, the owner's tools.
- A way in from the group page (a Chat tab or button) and from the group's banner notifications.

### Web
- The same in the inbox. `conversation-row`, `chat-thread` and `system-event` exist and need group variants.

## 3. Scope options

| Option | What it is | Notes |
|---|---|---|
| **A. One chat per group (recommended first)** | every group gets a chat; its members are the group's members | The members, roles and moderator (the owner) already exist. The most requested kind. |
| B. Small chats a coach makes | a coach plus a few clients, picked by hand | Needs a "new chat, add people" flow and its own admin rules. Good second step. |
| C. A chat per session | the people booked into one class | Useful for logistics but short-lived. Could reuse A's code later. |

## 4. Rough effort

API 4 to 6 days (sync, the notification collapse and tests included), mobile 3 to 5, web 2 to 3. Most of the risk is in membership sync and notification noise, not in sending messages.

## 5. Benchmarks

- Strava shipped group messaging together with DMs in 2023, aimed at organising rides and runs.
- In WhatsApp groups new members don't see messages sent before they joined. Announcements-only groups are a standard pattern there.

## 6. Questions for the owner

1. Chat on for every group by default, or does the owner switch it on?
2. Who writes by default: everyone, with "announcements only" as an option?
3. History for newcomers: from the day they join (recommended), or everything?
4. Should big groups start with push muted?
5. Public groups: wait for the DSA check and start with private and approval-only groups?
6. Does sharing a group chat make two people "connected" for direct messages? (Recommended: no. They go through message requests, with the group as the context line.)

## Sources

- [You can finally send direct and group messages on Strava (BikeRadar)](https://www.bikeradar.com/news/you-can-finally-send-direct-and-group-messages-on-strava)
- [Strava introduces messaging (Cycling Weekly)](https://cyclingweekly.com/news/strava-introduces-messaging)
- `migrations/042_messaging_foundation.sql`, `docs/plans/messaging-backend-plan.md` §8 and §10
