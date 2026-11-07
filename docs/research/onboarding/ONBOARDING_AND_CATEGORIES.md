# Onboarding and categories: research + recommendation

2026-11-07. Scope: how a new person (trainee or coach) gets from "install" to "connected to the right coaches, groups and sessions", what Discover does today, and what to build. Companion doc: [`../auth/SIGN_IN_WITH_APPLE.md`](../auth/SIGN_IN_WITH_APPLE.md) (social sign-in, account clashes).

## TL;DR

- **Ask nothing extra at registration.** Make sign-up one tap (Apple, Google, later Facebook on top; email below). Every question moves to a short, skippable flow **right after** the account exists, so a person who drops out mid-way is still a user we can bring back.
- **Ask the role first, after sign-up, for every provider.** Today Google sign-up never asks, and mobile has no "become a coach" action at all, so a coach who signs up on the phone with Google is stuck as a trainee.
- **The real blocker is the data, not the screens.** There is no shared category list anywhere. Coach specialties, group tags and program goal tags are free text; sessions carry no activity. Discover's six "goals" are keyword guesses in the mobile app. An interest picker today would have nothing reliable to match against.
- **Build one category list first** (about 14 activities + a few goals, EN + RO, ours), use it for coaches, groups, sessions and people. Then onboarding writes interests, and Discover and the coach suggestions use them on the server.
- That same list + level + city + a separate opt-in is the targeting model for future brand deals, without ever handing personal data to a brand.

## 1. What exists today

### Sign-up (mobile `beeactive-ui/projects/mobile/src/app/pages/auth/sign-up/`, web `projects/web/src/app/pages/auth/sign-up/`)

- Six inputs (first name, last name, email, password, confirm password) + a "Register as coach" checkbox, then "or", then **Continue with Google at the bottom**. The fastest path is the least visible one.
- **Google sign-up has no role choice** (`onGoogleCredential` calls `googleLogin({ idToken })`, the checkbox is ignored). Everyone who uses Google becomes a trainee.
- No Apple button, no Facebook button on mobile yet. `@capgo/capacitor-social-login` (in `package.json`) supports Google, Apple and Facebook, so the plugin is already the right one.
- After success: `navigateRoot` to the app home (or the return URL / invite). **No onboarding step of any kind.**
- The invite path (`?token=`) is good: email locked to the invite, invite accepted after sign-up, coach checkbox hidden. Any new flow must not get in front of it.

### After sign-up

- **Trainee Home** (`main/home/train-home/`) is calm and well built, but for a brand-new person every block is empty: no week, no hive, no latest. Nothing points them to a coach, group or session that fits them.
- **Coach Home** (`main/home/coach-home/`) already turns into "first steps" when the coach has no clients (create a program, add specialties). Good pattern; reuse it.
- **Becoming a coach later**: web has `main/user/_dialogs/become-instructor/` + `become-instructor-card` (calls `POST /profile/instructor`, which creates the profile and adds the INSTRUCTOR role). **Mobile has nothing.** `more/switch-role` only switches the Coach/Train mode for someone who already holds the role.

### What we store about a person

`user`: name, email, phone, language, timezone, `country_code`, `city`, handle, privacy and workout settings. **No interests, no goal, no level, no marketing/partner consent.** The old `user_profile` (goals, fitness level, DOB, weight) was dropped in migration 027 because nothing used it.

### "Categories" across the data

| Thing | Field | Shape |
|---|---|---|
| Coach | `instructor_profile.specializations` | free-text JSON array; mobile edits it as one comma-separated string (`account/_sheets/coaching-sheet`) |
| Group | `group.tags` | free-text array |
| Session | `session_template` | `type` (GROUP/PRIVATE/OPEN) + `location_kind` only. **No activity.** |
| Program | `program.goal_tags` + `level` | free-text JSONB; `level` enum on curated content only |
| Exercise | `fit_category` / `fit_subcategory` | movement catalog, not relevant to matching people |

The coach directory's filter facets (`/profile/instructors/directory/facets`) are built from whatever coaches typed. Even the small local demo DB shows the effect: "Forță", "forță", "strength" and "Strength & Conditioning" are four separate values for one idea, and group tags include "yolo" and "demo". Every coach who joins makes the facet list longer and less useful, and an English reader never finds a coach who wrote "Alergare".

## 2. Discover: how good is it, and how relevant

Shape of the tab (`beeactive-ui/projects/mobile/src/app/main/discover/`): a band with city, search entry and goal chips; coach of the week; three coaches near you; four public groups; upcoming sessions by day with type/location/date filters.

**What is good and worth keeping**
- Honest by design: no fake ranking, no counts, a coach of the week that rotates fairly (`coachOfTheWeek`).
- City aware, with a remembered choice and good empty states ("nothing in Cluj, show everywhere").
- Bilingual matching (folded, accent-blind, EN + RO word starts).
- The layout is exactly where personalization should land. Nothing needs redesigning.

**What is weak**
1. **The six goals mix four different questions**: activity (Running, Mobility), outcome (Strength, Fat loss), level (Beginners) and format (Online). A person can't answer "what are you into" with that list, and coaches can't be tagged by it.
2. **Big gaps in coverage.** Yoga and Pilates hide under Mobility; there is nothing for dance, boxing and martial arts, cycling, swimming, functional/cross training, team sports, pre/postnatal, seniors, nutrition. A boxing coach matches no chip at all.
3. **Sessions match by title only.** "Group Session 3" from a running coach never shows under Running.
4. **Filtering runs in the app over the first 50 groups and 50 sessions** (`discover.store.ts` `GROUP_PAGE_LIMIT`, `UPCOMING_LIMIT`). Fine at today's volume, silently wrong once a city has more than one page.
5. **The goal list is a hidden taxonomy that lives only in the mobile app** (`DISCOVER_GOALS.words` in `discover.config.ts`). Web, search, suggestions and admin don't share it.
6. **Nothing about the person feeds it.** The chip starts unselected for everyone, every time.

**Verdict:** the tab is well built and the right surface; the goal layer underneath it is the part that doesn't hold up, and it's the exact part onboarding should feed. Replace keyword guesses with real categories and Discover becomes personal without a redesign.

## 3. Register vs after register

Fitness apps that keep people (Strava, Nike Training Club, Fitbod, ClassPass) follow the same order: **account in one tap, then a few quick taps of personalization, then a first screen that already has something for you**. Each question asked before the account exists costs sign-ups; the same question asked one screen later costs almost nothing, because a person who skips it is still a user and can be asked again on Home.

So for MotionHive:

**Registration screen (no new questions, fewer fields)**
- Continue with Apple, Continue with Google (Facebook when Meta approves, behind a flag) **at the top**, equal size, then "or continue with email".
- Email path: first name, last name, email, password. Drop "confirm password" (the field already has show/hide); that needs `confirmPassword` optional in `RegisterDto` (or a v2 DTO), not a client-side copy.
- Remove the coach checkbox from the form. The role question moves to the first screen after sign-up, the same for every provider.

**Welcome flow (right after the account exists, every screen skippable, about 30 seconds)**

| Step | Trainee | Coach |
|---|---|---|
| 1. Role | "How will you use MotionHive?" I train / I coach. One tap. | "I coach" calls `POST /profile/instructor` (fixes the Google and mobile gaps). Its line says they can train for themselves too: a coach already has both modes, so there is no third "both" answer. |
| 2. Interests | "What are you into?" multi-select activity chips | "What do you coach?" same chips, written to the coach's categories |
| 3. Level / context | "Where are you starting?" beginner / some experience / experienced (one tap) | City + "Taking new clients?" (needed for discovery) |
| Land on | Discover with their interests pre-selected, or Home with "for you" coaches and groups | Coach Home first steps (exists), minus the specialties step already done |

Rules for the flow:
- **Never in front of an invite.** Invited client: skip the role, land on the accept flow; offer interests later on Home.
- Keep `resolveReturnUrl` working: a person who signed up from a shared link lands where the link pointed, after the flow.
- **Resumable and server-side**: store `onboarding_completed_at` on `user` so it shows once per person across devices, not per phone. Skip = done; Home then shows one "Pick what you're into" card until they do.
- Existing accounts get the same card on Home once, not a forced flow.
- **Don't ask here**: city for trainees (Discover's band already asks it in context), notifications (ask after the first booking or finished workout, with a short explainer first), body data or medical info (GDPR special category, adds weight and drop-off for no matching value).
- Social sign-in already gives name and email (Apple only on the first authorization), so social users never see a name field. See the Apple doc for the details.

## 4. The category model to build first

One list, owned by us, shipped like the exercise translations (`translations` JSONB, authored in `docs/content/translations/`).

**Activities** (what you do, used by people, coaches, groups and sessions), proposed starter set, owner to approve:
strength training, running, yoga, pilates, HIIT and functional, cycling, swimming, boxing and martial arts, dance, mobility and stretching, outdoor (hiking, trail), team sports, pre and postnatal, nutrition (coaches only).

**Goals** (why, trainee side, optional): get stronger, lose fat, build endurance, move better, train for an event, feel better.

**Level**: reuse the `exercise_level` enum (BEGINNER / INTERMEDIATE / ADVANCED). "Beginners" stops being a goal and becomes a level a coach or group says it welcomes.

**Format** (online, in person, group, 1:1): already real data (`location_kind`, `type`, venue `is_online`). Don't ask it; filter by it.

Schema sketch (one migration, small):
- `category` (id, slug, kind ACTIVITY|GOAL, icon, sort, `translations`).
- `user_interest` (user_id, category_id) and `user.fitness_level`, `user.onboarding_completed_at`.
- `instructor_profile_category`, `group_category` joins; `session_template.category_id` (one primary activity, nullable).
- Keep the free-text `specializations` and `tags` as the coach's own words shown on their profile ("Kettlebell sport"), but matching uses categories only.
- Backfill: one script that maps existing free text with the word lists that already live in `DISCOVER_GOALS` (move them to the API for this), and leaves unmatched values as free text for the coach to fix from a "pick your categories" first step.
- Feed category names (both languages) into `search_doc.tags` so search finds them.

API: discover endpoints for sessions, groups and the coach directory take `category=` and filter in SQL; `suggestInstructors` ranks interest overlap after same-country. The mobile app drops its client-side keyword matching.

Coach side: the comma-separated text field becomes a chip picker over the list (plus "other" free text). That alone cleans the directory facets.

## 5. Brand deals later: what this unlocks, safely

The targeting model is: **activity interests + level + city + language**, plus what people actually do (sessions booked, workouts logged). That's enough for "show runners in Cluj a running brand's offer" or "a sponsored coach slot for yoga beginners".

How to do it without trouble:
- **Brands buy placement, never data.** The ad sits inside the app and we do the matching. Brands get aggregate audience numbers ("about 3,000 runners in Cluj"), never names or emails. `CoachSuggestionReason` in `profile.service.ts` already reserves a reason for sponsored placements, so the suggestion list is ready for it.
- **Separate, unticked opt-in** for partner offers ("Show me offers from MotionHive partners that match what I'm into"), with the timestamp and the wording version stored (`user.partner_offers_consent_at` + version). Using interests to personalize the app itself doesn't need that opt-in; using them for sponsored content does, and the opt-in keeps that defensible under GDPR. It can sit on the last onboarding screen and in settings.
- Label sponsored items as sponsored, every time.
- **Don't collect age or gender now.** Brands will ask for them, but they add friction and GDPR weight on day one; add an optional profile field the day a real deal needs it. Open question below on the minimum age.
- In-app targeting with our own data isn't the cross-app tracking that Apple's App Tracking Transparency covers; the Apple doc confirms the exact rules.

## 6. Plan, in small steps

| Step | What | Where | Size |
|---|---|---|---|
| 0 | Social buttons on top of sign-up, coach checkbox removed, role screen after any sign-up, "Become a coach" on mobile account | UI (mobile + web), no API change | S |
| 1 | Category list + translations + migration + backfill script; coach chip picker; group picker | API + UI | M |
| 2 | Welcome flow (interests, level), `onboarding_completed_at`, Home card for skippers | API + UI | M |
| 3 | Server-side `category=` on discover + directory; Discover chips from the list, pre-selected from interests; suggestions ranked by overlap | API + mobile | M |
| 4 | Session template category (coach picks it when creating) | API + UI | S |
| 5 | Partner offers opt-in + consent storage | API + UI | S, when the first deal is real |

Step 0 is worth doing even before the rest: it fixes the Google-coach dead end and puts the one-tap path first. Apple sign-in (companion doc) slots into step 0.

**Measure** from the database, no tracker needed: share of new accounts per provider, `onboarding_completed_at` filled vs skipped, share of new people who book, join a group, request a coach or log a workout within 7 days, and still active after 30. Compare before and after step 2.

## 7. Decisions

Answered 2026-11-07:
1. **Category list in section 4: approved** as proposed (activities, goals, level).
2. **Role: two answers, not three** (recommended, owner was unsure). A coach is also a trainee by default (`AppModeStore`: an instructor has both Coach and Train modes), so "I coach" already means "both". The coach option says so in its line. A coach's own training interests are asked the first time they open Train mode (the Home card), not in the welcome flow.
3. **Age gate: none exists today. Parked**, to decide before partner offers ship (step 5). Romania's age of digital consent is 16.
5. **The register page stays as it is** (owner, 2026-11-07): no social-buttons reshuffle, the coach checkbox and confirm password stay. Section 3's "Registration screen" changes and step 0's sign-up part are dropped. The welcome flow starts on the first entry into the app. Each step is tracked in the database (done or skipped), so a step is never shown again once answered and only resurfaces where it makes sense; every answer is stored in the database. A person who ticked "Register as coach", or came in through a coach's invite, skips the role step. Exception to keep in mind: Sign in with Apple, when built, has to add its button to this page (App Review requirement).
4. **Design first.** The whole flow goes through Claude Design before any code: brief in `~/Documents/mystuff/motionhive-local/beeactive-api/docs/research/onboarding/CLAUDE_DESIGN_BRIEF.md` (local only, like the earlier Claude Design briefs). Nothing in section 6 starts until those screens exist.
