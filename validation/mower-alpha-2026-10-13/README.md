# Mower alpha compatibility evidence

The implementation targets `ab0a4e5bec23f6f8d7c37b0648f05dda28f31866`, read from the Mower repository's alpha Git objects. The source manifest fixes the exact files and SHA-256 values. No device integration tests are run.

## Independent native decisions

The Python generators extract unmodified function AST nodes from the pinned Git objects. Surrounding physical occupancy and dependencies are explicit offline fixtures; the extracted decision branches are neither rewritten nor imported from the TypeScript implementation.

```sh
python3 validation/mower-alpha-2026-10-13/generate-shared-group-oracle.py /path/to/arknights-mower
python3 validation/mower-alpha-2026-10-13/generate-dorm-isolation-oracle.py /path/to/arknights-mower
python3 validation/mower-alpha-2026-10-13/generate-decision-oracle.py /path/to/arknights-mower
python3 validation/mower-alpha-2026-10-13/generate-selection-oracle.py /path/to/arknights-mower
```

These cover overlapping shared bindings and Free beds, isolation costs and same-tier rearrangement, high/low bed ordering, and replacement availability when a cover already occupies the target. Corresponding Vitest files are `mowerSharedGroups`, `mowerDormIsolation` and `mowerAlphaDecisions` under `src/scheduler`.

This is decision-level native evidence, not a new complete native scheduler oracle or real-device accuracy claim.

## Historical evidence

The October 3 full-preview JSON fixtures remain unchanged. Their historical regression suite explicitly pins two changed decisions: the saved bed-array order and rejection of working replacement candidates. New alpha allows a candidate already in the target slot and computes high/low bed order dynamically; the separate October 13 native oracle verifies these differences. Historical preview tests therefore do not claim current full-preview equality.

September backup and recovery fixtures explicitly choose `mower-default` rather than silently inheriting the workbench's new alpha default. The recovery fixture also retains its original retired phase-timing fields; normal imports migrate those fields away. Original assertions on queue, occupants, diagnostics and event budgets remain in place.

## User-provided roster

The supplied 3012 × 1236 image is tested locally: all 14 QR payloads are decoded, imported and re-exported; main/backup structures and advanced settings are compared. Its image, decoded roster and detailed simulation traces remain ignored local artifacts. Public regression fixtures contain synthetic operators or already-public historical inputs.

The user authorized an arbitrary gold manufacturing drone target; the test fixes `room_1_2`. Product changes, effective backup transitions, recovery occupancy and finite simulation completion are checked separately. The update report records completed runs and limitations.

The follow-up requested by the user changes only Fiammetta’s initial morale to 12 (everyone else remains at 24), preserving all four targets and the original policies. This completes 24 hours with 1,428 integration intervals and 11 charges. The separate 72-hour warmup plus 168-hour sample run develops dense charging again around hour 63 and exhausts the default 200,000-interval budget at 90.6318464 hours (only 18.6318464 sample hours completed). Initial morale changes the transient timeline; the short run does not establish long-term completion. The exact final results are recorded in `verification.json`.

## Second roster follow-up (October 14)

A second private 14-QR roster exposed omitted-main-plan training slots, `group_min_mood` and `facility_has_mastery_plan` predicates, and stale dorm timers after ordinary arrangements. Synthetic regressions cover the fixes; the calculation dialog supplies an explicit fixed training-plan state. No training progression or real-device plan is inferred.

With Fiammetta initially at 12, others at 24, no unfinished training plan and gold drones in `room_2_2`, this roster completes 72 hours of warmup plus 168 sample hours. All 50 shift deferrals resolve. Both training-state branches also complete 24 hours. The first four-target roster still passes its 24-hour check; its earlier long-run failures belong to the initial delivery, and that long window has not been rerun after the dorm-timer follow-up. See the update report and `verification.json` for aggregate results and model limits.

## Shared dorm and drone capacity follow-up (October 14)

A third private roster exposed repeated fixed-dorm correction when one shared binding permits Free and another requires a named cover. The port now resolves current and pending binding states at the selection boundary instead of using the bed pool's potential autoFree flag. Six synthetic regressions cover the transition and selection behavior.

Default drone capacity is 250 as confirmed by the user. The existing Greyy skill formula now yields 25% by default; stock generation, overflow, reserve validation and whole-drone debits use the same capacity. Explicit configured efficiency-resource overrides and existing policy trigger thresholds remain intact.

The final all-24-morale run completes 72 warmup plus 168 sample hours in about 40.31 seconds (20,005 integration intervals), without the repeated fixed-dorm correction. Two of 18 recorded shift deferrals remain unresolved at the end, so finite completion is not a claim that all roster blocking is resolved. 21 focused files, 299 tests, typecheck, production build and structure validation pass. Private inputs and traces remain local.

## Named recovery admission and group recovery gap (October 14)

A fourth private roster exposed an alpha selection path still using the default model's ordinary full-morale cancellation. A cached reading of 24 could cancel an explicit dorm target even after morale had depleted to about 23.21, and clearing the depletion rate made the prediction jump back to 24. Pinned alpha cancels only excluded or personally capped dynamic recovery targets. The new selection oracle executes the pinned cancellation, resting-tier and mood AST methods with synthetic inputs; the default selection fixtures retain their historical behavior.

Restoring admission exposed a second stale rule: the group recovery-gap check compared the first bed against later beds. If the first operator recovered sooner, the gap was missed and this roster repeatedly returned the group prematurely. Alpha now compares the latest and earliest recovery times, independent of bed order, while retaining the configured threshold and extra-wait limit. This is a focused fix; alpha's newer persistent normal-return window and full anchor filtering have not been ported in this follow-up, and complete native scheduler equivalence is not claimed.

The private image, decoded roster, before/after traces and temporary runner remain local ignored artifacts. The report and verification JSON record complete-run results separately from the intermediate admission-only run that was stopped after reproducing repeated group shifts.

## Zero-morale Abyssal Hunter grants (October 14)

The user clarified that physically present manufacturing hunters still receive Gladiia's grant at zero morale, losing only their own 1% staffing contribution. The engine now enumerates physical beneficiaries for this grant, while the provider must remain active. Personal contribution details retain the grant without restoring exhausted operators' staffing or own skills. Regression tests retain active automation precedence, the 90% room cap, phase values and Waai Fu copy exclusion.

With four hunters across two rooms, two exhausted recipients retain an 80% grant and yield 180% room efficiency, rather than the previous incorrect 100%. Static zero-morale lists, explicit active sets and a real simulation crossing zero morale are covered. Eight focused files contain 157 passing tests; typecheck and production build pass. Strategy variants are separate local experiments and are not silently applied to the original user roster.

The stable private strategy variant changes only the main workaholic list to include the four manufacturing hunters, retaining all nine backups. It completes 72 warmup plus 168 sample hours; the hunters remain at zero morale throughout the sample, each physically working about 136.93 hours. Gladiia has 57.5 seconds of total idle transition time and no long idle episode; all 68 recorded shift deferrals resolve. They still leave with Gladiia's group and do not claim recovery beds. The conditional OR/workaholic alternative was stopped after a repeated-shift loop and is not delivered. Neither variant overwrites the original user input.
