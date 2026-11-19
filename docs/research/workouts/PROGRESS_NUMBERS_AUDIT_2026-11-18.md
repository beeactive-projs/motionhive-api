# Progress numbers: how true are they? 2026-11-18

Read-only review of every training number a person sees (volume, 1RM, records, deltas, duration, counts, weeks, trends), in the API and the apps, on `develop`. Findings come from reading the code paths; none was reproduced in a running app.

## Verdict

The core sums are right. Volume is weight times reps over ticked sets with warm-ups out, from one definition (`api/src/modules/workout/volume.ts`); unticked sets never count; pauses come out of duration; records leave with a deleted workout. The trouble is at the edges: a few screens show a plainly wrong number, "record" and "best set" mean different things on different screens, bodyweight exercises with added weight get a meaningless 1RM, and day and week buckets are UTC on the API but local in the app. Most fixes are one line or one query.

## Wrong number shown

1. **The share image's volume includes warm-ups**, so it is higher than the finish screen (mobile `share-card.config.ts:550`, reps at :559; the finish tile `workouts.config.ts:1377` and the API leave them out). Warm-ups 2 × 40 × 10 then 3 × 80 × 8: finish says 1,920 kg, the image 2,720 kg. Fix: reuse `loadedVolume`.
2. **"Duration 0:00" when the duration is unknown** (over 6 h active): `finish.ts:337` → `durationClock(null)` = "0:00" (`workouts.config.ts:1515`, and its spec locks it in). The coach review shows "—", the share card "unknown". Fix: hide the tile or say unknown.
3. **"Same as last Push day (0 kg)"** on a bodyweight routine, or "+2,000 kg vs last … (0 kg)": `_previousSameWorkout` (`workout-log.service.ts:2951-2958`) returns a previous total of 0, and `volume.config.ts:84-107` prints it. Fix: no comparison against 0 kg.
4. **A single counts as 103.3% of what was lifted**: Epley at 1 rep (`one-rep-max.estimate.ts:19`); a tested 100 × 1 shows "Est. 1RM 103.3 kg" (the spec titled "100kg × 1 = 100" asserts 103.33). The Progress trend treats a single as its weight, so the two disagree. Fix: reps = 1 → the weight; the stored singles are 3.3% high and can be recomputed.
5. **Bodyweight exercises with added weight get a 1RM and records, and their kg joins the workout total**: no kind check in `_writePrsFromLog` (`workout-log.service.ts:2025-2034`); pull-up +20 × 8 becomes a "25.3 kg estimated 1RM" record on Home. The workout, weekly and Progress totals add that kg (`workout-log.service.ts:2772`, `progress.service.ts:1071-1073, 1130-1136`, `workouts.config.ts:1334-1347`), so the hero says 2,400 kg while the rows say "Bench 1,800 kg" and "Dips 30 reps". Fix: no 1RM or records for BODYWEIGHT; only kg exercises in `totalKg`.
6. **A typo in a finished workout is permanent, and a big one can block finishing**: sets can't be edited after finishing (`workout-log.service.ts:975-979`); 1000 instead of 100 × 5 becomes a 1,166.67 kg record nothing can beat. Suspected: `one_rep_max.weight_kg` is DECIMAL(6,2) (migration 047), so an estimate of 10,000 or more fails the finish transaction, and the nightly sweep fails on it every night. Fix: correct sets after finishing with records recomputed, confirm values far above the best, guard the estimate.

## Misleading

7. **"Record" has two meanings.** The first time on a lift is a record on Home's Latest feed, the Progress list badge, the exercise page's first session and the web; it is not on the finish screen, History chips and filter, Home's "Record on Wednesday" and the coach feeds. A beginner's first workout with 5 lifts: no record on finish, "No records yet" in History, 5 "New record" items on Home. Fix: one rule in the API.
8. **Warm-ups count toward records**, though the set menu says they don't (`workouts.setMenu.hints.WARMUP`): no set-type filter in `_writePrsFromLog`, `_recordSet` (:2151) or the coach's rebuilt series (`progress.service.ts:1442-1449`). Fix: `set_type <> 'WARMUP'` there.
9. **The coach's "This week" card is the last 7 days in UTC** (`client-detail.store.ts:232-241`, `progress.service.ts:671-696`, UTC today in `coach-roster.controller.ts:36`): on a Tuesday, a Mon/Wed/Fri plan reads "3 of 3 · 100% · 0 remaining" from last week. Fix: a calendar week in the coach's timezone, or label it "Last 7 days".
10. **"Best set" means four things**: the logger's biggest weight × reps, History's heaviest set, the exercise page's Epley on the heaviest set with no rep cap, the records' Epley capped at 12 reps. Fix: one best set from the API, used everywhere.
11. **The Progress trend mixes units** (`progress-exercises.config.ts:46-54`): a session logged without weight scores in reps and reads as "Going down".
12. **Web Progress page** (`web/.../progress/progress.ts`): the weekly average divides by active weeks only (:179), empty weeks vanish from the bars (:187), the subtitle pairs lifetime workouts with the window's hours, the 28-day grid is UTC.
13. **Percent changes from tiny bases**: "+1,820%" after a 1-set last time (`progress.ts:155`, `volume.ts:128`, `volume.config.ts:298-301`). Fix: absolute change under a minimum base.
14. **An exercise partly done then skipped gives two volumes on one screen**: the UI tiles count its ticked sets, the API volume card and Progress don't, records do.
15. **The coach sees records that disagree**: the Progress tab rebuilds from workouts the coach may see, while history chips, the review's record set, roster totals and Hive counts read `one_rep_max` over all training, private included, which also hints at private training.
16. **A pause mid-workout counts as training when Finish is tapped late** (`workout-log.service.ts:1714-1723` assumes every pause happened after the last set).
17. **Day and week boundaries don't line up**: the API buckets in UTC (`database.config.ts:41`, DATE_TRUNC in `progress.service.ts:1122, 1167, 1195`, `workout-log.service.ts:2753`, the streak); the app groups by local day, inconsistently (History by `startedAt`, Home's week by `completedAt` but fetched by `startedAt`). A Monday 00:40 workout is last week in Progress and the streak, Monday in History and Home. Fix: the person's timezone with `AT TIME ZONE`.
18. **"Last 12 weeks" tiles don't add up to the bars**: tiles are a rolling 84 days, bars are 11 weeks plus this one.
19. **The exercise page caps at 100 sessions but offers "1 year"** (`progress.service.ts:496`).
20. **Records exist only for weight × reps up to 12 reps**: push-ups 20 → 30, a longer plank, a faster run are never records, while History says "a workout lands here when you beat your best". Fix: reword, or add rep, time and distance bests.

## Edge cases

The Time tile rounds a 25 s plank to "0 min"; set counts include warm-ups while volume doesn't (consistent, never stated); one-sided reps and dumbbell weight have no stated convention; roster adherence counts today as due from the morning; a manual 1RM shows as "estimated"; "First time" on an exercise done before in another unit; the "last time" hint can come from a workout with no ticked sets; the web sparkline spaces points evenly; only kilograms exist.

## What you can trust

One volume definition in TS and SQL; duration rules (pauses out, last set after 30 idle minutes, unknown past 6 h, correctable); ticks save the pre-filled values; ties are not records; deleting a workout deletes its records; the coach's Progress tab uses only visible workouts; adherence shows nothing rather than 0% when nothing was due; Romanian number formatting; the mobile weekly chart fills empty weeks.

## Tests missing

API: `_writePrsFromLog` has one test (ties, beating the best, warm-ups, skipped exercises, bodyweight, the DECIMAL overflow untested); the single-rep Epley test asserts the inflated value; no test for a 0 kg previous total or first-ever rows in `_recentRecords`; every progress SQL is mocked, so UTC bucketing, the warm-up filter, LAG ordering and the 100 cap never run against Postgres. UI: share-card volume with warm-ups; `durationClock(null)` locked to "0:00"; first-time records locked in; mixed-unit trends; the web weekly average; tiles against bars.

## Suggested order

1. Items 1 to 5 and 8 (wrong numbers, small fixes).
2. Item 7 (one meaning of "record") and item 17 (timezone), which most screens depend on.
3. Item 6 (editing a finished workout), a feature in itself.
4. The rest.
