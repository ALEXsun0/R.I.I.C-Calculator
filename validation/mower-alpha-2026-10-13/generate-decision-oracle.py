"""Generate October 13 decisions from unmodified upstream AST; no device imports."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace as NS

REVISION = 'ab0a4e5bec23f6f8d7c37b0648f05dda28f31866'
sources = {p: subprocess.check_output(['git', 'show', f'{REVISION}:{p}'], cwd=sys.argv[1]).decode() for p in ['arknights_mower/utils/plan.py', 'arknights_mower/utils/operators.py', 'arknights_mower/solvers/base_schedule.py']}
def function(path, name):
    nodes = [n for n in ast.walk(ast.parse(sources[path])) if isinstance(n, ast.FunctionDef) and n.name == name]
    assert len(nodes) == 1, (name, len(nodes))
    return nodes[0]
def execute(node, namespace):
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<upstream>', 'exec'), namespace)
    return namespace[node.name]
namespace = {'DEFAULT_DORM_ROOM_ORDER': [f'dormitory_{i}' for i in range(1, 5)]}
execute(function('arknights_mower/utils/plan.py', 'effective_dorm_order'), namespace)
ordered = execute(function('arknights_mower/utils/operators.py', 'ordered_dorms'), namespace)
beds = [NS(position=(f'dormitory_{room}', slot)) for room in (1, 2) for slot in (0, 1)]
dorm_cases = []
for order in [[], ['dormitory_2_low', 'dormitory_1'], ['dormitory_2', 'dormitory_2_4']]:
    for closed in [[], [0], [0, 2]]:
        state = NS(config=NS(dorm_order=order), dorm=beds, is_effective_free_slot=lambda bed, **kw: beds.index(bed) not in closed)
        dorm_cases.append({'order': order, 'closed': closed, 'indices': [beds.index(b) for b in ordered(state)]})

# Isolate the nested availability decision with explicit surrounding state.
# No branch, predicate or return value of the upstream function is rewritten.
predicate = function('arknights_mower/solvers/base_schedule.py', 'replacement_available')
covers = []
for label, room, index, existing, retained in [
    ('idle cover', '', -1, False, False),
    ('resting cover', 'dormitory_1', 0, False, False),
    ('already in target', 'room_1_1', 0, False, False),
    ('already in target retained by preview', 'room_1_1', 0, True, True),
    ('already in target reserved elsewhere', 'room_1_1', 0, True, False),
    ('different working slot', 'room_1_2', 0, False, False),
    ('same room different slot', 'room_1_1', 1, False, False),
]:
    cover = NS(current_room=room, current_index=index, room='', index=-1, is_resting=lambda: room.startswith('dorm'))
    state = NS(operators={'C': cover}, is_same_group_primary_replacement=lambda op, name: False, replacement_exhausted=lambda *a, **kw: False, is_dorm_replacement=lambda n: False)
    env = dict(self=NS(op_data=state), x=NS(room='room_1_1', index=0), agents=['A'], TRADE_ORDER_AGENTS=[], _is_mastery_busy=lambda n: False, protected_training=[], exist_replacement=['C'] if existing else [], plan={'room_1_1': ['C']} if retained else {}, reserved_names=[])
    covers.append({'name': label, 'room': room, 'index': index, 'existing': existing, 'retained': retained, 'accepted': execute(predicate, env)('C')})
result = {'revision': REVISION, 'scope': 'Unmodified ordered_dorms and nested replacement_available; explicit offline occupancy, no full scheduler or device equivalence claim.', 'sourceSha256': {p: hashlib.sha256(s.encode()).hexdigest() for p, s in sources.items()}, 'dormCases': dorm_cases, 'covers': covers}
output = Path(__file__).resolve().parents[2] / 'src/scheduler/fixtures/mower-alpha-decisions-20261013.json'
output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(output)
