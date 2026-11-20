# Who can message whom

Status: decided and built 2026-11-20 (owner's answers in §7): API (migrations 090, 091) and the mobile app. Web still lists requests and archived chats among its chats (see §5).

Related: [GROUP_CHAT_RESEARCH.md](GROUP_CHAT_RESEARCH.md) (group chats, separate topic), [IN_APP_BANNERS.md](IN_APP_BANNERS.md) (the pop-up when a message arrives).

## 1. What the app does today

Anyone signed in can write to anyone. `MessagingSafetyService.canMessage` (`src/modules/messaging/messaging-safety.service.ts`) stops only three cases:

| Case | Result |
|---|---|
| The sender's messaging is suspended by staff | 403 `messaging.suspended` |
| The recipient blocked the sender | silent drop: looks sent, nothing is written |
| The sender blocked the recipient | 403 `messaging.youBlockedThem` |
| The sender's account is younger than 48 h and has no ACTIVE coaching link with the recipient | 403 `messaging.newAccountLimited` |

People are reachable from almost everywhere in the mobile app: Message on a person's profile, Discover coach cards, the Coaches list, group member actions, booking details, and the New message picker. The picker searches every account by name or handle through `/users/search` (an exact email matches too). The first send creates the conversation (`findOrCreateDirectConversation`); there is no accept step. The recipient gets a push for every message and an email for the first one in an hour.

This is wider than what was planned. `docs/plans/messaging-backend-plan.md` §1 says v1 DMs are "between two users who have an ACTIVE InstructorClient relationship"; the code never enforced it. The 2026-11-19 audit left "the who-may-message policy" open.

## 2. How risky is open messaging?

### Legally: low

- **The privacy policy already covers it.** Section 2 lists "To enable user-to-user communications" and section 4 says "Other users will be able to view descriptions of your activity, communicate with you within our Services, and view your profile." The legal basis is the contract (GDPR Art. 6(1)(b)): messaging is part of the service people sign up for.
- **The DSA's platform duties don't apply to private messages.** One-to-one messages go to "a finite number of persons determined by the sender", which DSA recital 14 puts outside "dissemination to the public". (Group chats in public groups may be different: see the group chat doc.)
- **No telecom rules.** A chat that is a minor ancillary feature of another service is excluded from the EU definition of an interpersonal communications service (EECC Art. 2(5)).

This is a reading of the texts, not legal advice. A short check with a lawyer before a public launch is cheap.

### The privacy concern raised earlier is about search, not messaging

The earlier discussion was about people finding someone's profile. The rule behind it is GDPR **Art. 25(2), data protection by default**: by default, personal data must not be made accessible "without the individual's intervention to an indefinite number of natural persons". Regulators apply it to profile visibility (the Irish DPC's TikTok decision on child accounts being public by default).

A sentence in the privacy policy doesn't satisfy this. The policy informs people (Art. 13), but Art. 25(2) is about the default setting, so the fix is a switch the person controls. That is why plain members are kept out of global search today (`search-index.service.ts` writes them with `is_public = false`). Note that `/users/search` already finds any member by name for any signed-in account (name and photo default to PUBLIC in `profile-privacy.ts`), so this is partly open already. See decision 7.

### The real risk is trust and safety

- **Unwanted contact.** Fitness apps have a known problem with strangers writing to people (mostly women) after seeing them in a group or a class. Strava launched messaging with a "Who can message you" setting from day one.
- **Coach spam.** A coach can write to every member of every public group. Nothing limits how many new conversations someone starts in a day; the only limit is 30 messages a minute.
- **Minors.** The Terms say 18+, but there is no age check (parked with onboarding). Open DMs from strangers to a minor is the worst case for any app.
- **Only after-the-fact tools.** Today the recipient can block, mute or report, but only after the message is already in their chat list, with a push and an email.

**Message requests fix all four without stopping anyone from reaching out**, which is what the owner wants ("I don't want to restrict people").

## 3. Recommendation: message requests

The first message *is* the request. There is no separate "ask permission to message" step that someone must accept before you can type: that adds a round trip and a notification for nothing.

- Between **connected** people (§3.1), messages go straight to the chat list, as today.
- Anyone else can still write, but their message lands in the recipient's **Message requests**, kept out of the main list, with no email.
- The recipient sees who it is, the message, and how they might know each other. They **Accept**, **Delete**, or **Block or report**. Replying also accepts.
- Until it's accepted, the sender can send **up to 3 messages**, or **up to 10** when writing to a coach who is taking clients (a lead should have room to explain). Then they see "You can write more after Ana accepts."
- **No read receipts while it's a request**, so the sender can't tell read from ignored from deleted. Same reasoning as the silent drop for blocks.
- Once accepted, it's an ordinary chat until someone blocks.

### 3.1 Who counts as connected (skips the request)

Both directions unless stated.

| Link | Why |
|---|---|
| ACTIVE coaching (`instructor_client`) | the core relationship |
| An accepted conversation already exists | accepted stays accepted |
| They sent **you** a coaching request or invitation that is still pending: you may write to them | they reached out, and you can always answer someone who asked. The person who sent it does not get this. |
| A booking (confirmed, pending approval or waitlisted) in that coach's session, upcoming or ended in the last 14 days | "running late", "where's the entrance", "the room changed" |
| A group's owner or moderator and a member of that group | the owner has to be able to reach members |

**Not connected:** two members of the same group, two people booked into the same class, a coach and someone who has only seen their profile. These go through requests, with the shared group or class shown as the context line, so the recipient knows why this person is writing.

All of this is one SQL check over `instructor_client`, `client_request`, `session_participant` + `session_instance.instructor_id`, and `group_member` + `group.instructor_id`.

### 3.2 Former coach, former client

The question: coaching ended (the relationship is ARCHIVED). Can they still write to each other?

**Recommendation: ending coaching doesn't change the chat.**

- They almost always already have an accepted conversation, and it stays open both ways.
- There are real reasons to talk after coaching: the last invoice, a refund, a dispute, "can I come back in spring?". Billing still allows ARCHIVED clients (`assertBillableClient`), so money questions have to stay reachable.
- Whoever wants silence has Mute and Block. Since 2026-11-19 a block also ends coaching both ways.
- If they never wrote to each other, a new message is a request like anyone else's.
- The same holds for someone who stopped coaching altogether: being a coach, now or in the past, never skips requests.
- Either side can also tidy it away (owner, 2026-11-20), and this applies to every chat, not only former coaching:
  - **Delete chat** (exists): the history goes for you, the other side keeps theirs. If they write again, the chat comes back with only the new message.
  - **Archive** (new): the chat leaves the list for an Archived folder and stays there when new messages arrive, with no push or email and no count on the tab badge. Unarchive by hand, or by writing in it yourself.
  - **Block** stays the way to stop someone for good.
- Delete does not turn the chat back into a request. That would tell the other person you deleted it the moment their next message became a request.

Rejected alternative: turning the chat back into a request when coaching ends. It punishes the normal, friendly ending to guard against the rare bad one, which Block already handles.

### 3.3 A setting: "Who can message you"

In Privacy (mobile) and Profile > Safety (web). Three choices, modelled on Strava's:

| Choice | What happens |
|---|---|
| Everyone | strangers land straight in your chats (a coach who wants every lead) |
| **Everyone, as a request** (default) | connected people go straight in; everyone else arrives as a message request |
| Only people I train with | nobody else can start a chat; the Message button on your profile says messages are off |

The default is the same for everyone, coaches included. A coach who wants leads to land straight in their chats switches to Everyone. Showing "messages are off" on a profile is fine: it reveals a setting, not a block. Blocks stay silent.

### 3.4 Spam brakes that come with it

- **20 new requests per sender per day** (a constant to tune). That stops a coach from writing to a whole group.
- **The 48 h new-account rule stays.** A new account writes only to connections; it can't send requests.
- **A deleted request is final for that sender.** Their one message stays "waiting" on their side; they can't send another. If they become connected later (a booking, coaching), the chat opens normally.

### 3.5 Notifications

- **A new request** gets one in-app row and a push: "{name} wants to message you" / "{name} vrea să-ți scrie". **No email**: we never email a stranger's words to someone who didn't ask for them.
- **Accepting** sends no notice. The sender's composer opens through the live stream; the first reply notifies as usual.
- **Badges:** the Messages tab badge counts chats only. Requests show their own count on the requests row (as Instagram does), so a spammer can't light up someone's tab badge.

## 4. The name

"Requests" already means three things in the app: coaching requests (the Requests filter on Clients and on Coaches), group join requests, and booking requests in sessions. A fourth "Requests" inside Messages would be confusing, especially for coaches, who see the coaching one every day.

| | EN | RO | Verdict |
|---|---|---|---|
| **A (recommended)** | Message requests | Solicitări de mesaje (short: Solicitări) | The term people know from Instagram and Messenger in both languages. RO "Solicitări" doesn't clash with the app's "Cereri". Never shorten the EN to just "Requests". |
| B | Hellos ("Ana said hello") | Saluturi | Warm and unique, but "Ai 2 saluturi" reads oddly in Romanian and the meaning isn't obvious at first. |
| C | Knocks ("Ana knocked") | "a bătut la ușă" | Cute in English, long and clumsy in Romanian. |

Hive words like "buzz" don't carry into Romanian, so the warmth goes into the copy around the name:

| Where | EN | RO |
|---|---|---|
| Row at the top of Messages | Message requests · 2 | Solicitări de mesaje · 2 |
| Request card | {name} wants to message you | {name} vrea să-ți scrie |
| Context line | Group in common: Morning Runners | Grup în comun: Morning Runners |
| Context line, the writer coaches | Coach on MotionHive | Antrenează pe MotionHive |
| Context line, nothing shared | No groups in common | Niciun grup în comun |
| Recipient's note | {name} won't know you've seen this until you accept. | {name} nu va ști că ai văzut mesajul până nu accepți. |
| Recipient's buttons | Accept · Delete · Block or report | Acceptă · Șterge · Blochează sau raportează |
| Sender, after sending | You can write more after {name} accepts. | Poți scrie din nou după ce {name} acceptă. |

Romanian copy avoids gendered forms ("membră/membru", "antrenor/antrenoare") by using "în comun" and past-tense verbs, which are the same for everyone.

## 5. Build status

### API: built 2026-11-20 (uncommitted, migration 090)

Checked with unit tests (full suite green) and live on the local database with throwaway accounts (removed after).

- **Migration 090:** `conversation_participant.accepted_at` (null = a request waiting for that person), `request_at` (set once, when the request starts), `declined_at`, `archived_at`; `user.message_policy` (`EVERYONE` / `REQUESTS` default / `CONNECTIONS`). Existing chats are backfilled as accepted, only in the step that adds the column, so a re-run never accepts new requests.
- **`MessagingSafetyService`:** `mayWriteDirectly` (one raw SQL query for §3.1), `deliveryFor` (direct / request with its limit / refused), `requestLimitsFor` (3, or 10 for `is_accepting_clients`), `requestsStartedSince` (the daily cap of 20), `requestContextsFor`. The 48 h new-account rule now uses the connection check and lets a new account answer anyone who wrote first.
- **Sending:** a request's first message creates the chat with the recipient not accepted; further messages count against the limit (403 `messaging.requestWaiting`); 429 `messaging.requestLimit` past 20 new requests a day; 403 `messaging.connectionsOnly`. Replying accepts. A connection that appears later (a booking, coaching) turns a waiting request into a chat. A deleted request keeps what the sender writes but announces nothing. Writing in an archived chat unarchives it. A blocked sender gets the same waiting state and the same chat id.
- **Notifications:** `MESSAGE_REQUEST_RECEIVED` once per request (in-app + push, never email, no preview); messages in an archived chat send no push or email.

### What the apps get (contract)

| Call | What changed |
|---|---|
| `GET /messaging/conversations?folder=inbox\|requests\|archived` | Omit `folder` for the old list (everything but deleted requests), which keeps app versions in the stores working. |
| Each conversation | `isRequest`, `requestContext { sharedGroupName, sharedGroupCount, isCoach }`, `archived`, `waiting { remaining }`; `lastReadByOther` is null until the other side accepts. |
| `GET /messaging/unread-count` | `{ count, inbox, requests }`. `count` is the old total; new apps use `inbox` for the tab badge and `requests` for the requests row. |
| `POST /messaging/conversations/:id/accept` | Returns the conversation. |
| `POST /messaging/conversations/:id/decline` | 400 `messaging.notARequest` on a chat. |
| `PATCH /messaging/conversations/:id/archive` `{ archived }` | 400 `messaging.acceptRequestFirst` on a request. |
| `GET /messaging/reach/:userId` | `{ status: DIRECT \| REQUEST \| CONNECTIONS_ONLY \| YOU_BLOCKED \| NEW_ACCOUNT \| SUSPENDED, requestLimit }`, for the composer note and the profile button. |
| `GET` / `PATCH /messaging/settings` | `{ whoCanMessage }`. |
| Stream | `message.created` gains `isRequest`; new `conversation.accepted` (both sides), `conversation.declined` and `conversation.archived` (own sessions). Older apps ignore unknown events. |
| Notification | type `MESSAGE_REQUEST_RECEIVED`, `data.screen: 'messages'` with `queryParams.conversationId`. |

### Mobile: built 2026-11-20

- **Core store** (shared with web): one list stays the source of truth. `chatConversations`, `requestConversations`, `archivedConversations`, `visibleChats`, `chatsUnreadTotal` are mobile's views over it; `loadFolder(folder)` fetches a folder and merges its rows as outside the pages. `acceptRequest`, `declineRequest`, `setArchived`, `reach`, `shareTo`; handlers for the three new events; `incoming` (the last message from someone else) for the banner.
- **Messages:** "Message requests" and "Archived" rows over the chats; one screen for both folders (`folder/`, route data `folder`); Archive on the row's swipe (Mute moved into More) and in More and chat details.
- **Chat:** a request shows "how you might know each other" over the thread and Accept / Delete / Block instead of the composer; the sender sees how many messages are left, then a closed composer; a draft asks `reach` and says what a first message will do.
- **Privacy:** "Who can message you" (choice sheet) and "Let people find me by name" (toggle).
- **Tab and app badge:** chats only.
- Checked in WebKit with an iPhone profile against the local API, light and dark, Romanian at 130% on an iPhone SE.

### Also built

- **"Let people find me by name"** (migration 091, `user.find_by_name`, on by default): `/users/search` matches names and handles only for people who leave it on; a whole email finds anyone. Read in `GET /profile/me` (`account.findByName`, with `account.whoCanMessage`), changed with `PATCH /users/me`.
- **Privacy policy:** a "Messages" paragraph in section 2 (EN and RO), last updated 2026-11-20.

### Still open

**Web:** it reads the old list, so a request shows as a chat (answering it accepts it) and archived chats stay in the list. A requests filter, Archive, and the two settings in Profile > Safety are about 1 to 2 days.

## 6. Benchmarks

| App | Rule |
|---|---|
| Strava | "Who can message you": Following, Mutuals, No one. The default follows profile visibility (a followers-only profile defaults to Mutuals). With No one you can still start chats yourself, and people can reply once a chat is open. |
| Instagram, Messenger | Strangers' messages arrive as message requests. No "Seen" until accepted. Reportedly one message before acceptance (not confirmed in official help). |
| LinkedIn | Messages from people you're not connected with need InMail; a connection request can carry one note. |

## 7. Decisions (owner, 2026-11-20)

1. **Message requests: yes.**
2. **Up to 3 messages before acceptance.**
3. **Coaches stay on requests by default.** Someone writing to a coach who is taking clients (`instructor_profile.is_accepting_clients`) can send up to 10 before the coach accepts. (Read as: the higher limit is for people writing *to* such a coach; coaches writing to others keep 3.)
4. **Former coach and client keep their chat**, and either side can delete or archive it (§3.2).
5. **Yes** to the "Let people find me by name" switch and to the privacy policy paragraph on messages. Both are separate steps from the request build:
   - The switch needs its default chosen. Off by default for members would also stop coaches finding their clients by name when inviting them; an exact email would still work.
   - The paragraph: messages are stored; scanned automatically for off-platform payment and contact details to show a warning (`MessagingContentService.detectThreats`); read by staff only when reported, and every such read logged (`admin_message_access_log`); deleted with the account.

Not asked, so the recommendation stands: the connected list in §3.1 (14 days after a class; members of the same group go through requests) and the name "Message requests" / "Solicitări de mesaje".

## Sources

- [Strava's "Who can message you" settings (TechRadar)](https://techradar.com/health-fitness/fitness-apps/how-to-change-your-privacy-settings-on-stravas-new-messaging-feature)
- [Everything you need to know about Strava messaging (Tom's Guide)](https://www.tomsguide.com/news/everything-you-need-to-know-about-strava-messaging)
- [Instagram message request read receipts (Kontentino)](https://www.kontentino.com/q-and-a/instagram-message-request-read-receipts/)
- [Instagram: managing message requests (Help Center)](https://help.instagram.com/iphone-app/585369912141614)
- [Analysis of data protection by default, Art. 25(2) GDPR (PANELFIT)](https://guidelines.panelfit.eu/the-gdpr/main-concepts/data-protection-by-design-and-by-default/analysis-of-data-protection-by-default-in-art-252-gdpr/)
- [EDPB Guidelines 4/2019 on Article 25](https://edpb.europa.eu/sites/default/files/consultation/edpb_guidelines_201904_dataprotection_by_design_and_by_default.pdf)
- Privacy policy: `beeactive-ui/projects/website/src/app/legal/privacy-policy/privacy-policy.component.html` (`@@privacy.s2.li6`, `@@privacy.s4.li10`)
