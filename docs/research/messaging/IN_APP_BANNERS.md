# In-app banners (the pop-up)

Status: messages and message requests now raise the banner (built 2026-11-20, from the live stream). Still open: the person's photo on bell items, and the Claude Design pass (§5).

## 1. What exists

`mh-notification-banner` (`beeactive-ui/projects/mobile/src/app/_shared/components/notification-banner/`), mounted once in `layouts/tabs/tabs.html`:
- One card at a time; a new one replaces the current one. It stays 5 seconds and can be swiped up or closed with ✕.
- Tapping it opens the notification centre on that row (`?open=<id>`), and the centre routes to the right screen.
- Its icon and colour come from the category (`notification-categories.config.ts`); title and body are the API's text in the reader's language.
- It stays quiet on the notification centre and on the screen the notification would open (`isOnTarget`).
- **Trigger:** the bell's unread count going up. The count is polled once a minute, and refreshed right away when a push arrives while the app is open. In the foreground the OS shows nothing, by design (`push-registration.service.ts`).

Push itself is live: APNs and FCM transports in `src/modules/notification/push/`, device registration in the app (production builds only).

## 2. Gaps

1. **New messages never show a banner.** Message notices write no bell row (`messaging/notifications.ts` sets `in_app: false`), and the banner only watches the bell. The chat stream already delivers `message.created` instantly (SSE, `MessagingRealtimeService.events$` in core), but nothing connects it to the banner. The 2026-11-18 audit lists this ("no in-app banner for a new message").
2. **Up to a minute late** for bell items when no push arrives (push turned off, or a dev build, which skips registration).
3. **Always a category icon**, even when there's a person behind the event (a client finished a workout, someone commented).
4. **Tapping goes through the centre.** That works, but a message should open the chat directly.

## 3. Plan

- **Message banner from the live stream.** On `message.created` from someone else, if you're not in that chat and it isn't muted: the sender's photo, name and first line. Tapping opens the chat. More messages from the same chat update the card ("3 new messages") instead of popping again. Later, group chats use the same banner ("Ana in Morning Runners").
- **Message request banner:** "{name} wants to message you" opens the requests list (see [WHO_CAN_MESSAGE.md](WHO_CAN_MESSAGE.md)).
- **Bell banners** stay as they are, plus the person's photo when there is one (needs the actor's avatar in the notification payload).
- A light haptic tap on arrival (`@capacitor/haptics` is installed).
- Open question: should banners stay quiet while a workout is being logged, apart from messages?

## 4. Which notifications pop up

Four visual families cover every type. Which family a type uses is decided by whether there's a person behind it, not by the module.

| Family | Looks like | Types (from `notification-types.ts`) |
|---|---|---|
| **Message** | sender's photo, name, first line | `MESSAGE_RECEIVED`, the new message request notice, group chat messages later |
| **From a person** | person's photo with a small category badge | `CLIENT_REQUEST_RECEIVED`, `CLIENT_INVITATION_RECEIVED`, `CLIENT_REQUEST_ACCEPTED`, `CLIENT_COMPLETED_WORKOUT`, `CLIENT_COMPLETED_PLAN`, `PARTICIPANT_JOINED`, `GROUP_INVITATION_RECEIVED`, `GROUP_JOIN_REQUEST_RECEIVED`, `POST_NEW_COMMENT`, `POST_PENDING_APPROVAL` |
| **Update** | category icon and colour | `SESSION_REMINDER_1H`, `SESSION_CANCELLED`, `SESSION_RESCHEDULED`, `PROGRAM_ASSIGNED`, `PLAN_ADJUSTED`, `GROUP_JOIN_REQUEST_APPROVED`, `POST_APPROVED`, `INVOICE_CREATED`, `INVOICE_PAID`, `PAYOUT_SENT` |
| **Needs attention** | the same card, clearly marked but calm | `PAYMENT_FAILED`, `INVOICE_OVERDUE`, `DISPUTE_OPENED`, `STRIPE_ACCOUNT_RESTRICTED` |

Bell only, no banner: the 24 h reminder, `PARTICIPANT_LEFT`, member joined or left, earnings summary, exercise forks, and endings that should land quietly (`CLIENT_RELATIONSHIP_ENDED`, `COACH_LEFT`, `CLIENT_REQUEST_DECLINED`).

## 5. Prompt for Claude Design: the banner

> Design the in-app notification banner for the MotionHive mobile app (Ionic, iOS and Android modes; light first, then dark). Read DECISIONS.md and DESIGN-PATTERNS.md on the canvas first, and log any new decision there.
>
> What it is: when something arrives while the app is open, a card drops in from the top, stays about 5 seconds, can be swiped up or closed, and opens the right screen when tapped. One at a time: a new one replaces the current one. It never shows on the screen it would open. A simple version exists today (category icon, title, two lines of text); redesign it and keep the hex avatar.
>
> Variants:
> 1. Message from a person: their photo, name, the first line. More quick messages from the same person update the card ("3 new messages") rather than popping again.
> 2. Message request from someone you aren't connected with: "Ana wants to message you".
> 3. Group chat message (later): the group logo with the sender's small photo, "Ana in Morning Runners".
> 4. Activity from a person: a client finished a workout, someone booked your class, a coaching request or invitation, a comment on your post. Their photo with a small category badge.
> 5. Updates with no person: session in 1 hour, session cancelled or moved, plan assigned, invoice or payout. Category icon and colour.
> 6. Needs attention: payment failed, invoice overdue. Calm, but clearly different from the rest.
>
> Show: the arrival and the swipe away; long names and long Romanian text at 130% text size; the banner over an open sheet and over the chat with the keyboard up; the notch and Dynamic Island safe area; the pressed state; and how a screen reader announces it.

## 6. Prompt for Claude Design: message requests

> Design message requests for MotionHive mobile messaging (Ionic, iOS and Android modes, light first, English and Romanian). Read DECISIONS.md and DESIGN-PATTERNS.md on the canvas first.
>
> People you're connected with (your coach or clients, a class you booked, your group's owner) write straight into your chats. Anyone else's first message arrives as a request, outside the main list. The sender can send one message until it's accepted.
>
> Screens:
> 1. Messages, with a "Message requests · 2" row at the top (RO "Solicitări de mesaje").
> 2. The requests list: photo, name, the first line, and a context line saying how you might know each other ("Group in common: Morning Runners", "Booked your Yoga class on 12 Nov", or "No groups or classes in common").
> 3. An open request: the message, the context, and an Accept / Delete / Block or report bar in place of the composer, with a note that the sender won't know you've seen it until you accept.
> 4. The sender's side after sending: the composer replaced by "You can write more after Ana accepts."
> 5. Privacy setting "Who can message you": Everyone / Everyone, as a request (default) / Only people I train with. Plus the profile's Message button when someone's messages are off.
