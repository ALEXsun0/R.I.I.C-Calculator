"""Replay pinned alpha dorm admission cancellation with synthetic observations.

Usage: python3 validation/mower-alpha-2026-10-13/generate-selection-oracle.py /path/to/mower
Reads Git objects and executes unmodified upstream AST. Capacity, Free-card
selection, complete scheduling and device recognition are outside this fixture.
"""
import ast
from datetime import datetime, timedelta
from enum import IntEnum
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from types import MethodType, SimpleNamespace as NS

REVISION = "ab0a4e5bec23f6f8d7c37b0648f05dda28f31866"
paths = ["arknights_mower/solvers/base_schedule.py", "arknights_mower/utils/operators.py", "arknights_mower/utils/resting_priority.py", "arknights_mower/utils/scheduler_task.py"]
sources = {path: subprocess.check_output(["git", "show", f"{REVISION}:{path}"], cwd=sys.argv[1]).decode() for path in paths}
source_methods = {}
clock = datetime(2026, 1, 1)

class FixedDateTime:
    @staticmethod
    def now():
        return clock

namespace = {"datetime": FixedDateTime, "timedelta": timedelta, "IntEnum": IntEnum, "logger": NS(info=lambda *_: None, debug=lambda *_: None)}

def load(path, name):
    matches = [n for n in ast.walk(ast.parse(sources[path])) if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name == name]
    assert len(matches) == 1, (path, name)
    node = matches[0]
    source_methods[name] = {"path": path, "line": node.lineno}
    exec(compile(ast.Module(body=[node], type_ignores=[]), path, "exec"), namespace)
    return namespace[name]

for name in ["RestingTier", "_replacement_tier", "resting_tier", "has_resting_mood", "resting_mood"]:
    load(paths[2], name)
current_mood = load(paths[1], "current_mood")
is_high = load(paths[1], "is_high")
rest_mood_complete = load(paths[1], "rest_mood_complete")
cancel = load(paths[0], "_cancel_dorm_recovery_targets")

cases = []
for name, mood, rate, elapsed, limit, priority, excluded in [
    ("cached full priority target has depleted since observation", 24, 3.05, .25, None, True, ""),
    ("currently full priority target remains explicitly admitted", 24, 0, 0, None, True, ""),
    ("completed personal recovery limit cancels admission", 20, 1, 0, 20, True, ""),
    ("blacklisted target cancels admission without clearing consumption", 10, 1, 0, None, True, "blacklist"),
    ("workaholic target cancels admission without clearing consumption", 10, 1, 0, None, True, "workaholic"),
]:
    clock = datetime(2026, 1, 1) + timedelta(hours=elapsed)
    op = NS(name="N", mood=mood, depletion_rate=rate, time_stamp=datetime(2026, 1, 1), room="central", index=0, current_room="", current_index=-1, upper_limit=limit or 24, workaholic=excluded == "workaholic", operator_type="high", resting_priority="high")
    op.current_mood = MethodType(current_mood, op)
    op.is_high = MethodType(is_high, op)
    data = NS(operators={"N": op}, config=NS(free_blacklist=["N"] if excluded == "blacklist" else [], ope_resting_priority=["N"] if priority else [], resting_priority_replacement=[]), get_current_operator=lambda *_: None, is_dynamic_dorm_position=lambda *args, **kwargs: True, has_rest_mood_limit=lambda _: limit is not None)
    data.rest_mood_complete = MethodType(rest_mood_complete, data)
    task = NS(group_shift_expected={("dormitory_1", 3): "N"})
    solver = NS(op_data=data, task=task)
    plan = {"dormitory_1": ["Current", "Current", "Current", "N", "Current"]}
    predicted = op.current_mood()
    tier = int(namespace["resting_tier"](data, "N"))
    cancel(solver, plan, {})
    cases.append({"name": name, "input": {"mood": mood, "depletionRate": rate, "elapsedHours": elapsed, "limit": limit, "priority": priority, "excluded": excluded}, "predictedBefore": predicted, "tier": tier, "output": plan["dormitory_1"], "depletionRateAfter": op.depletion_rate, "predictionAfter": op.current_mood(), "expectedTargetRetained": ("dormitory_1", 3) in task.group_shift_expected})

# Execute the upstream group timing block unchanged inside its required loop.
# Inputs isolate ordinary group recovery; task generation and its lead time are
# outside this block. The native normal_return_time helper is also unchanged.
normal_return_time = load(paths[3], "normal_return_time")
timing_blocks = [n for n in ast.walk(ast.parse(sources[paths[3]])) if isinstance(n, ast.If) and ast.unparse(n.test) == "high_dorms and group_name"]
assert len(timing_blocks) == 1
timing_block = timing_blocks[0]
source_methods["group_recovery_timing_block"] = {"path": paths[3], "line": timing_block.lineno}
timing_module = ast.fix_missing_locations(ast.Module(body=[ast.For(target=ast.Name(id="_case", ctx=ast.Store()), iter=ast.List(elts=[ast.Constant(None)], ctx=ast.Load()), body=[timing_block], orelse=[])], type_ignores=[]))
group_gaps = []
for name, times, enabled, threshold, max_wait in [
    ("earliest bed first", [1, 5], True, 60, 0),
    ("latest bed first", [5, 1], True, 60, 0),
    ("gap option disabled", [1, 5], False, 60, 0),
    ("gap equals threshold", [1, 2], True, 60, 0),
    ("positive extra wait limit", [1, 5], True, 60, 1),
]:
    now = datetime(2026, 1, 1)
    operators = {f"N{i}": NS(name=f"N{i}", room="central", index=i, group="G", dorm_position_version=0, exhaust_require=False) for i in range(len(times))}
    beds = [NS(name=f"N{i}", time=now + timedelta(hours=time)) for i, time in enumerate(times)]
    namespace.update(config=NS(conf=NS(group_rest_in_full_on_mood_gap=enabled, group_mood_gap_threshold_minutes=threshold, group_mood_gap_max_extra_wait_hours=max_wait)), op_data=NS(operators=operators, shift_group_members=lambda _: list(operators), is_group_shift_anchor=lambda _: True), now=now, min_resting_time=datetime.max, existing_targets={}, previous_windows={}, return_windows={}, high_dorms=beds, group_name="G", rest_in_full_dorms=[], max_rest_in_full_time=None, task_time=datetime.max, new_task={})
    exec(compile(timing_module, paths[3], "exec"), namespace)
    assert len(namespace["new_task"]) == 1
    batch_time, (_, full) = next(iter(namespace["new_task"].items()))
    group_gaps.append({"name": name, "input": {"times": times, "enabled": enabled, "thresholdMinutes": threshold, "maxWaitHours": max_wait}, "batchTimeHours": (batch_time - now).total_seconds() / 3600, "restInFull": full})

result = {"revision": REVISION, "scope": __doc__.split("Usage:")[0].strip() + " Native cancellation, priority and mood methods; explicit synthetic dynamic bed. Also native group recovery timing block and normal_return_time with synthetic recovery deadlines. No capacity, Free-card resolution, task-generation lead time, complete scheduler or device equivalence claim.", "sourceSha256": {p: hashlib.sha256(s.encode()).hexdigest() for p, s in sources.items()}, "methods": source_methods, "cases": cases, "groupRecoveryGaps": group_gaps}
output = Path(__file__).resolve().parents[2] / "src/scheduler/fixtures/mower-alpha-selection-20261013.json"
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(output)
