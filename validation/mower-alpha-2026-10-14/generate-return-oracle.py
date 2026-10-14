"""Execute unchanged alpha metadata/group-return AST on bounded synthetic states."""
import ast
import copy
from collections import defaultdict
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from types import ModuleType, SimpleNamespace as NS

REVISION = '3de2b2ac6f1aeff6513b63faaeea4b2369cf8856'
ROOT = Path(__file__).resolve().parents[2]
clock = datetime(2026, 10, 14)
class FixedDateTime(datetime):
    @classmethod
    def now(cls): return clock

paths = ['arknights_mower/utils/operators.py', 'arknights_mower/utils/scheduler_task.py',
         'arknights_mower/utils/exhaust_replacement.py']
sources = {p: subprocess.check_output(['git', 'show', f'{REVISION}:{p}'], cwd=sys.argv[1]).decode() for p in paths}
methods = {}
types = NS(**{name: name for name in ['SHIFT_ON', 'SHIFT_OFF', 'RELEASE_DORM', 'FILL_DORM', 'SELF_CORRECTION', 'RE_ORDER']})
class Task:
    def __init__(self, task_plan=None, time=None, task_type=None, meta_data=''):
        self.plan, self.time, self.type = task_plan or {}, time or clock, task_type
        self.meta_data, self.retains_execution = meta_data, False

ns = dict(copy=copy, datetime=FixedDateTime, timedelta=timedelta, defaultdict=defaultdict,
          logger=NS(debug=lambda *args: None), TaskTypes=types, SchedulerTask=Task,
          TaskScope=NS(DISPATCH=0), task_view=lambda tasks, scope: tasks,
          retained_task_reservations=lambda *args: (set(), set()),
          dorm_task_reservations=lambda *args: (set(), set()), vacant_dorm_slots=lambda *args: set(),
          plan_mood_limit_releases=lambda *args, **kwargs: [], busy_resting_names=lambda: set(),
          rebalance_closing_dorm_slots=lambda *args: set(),
          _after_pending_arrangements=lambda *args: datetime.min,
          merge_release_dorm=lambda *args: None,
          config=NS(conf=NS(group_rest_in_full_on_mood_gap=False, group_mood_gap_threshold_minutes=60,
                            group_mood_gap_max_extra_wait_hours=0, merge_interval=10)))
def load(path, name):
    node, = [node for node in ast.walk(ast.parse(sources[path])) if isinstance(node, ast.FunctionDef) and node.name == name]
    methods[name] = dict(path=path, line=node.lineno, astSha256=hashlib.sha256(ast.dump(node).encode()).hexdigest())
    exec(compile(ast.Module(body=[node], type_ignores=[]), path, 'exec'), ns)
    return ns[name]

load(paths[2], 'match_replacements')
module = ModuleType('arknights_mower.utils.exhaust_replacement')
module.match_replacements = ns['match_replacements']
sys.modules[module.__name__] = module
native_methods = ['_can_standby', 'is_group_shift_anchor', 'group_is_resting',
                  'shift_group_members', 'select_group_binding', 'arrangement_group_transitions',
                  'resting_binding_groups', 'shared_replacements', 'commit_group_shifts',
                  'working_replacement_blockers', 'normalize_shared_arrangement', 'is_same_group_primary_replacement']
for name in native_methods: load(paths[0], name)
load(paths[1], 'generate_plan_by_drom')
load(paths[1], 'plan_metadata')

class Operator:
    def __init__(self, row):
        self.name, self.room, self.index = row['name'], row.get('room', ''), row.get('index', -1)
        self.current_room, self.current_index = row.get('currentRoom', ''), row.get('currentIndex', -1)
        self.group, self.group_bindings = row.get('group', ''), row.get('groupBindings', [])
        self.multi_group = len(self.group_bindings) > 1
        self.replacement = row.get('replacement', [])
        self.operator_type, self.resting_priority = row.get('operatorType', 'high'), row.get('restingPriority', 'high')
        self.workaholic, self.exhaust_require, self.rest_in_full = row.get('workaholic', False), False, False
        self.mood, self.lower_limit, self.upper_limit = row.get('mood', 10), 0, 24
        self.dorm_position_version = 0
        self.prediction = row.get('predictHours', 24)
    def is_high(self): return self.operator_type == 'high'
    def is_resting(self): return self.current_room.startswith('dorm')
    def is_working(self): return bool(self.current_room) and not self.is_resting()
    def replacements_for_group(self, group):
        return next((binding['replacement'] for binding in self.group_bindings if binding['group'] == group), self.replacement)
    def predict_exhaust(self): return clock + timedelta(hours=self.prediction)
    def current_mood(self): return self.mood

class State:
    def __init__(self, spec):
        self.plan = {room: [NS(agent=name) for name in row] for room, row in spec['plan'].items()}
        self.operators = {row['name']: Operator(row) for row in spec['operators']}
        self.groups = defaultdict(list)
        for op in self.operators.values():
            if op.group: self.groups[op.group].append(op.name)
        self.group_shift_state = dict(spec.get('groupShiftState', {}))
        self.dorm = [NS(position=tuple(row['position']), name=row['name'], time=clock + timedelta(hours=row['hours'])) for row in spec['beds'] if not row.get('fixed')]
        self.group_dorm = [NS(position=tuple(row['position']), name=row['name'], time=clock + timedelta(hours=row['hours'])) for row in spec['beds'] if row.get('fixed')]
        self.reserved_product_replacements = set()
        self.config = NS(free_room=False, is_rest_in_full=lambda name: False)
        self.plan_condition = []
    def all_dorms(self): return self.dorm + self.group_dorm
    def is_effective_free_slot(self, dorm): return True
    def refresh_idle_dorm_search(self): pass
    def project_arrangements(self, plans):
        assert not list(plans), 'This oracle only adapts empty initial projections.'
        return copy.deepcopy(self)
    def get_current_operator(self, room, index):
        return next((op for op in self.operators.values() if (op.current_room, op.current_index) == (room, index)), None)
    def is_standby(self, name): return False
    def is_dorm_replacement(self, name): return False
    def has_rest_mood_limit(self, name): return False
    def skip_idle_dorm_release(self, name): return False
    def rest_mood_complete(self, name): return False
for name in native_methods: setattr(State, name, ns[name])

def describe(tasks):
    return [dict(type=task.type, timeMicros=round((task.time-clock).total_seconds()*1_000_000), plan=task.plan) for task in tasks]

def metadata_spec(extra):
    return dict(plan={'work':['A','X'], 'dormitory_1':['Free','Free']},
                operators=[dict(name='A', room='work', index=0, group='G', currentRoom='dormitory_1', currentIndex=0), extra],
                beds=[dict(position=['dormitory_1',0],name='A',hours=2)], groupShiftState={'G':True})
cases=[]
for kind, fields in [('fixed dormitory resident',dict(room='dormitory_1',index=1)),
                     ('workaholic resident',dict(room='work',index=1,workaholic=True)),
                     ('standby resident',dict(room='work',index=1,restingPriority='standby'))]:
    spec=metadata_spec(dict(name='X',group='G',currentRoom='dormitory_1',currentIndex=1,**fields))
    spec['beds'].append(dict(position=['dormitory_1',1],name='X',hours=0))
    if kind == 'fixed dormitory resident':
        spec['plan']['work'] = ['A']
        spec['plan']['dormitory_1'][1] = 'X'
        spec['beds'][-1]['fixed'] = True
    cases.append(dict(name=kind+' does not set the group return time',state=spec,expected=describe(ns['plan_metadata'](State(spec),[]))))
spec=metadata_spec(dict(name='X',room='work',index=1,group='G',currentRoom='work',currentIndex=1,predictHours=0,
                        groupBindings=[dict(group='G',replacement=['C']),dict(group='H',replacement=['C'])]))
spec['operators'].append(dict(name='C',operatorType='low'))
spec['groupShiftState']['H']=False
cases.append(dict(name='shared worker does not shorten another group recovery',state=spec,expected=describe(ns['plan_metadata'](State(spec),[]))))

spec=dict(plan={'work':['A','B','S'],'dormitory_1':['Free','Free','Free']},groupShiftState={'G':True,'H':True},
          operators=[dict(name=name,room='work',index=i,group=group,currentRoom='dormitory_1',currentIndex=i)
                     for i,(name,group) in enumerate([('A','G'),('B','H')])],
          beds=[dict(position=['dormitory_1',i],name=name,hours=i+1) for i,name in enumerate(['A','B'])])
spec['operators'] += [dict(name='S',room='work',index=2,group='G',currentRoom='dormitory_1',currentIndex=2,
                           replacement=['C'],groupBindings=[dict(group='G',replacement=['C']),dict(group='H',replacement=['C'])]),
                      dict(name='C',operatorType='low',currentRoom='work',currentIndex=2)]
state=State(spec)
batches={bed.time:([bed],False) for bed in state.dorm}
shared=dict(name='shared primary returns with the last dependent group',state=spec,
            expected=describe(ns['generate_plan_by_drom'](batches,state)))
result=dict(revision=REVISION,methods=methods,sourceSha256={path:hashlib.sha256(source.encode()).hexdigest() for path,source in sources.items()},
            scope='Unchanged native metadata and return-generation AST with native group matching. Synthetic known occupancy, empty projections, no closing-dorm migration, release, reservations or busy operators.',
            metadataCases=cases,sharedReturnCase=shared)
output=ROOT/'src/scheduler/fixtures/mower-alpha-return-20261014.json'
output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(output)
print(json.dumps({'metadata':[case['expected'] for case in cases],'shared':shared['expected']},ensure_ascii=False))
