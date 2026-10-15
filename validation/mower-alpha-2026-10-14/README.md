# Alpha dorm isolation oracle

`generate-isolation-oracle.py` reads Git objects at `3de2b2ac6f1aeff6513b63faaeea4b2369cf8856` and executes unchanged Python AST for `plan_dorm_isolation`, `_find_dorm_slot`, `assign_dorm`, ordered beds, roommate costs, resting tiers, and mood comparison. Each extracted function and source file has a hash in the generated fixture.

```sh
python3 validation/mower-alpha-2026-10-14/generate-isolation-oracle.py /path/to/mower
pnpm exec vitest run src/scheduler/mowerAlphaIsolationOracle.spec.ts src/scheduler/mowerDormIsolation.spec.ts
```

The fixture is `src/scheduler/fixtures/mower-alpha-isolation-20261014.json`. Its `cases` retain the prior seven-case interface with new upstream outputs; `isolationCases` cover swaps, recovery ranks, established first beds, reserved slots/names/products/future admissions, excluded residents, and explicit low-priority order. `assignmentCases` cover isolation before the recovery deficit within one takeover tier, continued tier precedence, and explicit low-priority ordering.

The Python process never imports Calculator code. Synthetic adapters provide physical occupancy, projection, explicit `Free` beds, and unconstrained capacity. The tests do not establish equivalence for automatic group beds, emergency residents, recognition, live device operations, or the entire scheduler. Original historical fixtures remain unchanged.

`generate-return-oracle.py` separately executes unchanged `plan_metadata`, `generate_plan_by_drom`, and native group matching at the same revision. Its fixture covers fixed dormitory/workaholic/standby members excluded from a group's timing anchors, shared workers excluded from the working exhaustion minimum, and a shared primary returning with the final dependent group. Empty projections, closing-dorm migration, releases, reservations, and busy operators are explicit synthetic adapters; this fixture does not validate those mechanisms or persistent return windows.

```sh
python3 validation/mower-alpha-2026-10-14/generate-return-oracle.py /path/to/mower
pnpm exec vitest run src/scheduler/mowerAlphaReturnOracle.spec.ts
```
