# Programs and plans: alignment audit, 2026-11-18

Read-only review of programs, routines, assignments and plans across the API, core, mobile and web, on `develop` (API 03f1cca, UI 69a4812a). The findings come from reading the code paths. Nothing was reproduced in a running app, and no tests were written for them yet.

## Verdict

The main path works: a coach assigns a plan, the client sees it, starts a day, logs it, finishes it, and the plan completes. Routes and enums match between the API and the UI, and every string exists in both languages. Nine defects change what people see, and several recent features (the superset bulk route, the richer exercise card, set editing) reached the logger and routine builder but not the program day editors.

## Broken

1. **Superset links in program days can be lost.** `normalizeSupersets` (core `utils/superset-links.ts`) renumbers every group, so one tap changes many rows. Mobile `programs/day-editor/day-editor.ts:288-305` and web `instructor/programs/program-detail/program-detail.ts:785-817` send one `PATCH …/exercises/:id` per row in parallel, and the API (`program.service.ts:1453-1518`) runs `_dissolveLoneSuperset` per row in separate transactions. Rows A1 B1 C D E2 F2, linking C with D: four PATCHes; processed C, E, F, D, F's dissolve finds only C in group 2 and clears it. Two transactions dissolving each other's rows can deadlock (500). Web also writes the intended links to local state, so the screen and the database disagree until a reload. Fix: one bulk route per program workout, in one transaction, as the log supersets route (03f1cca).
2. **The completion percent has two formulas.** `program-assignment.service.ts:1025-1052` (skip, auto-skip) counts COMPLETED + SKIPPED; `workout-log.service.ts:3718-3744` (finish, discard, delete) counts COMPLETED only. With 10 days, 2 done and 2 skipped shows 40%, and finishing a third shows 30%. Fix: one shared helper.
3. **Self-scheduled routines get the wrong week when scheduled mid-week.** `program-assignment.service.ts:572` uses `Math.floor(index / days.length)` while `_expandWeekdays` (`:630-650`) drops week 0's days before the start. Mon/Wed/Fri scheduled on a Wednesday puts next Monday in week 1. Fix: the week from the date's Monday minus the start week's Monday.
4. **"Every week" schedules end after 8 weeks.** `ROLLING_HORIZON_WEEKS = 8` (`:474`); the extension job its comment mentions does not exist (`JOBS-PENDING.md:77`, V2). The web dialog defaults to "Every week". After 8 weeks the sweeps close the plan. Fix: the extension job, or copy that says 8 weeks.
5. **The mobile plan page sticks on the first week with a skipped day.** `workouts/plan/plan.store.ts:86` counts only COMPLETED, and `:91-94` takes the first week with `done < days.length` as current. One skip (the nightly auto-skip too) pins "This week" for good. Fix: count SKIPPED as finished with.
6. **Mobile offers Start and Skip on days already done or skipped, and the API accepts the start.** `preview.html:60-73` always shows both; `workout-log.service.ts:529-593` does not check the day's or the plan's status and overwrites COMPLETED with IN_PROGRESS. Discarding then resets the day to not started; finishing again sends the coach a second notice; Skip on a done day shows a 400. Web gates it (`client-plan-detail.ts:295-306`). Fix: hide the buttons, and have the API refuse a finished day or an inactive plan.
7. **Scheduling a starter on web fails with 404.** `routine-row.html:66-78` shows Schedule on SYSTEM rows; `program-assignment.service.ts:520` requires the owner. Fix: hide it, or copy the starter first.
8. **Web set edit cannot clear a field, and kg to %1RM returns a 400.** `set-form-dialog.ts:208-229` omits empty fields; `program.service.ts:1604-1655` merges with the old row and `_assertSetCoherent` throws `workout.weightModeConflict`. Fix: send `null` for cleared fields.
9. **A coach-assigned routine reaches the client under its old name.** A routine's `program_workout.name` is set at create (`program.service.ts:955`) and never renamed by `update()` (`:1074-1149`), and `cloneTree` copies it. After a rename, or for a copied starter, the client's Today card, preview, logger and history show the old name.

## Inconsistencies

- Mobile Workouts tab asks for "today" in UTC (`workouts.store.ts:138`); Home and web send the local date. Between midnight and about 2 to 3 a.m. in Romania the tab shows yesterday.
- Mobile assignments page loads the coach's first 100 assignments and filters by program on the phone (`assignments.store.ts:16,72,84`); `ListAssignmentsQueryDto` has no `programId`.
- The program-assigned notification opens nothing on mobile (`notification-deep-link.ts:107` lists `user/plans` as web only).
- The mobile program day editor lags the routine builder: no picture, kind tile or plan note on the exercise card, and no set rows, targets, set types, notes, reorder or swap, so a coach can only prescribe empty sets.
- Routine saves replace the whole tree (`program.service.ts:1096-1114`, `_writeExerciseTree` `:973-1035`): they drop `targetRpe`, `targetRir`, `targetWeightPercent1rm`, `tempo`, set notes and `alternateExerciseId`, and null the provenance links of every past log (migration 058), including the log just finished when "Update routine" is picked at Finish (985a62c4).
- Web reorder can split a superset (`program-detail.ts:734-756` and the API `reorderExercises` do not normalize).
- Mobile routine delete never cancels schedules (`routine-actions.service.ts:53-58`), so a web-scheduled routine deleted on the phone stays on Today.
- English in notification params: `'Your coach'` (`program-assignment.controller.ts:56`, `program-assignment.service.ts:253`) and `'Your client'` (`program-assignment.service.ts:911`, `workout-log.service.ts:1985`). The rule is `null` and the message words it.
- Client loops of per-row writes (bulk-route rule): web exercise picker adds one at a time without `defaultSets`; web set form adds N sets as N POSTs; web "move exercise" is add + one POST per set + delete, not atomic, and drops the superset link; mobile day editor forks one add per picked exercise.
- Edits that omit instead of sending `null` (web program form, mobile program builder description), so an emptied field is never cleared.
- Smaller: restore sets DRAFT (a published routine loses PUBLISHED); `copyWeek`/`copyDay` skip the live-assignment guard; a few multi-step writes outside one transaction (`skipAssignedWorkoutAsClient`, `softDelete(cancelScheduled)`, routine tree + `program.update`); the assignment notification's start date may differ from the first session; `scheduleRoutine` uses the server's UTC today; pausing, cancelling or deleting an assignment tells the client nothing.
- Core type drift with no runtime effect today: `AssignedExercise.masterPrescribedExerciseId` should be `masterExerciseId`; several fields typed non-null are nullable; `StartWorkoutPayload` lacks `programId`; `repeatMode`, `repeatWeeks`, `level`, `folder` missing from the UI types.

## Suspicions, not traced to the end

- Saving a routine while a workout from it runs cuts the running log's prescribed links (targets, plan notes, planned rest, the "Update routine?" match).
- Deleting a finished log reopens a completed plan; the sweeps close it again that night, possibly with a second "finished the plan" notice.
- A coach's private exercise inside an assigned plan may 404 when the client opens it.

## Tests

- API covered: copy, repeat and delete week, reorders, add exercise and set, per-row superset link and unlink, assign, `scheduleRoutine`, the sweeps, `getTrainingDay`, start guards, log supersets.
- API not covered: `skipAssignedWorkoutAsClient`, `updateSet`, `reorderSets`, `removeWorkout`, `softDelete(cancelScheduled)`, `listForClient`, assignment `softDelete`, multi-row superset changes, starting a completed day, mid-week `weekIndex`, the two percent formulas agreeing.
- UI not covered: core `program.service` and `program-assignment.service`; mobile day editor, program builder and store, assignments and store, assign sheet, copy-day and copy-week sheets, plan and store, starters, archived routines; every web instructor programs page and dialog, my-plans, routine library.

## Suggested order

1. Items 6 and 2 (wrong data written: restarted finished days, percent going down).
2. Item 1 (lost superset links, possible 500s), with a bulk route.
3. Items 5, 3, 9 (what the client sees on the plan).
4. Items 4, 7, 8 and the routine tree replace (silent losses).
5. The rest as they come up.
