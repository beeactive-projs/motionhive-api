# Coach and client flows: audit, 2026-11-18

Read-only walk through invitation, becoming a client, assigning, communication and tracking, in the API, mobile and web, on `develop`. Nothing was changed or run. Authorization holds: no coach can read another coach's client by changing an id, coach reads go through `assertActiveCoachOf` and `isReadableByCoach`, and access to logs, photos and progress stops when a relationship ends.

## Status, 2026-11-19

Fixed: 1 and 2 (Unarchive is now "Invite again": the API refuses ACTIVE on a row that is not active, `client.restoreNeedsInvitation`, and a former client can be invited again; mobile and web changed, `unarchiveClient` removed from core), 3 (trainee coaching notifications open `/tabs/coaches?filter=yours`), 4 (the assign sheet reads every ACTIVE client, page after page, with a search and no past start date, which is 23), 5 (blocks work both ways in messaging: `messaging.youBlockedThem`, and a blocked person's chat stays out of the blocker's inbox), 6 in part (no new invitation or request between blocked people, `client.blockedPair`; an existing ACTIVE relationship is untouched: see below), 7 (message emails follow the preference, mute turns email off too), 8 (`GET /clients/requests/sent`, the web tab splits incoming from sent), 9 (the paused copy says missed days are marked skipped once it resumes), 10 (an archived client opens on an "ended" state and its training is never asked for), 11 (`programId` on `ListAssignmentsQueryDto`), 12 (web inbox opens `?conversationId=` and addresses the picker to `?to=` with `name`), 13 (a send counts once against the per-minute limit), 14 (blocking from chat details leaves the chat), 15 in part (a former coach can no longer read a plan in full, pause, resume or delete it: 404), 16 (archiving tells the client in the app, `client.coachEnded`), 17 in part (the coach cannot accept their own link and is told who accepted; the email is not matched, so a forwarded link still works), 19 (mobile tells "already invited" from "already your client"), 20 (a request that is no longer waiting reloads the list; accept and decline wait for a second tap), 21 (the coach's note shows on the mobile plan page), 22 ("X finished a workout" opens that client), 25 in part (web roster gives NO_PLAN a reason).

Still open: whether a block should end an ACTIVE coaching relationship (a product decision); 15's plan state when coaching ends (the client keeps the plan, it stays ACTIVE); 18 (badges refresh on tab change only); 24 (threads past the first 50); 25's paused plan counting as no plan (roster SQL); the English fallback names in client emails ("An instructor", "Your trainer") and progress feeds ("Client"), which only show for an account with no name.

## Verdict

The core paths work (invite, request, accept, assign, log review). It is not smooth end to end: four real breaks (a coach can re-attach a client who left; trainee coaching notifications dead-end on mobile; the mobile assign sheet hides clients past the 20 newest rows; blocking does not do what the app says), plus stale states and wrong copy.

## Broken

1. **A coach can make a former client theirs again, alone**: `client.service.ts:1667-1700` (`updateClient`) writes any status, so Unarchive on an archived row (mobile swipe `client-row.html:72-76` → `clients.ts:436`, client detail `:607`, web `client-profile.ts:716-731`) re-attaches a client who left, with no consent or notice, and reopens their coaches-only workouts. Fix: refuse ACTIVE on an archived row; restoring is a new invitation.
2. **Re-inviting a former client says "already your client"**: `client.service.ts:1001-1009` throws for any existing row, ARCHIVED included. Fix: throw only for ACTIVE.
3. **Mobile: every trainee coaching notification goes nowhere** (invitation received, request accepted or declined, coach left): `notification-deep-link.ts:131-143` has no `profile` tab `coaches`. Fix: route to `/tabs/coaches?filter=yours`; the spec at `notification-deep-link.spec.ts:150` pins the current behaviour.
4. **Mobile assign sheet shows only active clients among the 20 newest rows**: `assign-sheet.ts:411` calls `getClients()` with no params. Fix: `status: ACTIVE`, a higher limit and search or paging.
5. **Blocking is one-way and the hidden chat comes back**: `messaging-safety.service.ts:110` checks only one direction; the inbox has no block filter (`messaging.service.ts:541-585`).
6. **Blocks are ignored by coaching**: a blocked person can still request or be invited, and a blocked client stays ACTIVE with Message and Assign.
7. **Message emails ignore "email off" and mute**: `messaging/notifications.ts:83` sets `email: !suppressEmail`, overriding the stored preference (`notification.service.ts:228`). Fix: only ever override with `false`; `notifications.spec.ts:87-88` asserts the wrong behaviour.
8. **Web: a trainee's sent requests never show; a coach sees incoming ones as outgoing** (`web/.../profile/tabs/coaches/coaches.ts:117-119`).
9. **"Resuming shifts the schedule forward" is not true** (`en.json:2453`; `program-assignment.service.ts:448-462` only writes status): days passed during the pause are auto-skipped.
10. **Mobile: opening an archived client shows a raw "Not found" dialog and dead tabs** (`client-detail.store.ts:153, 477, 497`).
11. **A program's assignments list drops rows past 100 overall** (`assignments.store.ts:72-84`); needs `programId` on `ListAssignmentsQueryDto`.
12. **Web: Message from a client page opens an empty picker; email and bell links do not open the thread** (`inbox-page.ts:46-73`).
13. **Send limit is 15 a minute, not 30**: two counts into one bucket (`messaging.service.ts:216, 314`).
14. **Mobile: blocking from chat details leaves a dead chat** (`chat-details.ts:210-233`).

## Likely broken

15. **Ending a relationship leaves loose ends**: the ex-coach can still read assignments (`program-assignment.service.ts:438` checks ownership only) and pause or resume them; plans stay ACTIVE and keep being auto-skipped; messaging, groups and billing are untouched.
16. **A coach archiving a client sends email only, no in-app notification** (`client.service.ts:1722-1735`).
17. **Accepting through an invite link tells the coach nothing, and checks neither the email nor that the accepter is not the coach** (`acceptByToken`, `client.service.ts:2025-2100`).
18. **Mobile badges go stale**: Clients count and the Menu dot refresh only on tab change (`tabs.ts:307-327`).
19. **Mobile invite: every 409 reads "already invited"** (`invite.utils.ts:104-110`).
20. **A failed accept, decline or withdraw leaves a dead row or button** (`person.ts:413-441`, `clients.ts:477-547`, `coaches.ts`); the Coaches list stays stale 15 s after an accept.
21. **The coach's note at assign time never reaches a mobile trainee** (`plan.html`).
22. **"X finished a workout" lands on the Clients list, not the client** (`notification-deep-link.ts:65` ignores `entityId`).
23. **Mobile allows a past start date** (`assign-sheet.html:146`; the API does not check).
24. **Threads past the first 50 conversations**: blank header and disabled composer, history hidden after the first send, read state not synced across devices.
25. **Web roster: "Needs attention" with no reason for NO_PLAN**; a paused-only plan counts as no plan.

## Inconsistent

"This week" differs by side (coach: trailing 7 UTC days, now labelled "Last 7 days" on mobile; trainee: Monday to Sunday); a future plan reads "Started" and flags NEVER_STARTED; no app can cancel or delete an assignment; a paused plan vanishes from the trainee's app without a word; "They may have blocked you" though the API hides blocks; Message offered where the API refuses it (new accounts); web shows "Request" on every coach; no double-tap guard on accept and decline; `resendInvitation` reopens without re-checking; an email-only invite may not block a second; single invite by email reveals whether the address has an account; the tab's unread badge sums loaded rows; core type drift; wrong web copy; English literals from the API (`'Client'` in `progress.service.ts:916, 974`; `'An instructor'`, `'Your trainer'`, `'Your client'` in client emails `client.service.ts:929, 1052, 1836-1841`; admin moderation errors).

## Rough edges

Expired invites and requests vanish silently; mobile invites one person at a time against 10 an hour; the trainee can't read the coach's invitation message on mobile; a coach not taking clients shows no reason; signup through an expired link fails silently; registering without the link sends no in-app notice; one client per assign and no warning on a second assign of the same program; log review reports every failure as a connection problem; no reply path on plans or logs; no report action in mobile chat and no in-app banner for a new message; the web coach Progress tab is a placeholder.

## Missing tests

API: blocks and requests; PATCH ACTIVE on an archived row; re-invite after archive; `acceptByToken` email mismatch; an ex-coach reading or updating an assignment; resume and the nightly skip; block both ways; the messaging rate limit through `sendMessage`; channel override against a stored preference. Mobile: `ClientsStore`, `CoachesStore`, `PersonStore`, `MoreBadgesService`, the assign sheet, `assignments.store`, `client-detail.store`, log review, `isDuplicateInvite`. Web: the profile coaches tab, pending requests, assign dialog, roster, client profile, messages.

## Suggested order

1. Items 1 and 2 (consent), 3 (dead notifications), 4 (assign sheet), 7 (email preference).
2. Blocking (5, 6, 14) as one change.
3. Ending a relationship (15, 10, 16) as one decision: what the coach keeps and loses.
4. The rest.
