# Mower alpha compatibility evidence

The implementation targets `ab0a4e5bec23f6f8d7c37b0648f05dda28f31866`, read from the Mower repository's alpha Git objects. The source manifest fixes the exact files and SHA-256 values. No device integration tests are run.

## Independent native decisions

The Python generators extract unmodified function AST nodes from the pinned Git objects. Surrounding physical occupancy and dependencies are explicit offline fixtures; the extracted decision branches are neither rewritten nor imported from the TypeScript implementation.

```sh
python3 validation/mower-alpha-2026-10-13/generate-shared-group-oracle.py /path/to/arknights-mower
python3 validation/mower-alpha-2026-10-13/generate-dorm-isolation-oracle.py /path/to/arknights-mower
python3 validation/mower-alpha-2026-10-13/generate-decision-oracle.py /path/to/arknights-mower
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
