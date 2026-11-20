# Sending things in a message (share cards)

Status: phase 1 built 2026-11-20 (API migration 092 + mobile): sessions, groups, coaches, exercises and starters. Owner's sketch: a session card inside the chat (date tile, title, time, length, place, seats, "View session"). Web draws a share as its text (the caption, or the thing's name); cards on web are phase 2.

## 1. Decisions (owner, 2026-11-20)

- **Only public things can be sent.** Anything anyone could already open: a public routine, program, exercise, open session, public group, coach profile. Nothing private, nothing members-only.
- **No copies for now.** Receiving a routine opens it; "Save a copy" is not part of this.
- **Built to grow:** more item types later, group chats when they exist, and sharing outside the app (a link) after that.

Because only public things travel, a card never needs per-reader permission rules: what it shows is public by definition. That makes everything simpler than the first version of this doc, which also covered private items.

## 2. What counts as public, per type

| Type | Public when | Today that means |
|---|---|---|
| `SESSION` | the series is open to anyone (`session_template.access = 'OPEN'`), active, the occurrence not cancelled | any bookable open class |
| `GROUP` | `group.is_public` and active | public groups |
| `COACH` | `instructor_profile.is_public` | coaches in the directory |
| `EXERCISE` | MotionHive's own (`source = 'SYSTEM'`) or marked `PUBLIC` | the 883 catalog exercises + public ones coaches made |
| `PROGRAM` (routine or program) | MotionHive's own: `source = 'SYSTEM'`, no owner | the starters. Programs have no public flag yet; when coaches can publish publicly, they join here. |
| `WORKOUT` (finished) | `visibility = 'PUBLIC'`, completed | phase 2 |

The rule is checked twice: **when sending** (refused with `share.notShareable` if it isn't public) and **every time the card is shown**. Something that later turns private or gets deleted shows "No longer available", and the card never says which of the two happened.

## 3. Database

One new table, and one column on `conversation`.

```sql
CREATE TABLE message_attachment (
  id           CHAR(36)     PRIMARY KEY DEFAULT gen_random_uuid()::char(36),
  message_id   CHAR(36)     NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  target_type  VARCHAR(24)  NOT NULL,   -- SESSION | GROUP | COACH | EXERCISE | PROGRAM | WORKOUT
  target_id    CHAR(36)     NOT NULL,   -- no FK: it points at a different table per type
  position     SMALLINT     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_message_attachment_type CHECK (target_type IN (...)),
  UNIQUE (message_id, position)
);
CREATE INDEX idx_message_attachment_target ON message_attachment (target_type, target_id);

ALTER TABLE conversation ADD COLUMN last_message_attachment_type VARCHAR(24) NULL;
```

**Why a table and not a JSON field on the message:**
- It cascades with the message, and account erasure can clear it with the sender's messages.
- The `(target_type, target_id)` index answers "where was this shared". That serves moderation, a takedown when an item is removed, and later a "shared 12 times" count, without scanning JSON.
- A message can carry more than one attachment later (photos are the obvious next one), using `position`.
- Group chats need nothing new: attachments hang off messages, whatever kind of conversation the message is in.

**What is stored:** only the type and the id. No title, no snapshot. The card is drawn from the live item each time, so it's never stale and never keeps something that has since turned private.

**The message itself:** stays `kind = 'TEXT'`. `body` holds the sender's optional caption and may be empty (the 4000-character CHECK already allows it).

`last_message_attachment_type` lets the chat list say "Shared a session" / "A trimis o sesiune" in each reader's language when there's no caption.

## 4. How it works

**The share registry: a new `src/modules/share/` module.** One small "target" per type, each answering three questions:
1. Is this id public right now? Used when sending.
2. The cards for these ids, in one query per type. Public fields only, the same for every reader.
3. Its public link. Used later, for sharing outside the app.

The targets read with plain SQL, like `category/category-sql.ts`, so the module imports no session, group or workout code and anything can use it without import cycles: messaging now, group posts and the website later. Each target has tests that pin its "public" rule to the rule its own module uses, so the two can't drift apart silently.

**Sending**
- `POST /messaging/messages` takes an optional `attachment: { type, id }`; the body may be empty when an attachment is there.
- `POST /messaging/shares` sends one item to up to 10 people at once (`recipientIds`, `attachment`, optional `caption`). It returns a result per person: sent, waiting (a message request), or refused. One person refusing doesn't stop the rest. It's one route because a phone looping single sends would hit the per-route limit.
- A share is an ordinary message: the request rules apply (it counts toward the 3, or 10), and so do blocks, mutes and archive.

**Reading**
- Every message carries `attachments: [{ type, id, card }]`, resolved in one batch for the page of messages. `card.state` is one of:
  - `AVAILABLE`, with the public fields;
  - `ENDED` (a session that's over);
  - `UNAVAILABLE`.
- **App versions already in the stores** only know `body`. For them, a message with an attachment and no caption returns the item's title as `body`, worked out when it's read; that's safe because the item is public. New apps read a separate `caption` field and the card.
- The live `message.created` event carries the same attachments.
- **Push and the chat list:** "Ana shared a session" plus the caption, in the reader's language. Never details beyond the title.

**What the card shows** (public fields only):

| Type | Fields |
|---|---|
| Session | date, start time, length, title, place name (never the address or meeting link), seats taken / capacity |
| Group | logo, name, city, member count, join policy |
| Coach | photo, name, city, categories, taking clients |
| Exercise | picture, name (translated), main muscles, equipment |
| Program | name (translated), routine or program, level, length, number of workouts |
| Workout | name, date, length, volume, records |

Things that depend on the reader ("you're booked", "you're a member") are not on the card. The screen it opens shows them, so the card stays identical for everyone and can be reused as is in group chats and outside the app.

## 5. Mobile (built)

As built: `_shared/components/share-card` (one shell, a body per kind, AVAILABLE / ENDED / UNAVAILABLE), `_shared/components/send-to-sheet` opened through `SendToService` (one sheet in the tab shell), and a paper-plane Send button in the header of the session page, group page and preview, coach profile, exercise page and starter routine. The caption sits above its card. On a narrow phone at large text the card takes the whole row and its tile moves above the text.

Planned as:

- **`mh-share-card`:** one shell (a top strip in the type's colour, the body, one action row) with a body per type and the three states. Tapping opens the existing detail screen in the current stack.
- **A "Send" action** that appears only on public items, next to the existing Share: session detail, group page, coach profile, exercise detail, starter routine or program page.
- **A "Send to…" sheet:** recent chats first, then search, pick up to 10, an optional caption. It says "arrives as a message request" for people you aren't connected with (from `GET /messaging/reach/:userId`).
- **Core:** the message model gains `caption` and `attachments`; the store and the realtime handler carry them.

## 6. Long-term plan

| When | What | What it reuses |
|---|---|---|
| Phase 1 | Sessions, groups, coaches, exercises, starter programs in direct messages | new table + registry |
| Phase 2 | Public finished workouts; web shows the cards | a new type value + one target + one card body |
| Group chats | Cards in group conversations | nothing new: attachments belong to messages |
| Group posts | A post can carry a card | a `post_attachment` table with the same `target_type` list, the same registry and the same card component |
| Outside the app | "Share" sends a link that opens the item on the website (signed out) or in the app (universal link), with a preview image and title built from the same card | the registry's public link; needs public web pages for sessions, exercises and starters (groups and coach profiles have some already) |
| Later, if wanted | Coaches publishing programs publicly | the `PROGRAM` target's rule gains that case |
| Later, if wanted | Private items or "Save a copy" | a grant on top (`share_grant`), never by loosening the public rule |
| Later, if wanted | Photos in messages | the same table, a new type pointing at the private bucket. Brings moderation duties for uploaded images, so it's its own decision. |

**Adding a new type** is always the same three steps: a value in the CHECK (a one-line migration), a target in the registry, and a card body in the app. Rows already stored never change.

## 7. Size

| Phase | Work | Size |
|---|---|---|
| 1, API | Migration, registry with 5 targets, send + bulk send, attachments on reads and live events, preview and push copy in EN/RO, tests | 2 to 3 days |
| 1, mobile | Card component (5 types × 3 states), Send to sheet, Send on 5 screens, chat rendering | 4 to 5 days |
| 2, web | Cards in the inbox | 1 to 2 days |

## 8. Prompt for Claude Design

> Design share cards for MotionHive mobile messaging (Ionic, iOS and Android modes, light first, English and Romanian). Read DECISIONS.md and DESIGN-PATTERNS.md on the canvas first. Start from the session card sketch already drawn (date tile, title, time, length, place, seats bar, "View session").
>
> People can send public things into a chat, with an optional caption above: an open session, a public group, a coach profile, an exercise, a MotionHive routine or program, and later a public finished workout. Each card has one shell (a coloured top strip, a body, one action row: View session, View group, View profile, Open) and a body per type. Show three states: available, "This session has ended", and "No longer available". The card looks the same for everyone, so nothing like "you're booked" on it.
>
> Also design the "Send to…" sheet opened from a Send action on those screens: recent chats first, then search people, pick up to 10, an optional caption, Send. It notes quietly when someone will get it as a message request.
>
> Show the cards in a thread mixed with text bubbles, sent and received, at 130% text size and with long Romanian titles.
