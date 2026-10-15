"""Replay unmodified 3de2b2ac6 isolation and dorm assignment AST offline.

Usage: python3 validation/mower-alpha-2026-10-14/generate-isolation-oracle.py /path/to/mower
Synthetic adapters provide occupancy, dynamic Free beds and unconstrained capacity.
No Calculator implementation is imported; no game/device services are executed.
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
from types import SimpleNamespace as NS

REVISION = '3de2b2ac6f1aeff6513b63faaeea4b2369cf8856'
ROOT = Path(__file__).resolve().parents[2]
paths = ['arknights_mower/utils/operators.py', 'arknights_mower/utils/plan.py',
         'arknights_mower/utils/scheduler_task.py', 'arknights_mower/utils/resting_priority.py']
sources = {p: subprocess.check_output(['git', 'show', f'{REVISION}:{p}'], cwd=sys.argv[1]).decode() for p in paths}
clock = datetime(2026, 10, 14)
class FixedDateTime:
    @staticmethod
    def now(): return clock

config = NS(conf=NS(dorm_isolation=[]))
namespace = dict(copy=copy, datetime=FixedDateTime, config=config, IntEnum=IntEnum,
                 logger=NS(debug=lambda *_: None), DEFAULT_DORM_ROOM_ORDER=[f'dormitory_{i}' for i in range(1, 5)])
methods = {}
def load(path, name):
    nodes = [n for n in ast.walk(ast.parse(sources[path])) if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name == name]
    assert len(nodes) == 1, (path, name)
    node = nodes[0]
    methods[name] = dict(path=path, line=node.lineno, astSha256=hashlib.sha256(ast.dump(node).encode()).hexdigest())
    exec(compile(ast.Module(body=[node], type_ignores=[]), path, 'exec'), namespace)
    return namespace[name]

for name in ['RestingTier', '_replacement_tier', 'resting_tier', 'has_resting_mood', 'resting_mood', 'resting_key', 'bed_takeover_allowed']:
    load(paths[3], name)
load(paths[1], 'effective_dorm_order')
for name in ['ordered_dorms', 'dorm_roommates', 'dorm_isolation_cost', '_slot_takable', '_find_dorm_slot', 'assign_dorm', 'current_mood']:
    load(paths[0], name)
load(paths[2], 'plan_dorm_isolation')

class Operator:
    def __init__(self, row):
        self.name = row['name']
        self.current_room, self.current_index = row.get('currentRoom', ''), row.get('currentIndex', -1)
        self.room, self.index = row.get('room', ''), row.get('index', -1)
        self.mood, self.upper_limit = row.get('mood', 10), row.get('upperLimit', 24)
        self.time_stamp = clock if row.get('known', True) else None
        self.depletion_rate = 0
        self.operator_type, self.resting_priority = row.get('operatorType', 'low'), row.get('restingPriority', 'low')
        self.workaholic, self.resting_from_train = row.get('workaholic', False), False
        self.standby_low_priority = False
    def is_resting(self): return self.current_room.startswith('dorm')
    def is_high(self): return self.operator_type == 'high'
    current_mood = namespace['current_mood']

class State:
    def __init__(self, spec):
        self.config = NS(dorm_order=spec.get('dormOrder', []), free_blacklist=spec.get('freeBlacklist', []),
                         ope_resting_priority=spec.get('priorityNames', []), resting_priority_replacement=[])
        self.plan = {room: [NS(agent=name, all_replacements=[]) for name in row] for room, row in spec['plan'].items()}
        self.operators = {row['name']: Operator(row) for row in spec['operators']}
        self.dorm = [NS(position=tuple(b['position']), name=b.get('name', ''), time=None) for b in spec['beds']]
        self.reserved_product_beds = {tuple(row[:2]): row[2] for row in spec.get('reservedProductBeds', [])}
        self.excluded = set(spec.get('freeRoomExclusions', []))
    def all_dorms(self): return self.dorm
    def rest_mood_complete(self, name): return False  # All fixture residents lack a strict personal release limit.
    def arrangement_group_transitions(self, *args, **kwargs): return {}
    def dorm_capacity_allows(self, *args, **kwargs): return True
    def is_recovery_dorm(self, bed, name, **kwargs): return self.is_effective_free_slot(bed)
    def is_free_room_excluded(self, name): return name in self.excluded
    def get_current_operator(self, room, index):
        return next((op for op in self.operators.values() if (op.current_room, op.current_index) == (room, index)), None)
    def get_current_room(self, room, bypass):
        return [op.name if (op := self.get_current_operator(room, index)) else '' for index in range(len(self.plan[room]))]
    def is_effective_free_slot(self, bed, **kwargs):
        return self.plan[bed.position[0]][bed.position[1]].agent == 'Free'
    def project_arrangements(self, plans):
        state = copy.deepcopy(self)
        for plan in plans:
            changed = {(room, index) for room, row in plan.items() for index, name in enumerate(row) if name != 'Current'}
            for op in state.operators.values():
                if (op.current_room, op.current_index) in changed: op.current_room, op.current_index = '', -1
            for room, row in plan.items():
                for index, name in enumerate(row):
                    if name in state.operators: state.operators[name].current_room, state.operators[name].current_index = room, index
            for bed in state.dorm:
                op = state.get_current_operator(*bed.position)
                bed.name = op.name if op else ''
        return state
for name in ['ordered_dorms', 'dorm_roommates', 'dorm_isolation_cost', '_slot_takable', '_find_dorm_slot', 'assign_dorm']:
    setattr(State, name, namespace[name])

def base(fixed=False):
    return dict(plan={f'dormitory_{r}': ([f'K{r}', 'Free', 'Free', 'Free'] if fixed else ['Free'] * 3) for r in (1, 2)},
                operators=[dict(name=n) for n in 'ABCD'],
                beds=[dict(position=[f'dormitory_{r}', i], name='') for r in (1, 2) for i in (range(1, 4) if fixed else range(3))],
                dormIsolation=[['A', 'B']])
def op(spec, name, **values):
    row = next((row for row in spec['operators'] if row['name'] == name), None)
    if row is None: row = dict(name=name); spec['operators'].append(row)
    row.update(values)
def seat(spec, name, room, index):
    op(spec, name, currentRoom=room, currentIndex=index)
    for bed in spec['beds']:
        if bed['position'] == [room, index]: bed['name'] = name
def isolation(spec, plan, reserved=(), names=()):
    config.conf.dorm_isolation = spec['dormIsolation']
    return namespace['plan_dorm_isolation'](State(spec), plan, [tuple(x) for x in reserved], reserved_names=names)

# Preserve the earlier fixture interface so its seven historical cases are rerun
# against the new upstream algorithm, rather than silently retaining old answers.
cases = []
for case in json.loads((ROOT / 'src/scheduler/fixtures/mower-dorm-isolation-20261013.json').read_text())['cases']:
    options, spec = case['options'], base()
    seat(spec, 'A', 'dormitory_1', 0)
    if options.get('residentB'): seat(spec, 'B', 'dormitory_1', 1)
    if options.get('priorityB'): op(spec, 'B', operatorType='high', restingPriority='high')
    if options.get('explicitOrder'): spec['dormOrder'] = ['dormitory_1_low', 'dormitory_2_low']
    if options.get('productReserved'): spec['reservedProductBeds'] = [['dormitory_1', 1, 'B']]
    op(spec, 'C', mood=options.get('moodC', 10))
    cases.append(dict(name=case['name'], options=options, input=case['input'], expected=isolation(spec, case['input'], options.get('reserved', []))))

isolation_cases = []
def add(label, spec, plan, reserved=(), names=()):
    isolation_cases.append(dict(name=label, state=spec, input=plan, reservedSlots=reserved, reservedNames=names,
                                expected=isolation(spec, plan, reserved, names)))

def residents():
    spec = base(True)
    seat(spec, 'K1', 'dormitory_1', 0); seat(spec, 'K2', 'dormitory_2', 0)
    seat(spec, 'A', 'dormitory_1', 1); seat(spec, 'D', 'dormitory_2', 1)
    return spec
ordinary = {'dormitory_1': ['Current', 'Current', 'B', 'Current'], 'dormitory_2': ['Current', 'Current', 'C', 'Current']}
spec = residents(); seat(spec, 'C', 'dormitory_2', 2); op(spec, 'B', operatorType='high', restingPriority='high')
add('new high-tier arrival can exchange an existing ordinary resident', spec, ordinary)
for label, flag in [('reserved ordinary resident name', 'name'), ('reserved ordinary bed', 'slot'), ('product-reserved ordinary bed', 'product'), ('excluded ordinary resident', 'excluded'), ('retained ordinary resident', 'retained')]:
    spec = residents(); seat(spec, 'C', 'dormitory_2', 2)
    # Restrict empty alternatives so this case isolates the protected resident.
    for r in (1, 2): seat(spec, f'X{r}', f'dormitory_{r}', 3); op(spec, f'X{r}', workaholic=True)
    if flag == 'product': spec['reservedProductBeds'] = [['dormitory_2', 2, 'C']]
    if flag == 'excluded': spec['freeBlacklist'] = ['C']
    if flag == 'retained': spec['freeRoomExclusions'] = ['C']
    add(label, spec, ordinary, [['dormitory_2', 2]] if flag == 'slot' else [], ['C'] if flag == 'name' else [])
spec = residents(); seat(spec, 'C', 'dormitory_2', 2); op(spec, 'C', currentRoom='room_1_1', currentIndex=0)
add('implicit future admission protects its reserved bed', spec, {'dormitory_1': ['Current', 'Current', 'B', 'Current']})
spec = residents(); spec['dormIsolation'] = [['K1', 'B']]; op(spec, 'B', operatorType='high', restingPriority='high')
add('new first-bed arrival yields for isolation', spec, {'dormitory_1': ['Current', 'B', 'Current', 'Current'], 'dormitory_2': ['Current', 'Current', 'C', 'Current']})
spec = residents(); spec['dormIsolation'] = [['K1', 'B']]; op(spec, 'C', operatorType='high', restingPriority='high')
add('higher recovery tier takes new first bed when isolation score ties', spec, {'dormitory_1': ['Current', 'B', 'C', 'Current']})
spec = residents(); spec['dormIsolation'] = [['K1', 'B']]; op(spec, 'B', mood=24); op(spec, 'C', operatorType='high', restingPriority='high')
add('observed full arrival yields first bed to recovering main', spec, {'dormitory_1': ['Current', 'B', 'C', 'Current']})
spec = residents(); spec['dormIsolation'] = [['K1', 'K2']]; op(spec, 'B', mood=1); op(spec, 'C', mood=23)
add('ordinary equal-tier residents do not move for morale difference alone', spec, ordinary)
spec = residents(); spec['dormOrder'] = ['dormitory_1_low', 'dormitory_2_low']; op(spec, 'B', operatorType='high', restingPriority='high'); op(spec, 'C', mood=23)
add('explicit low order still permits cross-tier isolation', spec, ordinary)
spec = residents(); seat(spec, 'B', 'dormitory_1', 2)
add('no new dorm arrivals leaves existing arrangements alone', spec, {'dormitory_1': ['Current', 'Current', 'B', 'Current']})
spec = residents(); spec['plan']['room_1_1'] = ['Free']; seat(spec, 'B', 'dormitory_1', 2)
add('a work-room-only newcomer does not trigger dorm reshuffling', spec, {'room_1_1': ['C']})

assignment_cases = []
def assign(label, spec, requester='B', used=(), plan=None):
    config.conf.dorm_isolation = spec['dormIsolation']; state = State(spec)
    index = state._find_dorm_slot(requester, set(used), plan=plan)
    # Also run actual assign_dorm when there is no pending-plan parameter.
    if plan is None:
        actual = state.assign_dorm(requester, used=set(used))
        assert (actual.position if actual else None) == (state.dorm[index].position if index is not None else None)
    assignment_cases.append(dict(name=label, state=spec, requester=requester, used=list(used), input=plan or {},
                                 expectedPosition=list(state.dorm[index].position) if index is not None else None))
spec = residents(); seat(spec, 'C', 'dormitory_1', 2); seat(spec, 'E', 'dormitory_2', 2)
op(spec, 'C', mood=23); op(spec, 'E', mood=1); op(spec, 'B', operatorType='high', restingPriority='high')
assign('same takeover tier chooses isolation before smaller recovery gap', spec, used=[0, 2, 3, 5])
spec = copy.deepcopy(spec); spec['dormOrder'] = ['dormitory_1_low', 'dormitory_2_low']
assign('explicit low order does not disable takeover isolation', spec, used=[0, 2, 3, 5])
spec = residents(); spec['dormOrder'] = ['dormitory_1_low', 'dormitory_2_low']
assign('explicit low order does not disable empty-bed isolation', spec)
spec = residents(); seat(spec, 'C', 'dormitory_1', 2); seat(spec, 'E', 'dormitory_2', 2)
op(spec, 'B', operatorType='high', restingPriority='high'); op(spec, 'E', operatorType='high', restingPriority='low')
assign('takeover recovery tier remains ahead of isolation', spec, used=[0, 2, 3, 5])
spec = residents(); spec['dormIsolation'] = [['K1', 'K2']]; seat(spec, 'C', 'dormitory_1', 2); seat(spec, 'E', 'dormitory_2', 2)
op(spec, 'B', operatorType='high', restingPriority='high'); op(spec, 'C', mood=23); op(spec, 'E', mood=1)
assign('equal tier and isolation prefer the smaller recovery gap', spec, used=[0, 2, 3, 5])

result = dict(revision=REVISION, scope=__doc__.split('Usage:')[0].strip() + ' Native isolation, ordering, tier, mood, slot eligibility and assignment functions; explicit synthetic occupancy/projection and unlimited capacity adapters. No automatic group beds, emergency residents, physical I/O or complete scheduler equivalence claim.',
              sourceSha256={p: hashlib.sha256(s.encode()).hexdigest() for p, s in sources.items()}, methods=methods,
              cases=cases, isolationCases=isolation_cases, assignmentCases=assignment_cases)
output = ROOT / 'src/scheduler/fixtures/mower-alpha-isolation-20261014.json'
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(f'{output}: {len(cases)} historical, {len(isolation_cases)} isolation, {len(assignment_cases)} assignment cases')
