"""Run unmodified alpha shared-group methods against explicit offline occupancy.

Usage: python3 validation/mower-alpha-2026-10-13/generate-shared-group-oracle.py /path/to/mower
Only Git object reads and in-memory fixture operations are performed; no devices.
"""
import ast
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import types

REVISION = "ab0a4e5bec23f6f8d7c37b0648f05dda28f31866"
repo = Path(sys.argv[1])
sources = {}
for path in ("arknights_mower/utils/operators.py", "arknights_mower/utils/exhaust_replacement.py"):
    sources[path] = subprocess.check_output(["git", "show", f"{REVISION}:{path}"], cwd=repo).decode()

def methods(source, owner, names):
    tree = ast.parse(source)
    body = tree.body if owner is None else next(n.body for n in tree.body if isinstance(n, ast.ClassDef) and n.name == owner)
    selected = [n for n in body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
    assert {n.name for n in selected} == set(names)
    return selected

namespace = {"__builtins__": __builtins__}
match_source = sources["arknights_mower/utils/exhaust_replacement.py"]
exec(compile(ast.Module(body=methods(match_source, None, ["match_replacements"]), type_ignores=[]), "native-match", "exec"), namespace)
module = types.ModuleType("arknights_mower.utils.exhaust_replacement")
module.match_replacements = namespace["match_replacements"]
sys.modules[module.__name__] = module

operator_source = sources["arknights_mower/utils/operators.py"]
operator_namespace = {"__builtins__": __builtins__, "base_room_list": ["room_1_1", "room_1_2", "room_1_3", "dormitory_1"]}
exec(compile(ast.Module(body=methods(operator_source, "Operator", ["multi_group", "replacements_for_group", "is_high", "is_resting", "is_working"]), type_ignores=[]), "native-operator", "exec"), operator_namespace)
Operator = type("OfflineOperator", (), {k: v for k, v in operator_namespace.items() if k not in ("__builtins__", "base_room_list")})

operator_methods = ["shift_group_members", "select_group_binding", "arrangement_group_transitions", "resting_binding_groups", "shared_replacements", "commit_group_shifts", "working_replacement_blockers", "normalize_shared_arrangement", "is_group_shift_anchor", "group_is_resting", "is_same_group_primary_replacement", "is_effective_free_slot"]
state_namespace = {"__builtins__": __builtins__}
exec(compile(ast.Module(body=methods(operator_source, "Operators", operator_methods), type_ignores=[]), "native-groups", "exec"), state_namespace)
class Occupancy:
    """Physical observations only; group decisions are loaded above from Git."""
    def get_current_operator(self, room, index):
        return next((op for op in self.operators.values() if (op.current_room, op.current_index) == (room, index)), None)
    def _can_standby(self, op):
        return False
    def is_dorm_replacement(self, name):
        op = self.operators[name]
        if not op.is_resting():
            return False
        owner = self.operators.get(self.plan[op.current_room][op.current_index].agent)
        return bool(owner and owner.group and "Free" not in owner.replacement and name in owner.replacement)
State = type("OfflineState", (Occupancy,), {k: v for k, v in state_namespace.items() if k != "__builtins__"})

def fixture(dorm=False, disjoint=False):
    state = State()
    state.plan = {"room_1_1": [types.SimpleNamespace(agent="A")], "room_1_2": [types.SimpleNamespace(agent="B")], "room_1_3": [] if dorm else [types.SimpleNamespace(agent="F")], "dormitory_1": [types.SimpleNamespace(agent="F" if dorm and index == 0 else "Free") for index in range(5)]}
    state.groups = {"a": ["A", "F"], "b": ["B"]}
    state.group_shift_state = {}
    state.reserved_product_replacements = set()
    state.operators = {}
    for name, room, group, replacements in [("A", "room_1_1", "a", ["X"]), ("B", "room_1_2", "b", ["Y"]), ("F", "dormitory_1" if dorm else "room_1_3", "a", ["Free"] if dorm else ["C", "D"]), *[(name, "", "", []) for name in ("X", "Y", "C", "D", "E")]]:
        op = Operator()
        op.name, op.room, op.index, op.group, op.replacement = name, room, 0 if room else -1, group, replacements
        op.current_room, op.current_index = room, op.index
        op.operator_type, op.workaholic, op.group_bindings = "high" if room else "low", False, []
        state.operators[name] = op
    state.operators["F"].group_bindings = [{"group": "a", "replacement": ["Free"] if dorm else ["C", "D"]}, {"group": "b", "replacement": ["Free"] if dorm else ["E"] if disjoint else ["D", "E"]}]
    return state

def run(name, dorm, plans, disjoint=False):
    state, steps = fixture(dorm, disjoint), []
    for original in plans:
        plan = copy.deepcopy(original)
        before = copy.deepcopy(state.group_shift_state)
        ok = state.normalize_shared_arrangement(plan)
        assert state.group_shift_state == before
        if ok:
            transitions = state.arrangement_group_transitions(plan)
            changed = {(room, index) for room, row in plan.items() for index, target in enumerate(row) if target != "Current"}
            assigned = {name for row in plan.values() for name in row if name not in ("Current", "Free", "")}
            for op in state.operators.values():
                if (op.current_room, op.current_index) in changed or op.name in assigned:
                    op.current_room, op.current_index = "", -1
            for room, row in plan.items():
                for index, target in enumerate(row):
                    if target in state.operators:
                        state.operators[target].current_room, state.operators[target].current_index = room, index
            state.commit_group_shifts(transitions)
        steps.append({"input": original, "accepted": ok, "plan": plan, "groups": copy.deepcopy(state.group_shift_state)})
    return {"name": name, "dorm": dorm, "disjoint": disjoint, "steps": steps}

cases = [
    run("shared working follower", False, [{"room_1_1": ["X"]}, {"room_1_2": ["Y"]}, {"room_1_1": ["A"]}, {"room_1_2": ["B"]}]),
    run("shared Free keeper", True, [{"room_1_1": ["X"], "dormitory_1": ["C", "Current", "Current", "Current", "Current"]}, {"room_1_2": ["Y"]}, {"room_1_1": ["A"]}, {"room_1_2": ["B"]}]),
    run("incompatible binding intersection", False, [{"room_1_1": ["X"], "room_1_2": ["Y"]}], True),
]
free_slots = []
for case in [
    {"name": "closed shared Free bed", "reserved": "", "active": [], "inactive": [], "state": {}},
    {"name": "unconfirmed shared reservation", "reserved": "A", "active": [], "inactive": [], "state": {}},
    {"name": "explicit downshift opens shared Free bed", "reserved": "", "active": ["a"], "inactive": [], "state": {}},
    {"name": "explicit return closes shared reservation", "reserved": "A", "active": [], "inactive": ["a"], "state": {}},
    {"name": "overlapping rest keeps shared Free bed open", "reserved": "A", "active": [], "inactive": ["a"], "state": {"a": True, "b": True}},
]:
    state = fixture(True)
    state.group_shift_state = case["state"]
    bed = types.SimpleNamespace(position=("dormitory_1", 0), name=case["reserved"])
    free_slots.append({**case, "effective": state.is_effective_free_slot(bed, set(case["active"]), set(case["inactive"]))})
result = {"freeSlots": free_slots, "revision": REVISION, "scope": "Unmodified shared-group methods; explicit offline occupancy and no standby operators. No device or full scheduler equivalence claim.", "sourceSha256": {p: hashlib.sha256(s.encode()).hexdigest() for p, s in sources.items()}, "cases": cases}
output = Path(__file__).resolve().parents[2] / "src/scheduler/fixtures/mower-shared-groups-20261013.json"
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(output)
