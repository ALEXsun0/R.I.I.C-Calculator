"""Run unchanged alpha isolation functions with explicit offline occupancy adapters.

Usage: python3 validation/mower-alpha-2026-10-13/generate-dorm-isolation-oracle.py /path/to/mower
No live device, game account or scheduler services are accessed.
"""
import ast
import copy
from datetime import datetime
from enum import IntEnum
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

REVISION = 'ab0a4e5bec23f6f8d7c37b0648f05dda28f31866'
paths = ['arknights_mower/utils/operators.py', 'arknights_mower/utils/plan.py', 'arknights_mower/utils/scheduler_task.py']
sources = {path: subprocess.check_output(['git', 'show', f'{REVISION}:{path}'], cwd=sys.argv[1]).decode() for path in paths}
def selected(path, owner, names):
    body = ast.parse(sources[path]).body
    if owner:
        body = next(node.body for node in body if isinstance(node, ast.ClassDef) and node.name == owner)
    nodes = [node for node in body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(nodes) == len(names)
    return nodes

class RestingTier(IntEnum):
    MAIN = 1
    IDLE = 6

config = SimpleNamespace(conf=SimpleNamespace(dorm_isolation=[['A', 'B']]))
def resting_tier(state, name):
    return state.operators[name].tier if name else RestingTier.IDLE

def resting_key(state, name, now=None):
    return (resting_tier(state, name), state.operators[name].mood - 24)

namespace = dict(copy=copy, datetime=datetime, config=config, RestingTier=RestingTier, resting_tier=resting_tier, resting_key=resting_key, DEFAULT_DORM_ROOM_ORDER=[f'dormitory_{i}' for i in range(1, 5)])
nodes = selected(paths[1], None, ['effective_dorm_order']) + selected(paths[0], 'Operators', ['ordered_dorms', 'dorm_roommates', 'dorm_isolation_cost']) + selected(paths[2], None, ['plan_dorm_isolation'])
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'native-dorm-isolation', 'exec'), namespace)

class Operator:
    def __init__(self, name, room='', index=-1):
        self.name, self.current_room, self.current_index = name, room, index
        self.mood, self.tier = 10, RestingTier.IDLE
    def is_resting(self):
        return self.current_room.startswith('dormitory_')

class State:
    def __init__(self):
        self.config = SimpleNamespace(dorm_order=[])
        self.plan = {f'dormitory_{room}': ['Free'] * 3 for room in (1, 2)}
        self.dorm = [SimpleNamespace(position=(f'dormitory_{room}', index), name='') for room in (1, 2) for index in range(3)]
        self.operators = {name: Operator(name) for name in 'ABCD'}
        self.operators['A'] = Operator('A', 'dormitory_1', 0)
        self.dorm[0].name = 'A'
        self.reserved_product_beds = {}
    def all_dorms(self):
        return self.dorm
    def get_current_operator(self, room, index):
        return next((op for op in self.operators.values() if (op.current_room, op.current_index) == (room, index)), None)
    def get_current_room(self, room, bypass):
        return [(op.name if (op := self.get_current_operator(room, index)) else '') for index in range(len(self.plan[room]))]
    def is_effective_free_slot(self, bed, **kwargs):
        return self.plan[bed.position[0]][bed.position[1]] == 'Free'
    def project_arrangements(self, plans):
        state = copy.deepcopy(self)
        for plan in plans:
            changes = {(room, index) for room, row in plan.items() for index, name in enumerate(row) if name != 'Current'}
            for op in state.operators.values():
                if (op.current_room, op.current_index) in changes:
                    op.current_room, op.current_index = '', -1
            for room, row in plan.items():
                for index, name in enumerate(row):
                    if name in state.operators:
                        state.operators[name].current_room, state.operators[name].current_index = room, index
            for bed in state.dorm:
                op = state.get_current_operator(*bed.position)
                bed.name = op.name if op else ''
        return state

for name in ['ordered_dorms', 'dorm_roommates', 'dorm_isolation_cost']:
    setattr(State, name, namespace[name])

cases = []
for label, options in [
    ('equal-tier newcomers', {}),
    ('existing resident', {'residentB': True}),
    ('reserved arrival slot', {'reserved': [['dormitory_1', 1]]}),
    ('product reservation', {'productReserved': True}),
    ('different recovery tiers', {'priorityB': True}),
    ('explicit order equal recovery key', {'explicitOrder': True}),
    ('explicit order different recovery key', {'explicitOrder': True, 'moodC': 11}),
]:
    state = State()
    if options.get('residentB'):
        state.operators['B'].current_room, state.operators['B'].current_index = 'dormitory_1', 1
        state.dorm[1].name = 'B'
    if options.get('priorityB'):
        state.operators['B'].tier = RestingTier.MAIN
    if options.get('explicitOrder'):
        state.config.dorm_order = ['dormitory_1_low', 'dormitory_2_low']
    if options.get('productReserved'):
        state.reserved_product_beds[('dormitory_1', 1)] = 'B'
    state.operators['C'].mood = options.get('moodC', 10)
    plan = {'dormitory_1': ['Current', 'B', 'Current'], 'dormitory_2': ['Current', 'C', 'Current']}
    result = namespace['plan_dorm_isolation'](state, plan, [tuple(slot) for slot in options.get('reserved', [])])
    cases.append(dict(name=label, options=options, input=plan, expected=result))
result = dict(revision=REVISION, scope='Unmodified plan_dorm_isolation, ordered_dorms and roommate methods; explicit offline occupancy/tier adapters. Not a full native scheduler or live-game oracle.', sourceSha256={path: hashlib.sha256(source.encode()).hexdigest() for path, source in sources.items()}, cases=cases)
output = Path(__file__).resolve().parents[2] / 'src/scheduler/fixtures/mower-dorm-isolation-20261013.json'
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(output)
