import {describe,it,expect} from 'vitest'
import {MowerOperatorState} from './mowerOperatorState'
import {MowerSchedulingData,MowerDormState} from './mowerSchedulingData'
import {MowerTask,MowerTaskQueue,MOWER_TASK_TYPES as T,toMowerMicros} from './mowerTaskQueue'
import {retainMowerFailedTask,resumeMowerFailedTasks} from './mowerTaskFailure'
import {createRosterRuntime} from './rosterRuntime'
import {planMowerMetadata} from './mowerMetadata'

function fixture(alpha:boolean){
 const data=new MowerSchedulingData({alpha,adjustForRunOrders:false,plan:{central:['A','B'],dormitory_1:['Free','Free']},operators:{
  A:new MowerOperatorState({name:'A',room:'central',index:0,group:'a',replacement:['R'],operatorType:'high',currentRoom:'dormitory_1',currentIndex:0,mood:12,timeStampMicros:0}),
  B:new MowerOperatorState({name:'B',room:'central',index:1,group:'b',replacement:['S'],operatorType:'high',currentRoom:'dormitory_1',currentIndex:1,mood:12,timeStampMicros:0}),
  R:new MowerOperatorState({name:'R',currentRoom:'central',currentIndex:0,mood:24,timeStampMicros:0}),
  S:new MowerOperatorState({name:'S',currentRoom:'central',currentIndex:1,mood:24,timeStampMicros:0}),
 },dorms:[new MowerDormState(['dormitory_1',0],'A',toMowerMicros(1)),new MowerDormState(['dormitory_1',1],'B',toMowerMicros(1))],nowMicros:0,groupShiftState:{a:true,b:true}})
 const state=createRosterRuntime({positions:[],beds:[],mowerSourcePlan:{central:[{agent:'A',group:'a',replacement:['R']},{agent:'B',group:'b',replacement:['S']}]}})
 return {data,state,queue:new MowerTaskQueue()}
}

describe.each([false,true])('metadata derived admission (alpha=%s)',alpha=>{
 it.each([false,true])('does not regenerate a retained return while independent same-room work remains (resumed=%s)',resumed=>{
  const {data,state,queue}=fixture(alpha),task=new MowerTask({type:T.SHIFT_ON,time:.2,plan:{central:['A','Current']}})
  queue.tasks=[task];retainMowerFailedTask(state,data,task,'failed return')
  if(resumed){data.operators.A!.timeStampMicros=1;expect(resumeMowerFailedTasks(state,data,queue)).toBe(true)}
  const plan=structuredClone(task.plan),deadline=task.timeMicros
  planMowerMetadata(data,queue);planMowerMetadata(data,queue)
  expect(queue.tasks).toContain(task);expect(task.plan).toEqual(plan);expect(task.timeMicros).toBe(deadline)
  expect(queue.tasks.filter(t=>t!==task).some(t=>Object.values(t.plan).flat().includes('A'))).toBe(false)
  expect(queue.tasks.filter(t=>t!==task).map(t=>t.plan)).toContainEqual({central:['Current','B']})
 })
 it('blocks a retained destination without dropping the independent slot in the same batch',()=>{
  const {data,state,queue}=fixture(alpha),task=new MowerTask({type:T.SHIFT_OFF,time:.2,plan:{central:['R','Current']}})
  queue.tasks=[task];retainMowerFailedTask(state,data,task,'failed downshift')
  planMowerMetadata(data,queue)
  expect(queue.tasks.filter(t=>t!==task).some(t=>t.plan.central?.[0]!==undefined&&t.plan.central[0]!=='Current')).toBe(false)
  expect(queue.tasks.filter(t=>t!==task).map(t=>t.plan)).toContainEqual({central:['Current','B']})
 })
 it('does not release the named resident of a retained return whose remainder has no dorm room',()=>{
  const {data,state,queue}=fixture(alpha),task=new MowerTask({type:T.SHIFT_ON,time:.2,plan:{central:['A','Current']}})
  for(const name of ['A','B']){data.operators[name]!.restMoodLimit=true;data.operators[name]!.upperLimit=12}
  queue.tasks=[task];retainMowerFailedTask(state,data,task,'failed return')
  planMowerMetadata(data,queue)
  expect(queue.tasks.filter(t=>t!==task&&t.type===T.RELEASE_DORM).map(t=>t.metadata)).toEqual(['B'])
  expect(task.plan).toEqual({central:['A','Current']});expect(task.timeMicros).toBe(toMowerMicros(.2))
 })
 it('preserves a resumed retained release when alpha merges independent derived releases',()=>{
  const {data,state,queue}=fixture(alpha)
  for(const name of ['A','B']){const op=data.operators[name]!;op.operatorType='low';op.room='';op.group=''}
  data.freeRoom=true
  const task=new MowerTask({type:T.RELEASE_DORM,time:.9,plan:{dormitory_1:['Free','Current']},metadata:'A'})
  queue.tasks=[task];retainMowerFailedTask(state,data,task,'failed release');data.operators.A!.timeStampMicros=1
  expect(resumeMowerFailedTasks(state,data,queue)).toBe(true)
  planMowerMetadata(data,queue)
  expect(queue.tasks).toContain(task);expect(task.plan).toEqual({dormitory_1:['Free','Current']});expect(task.timeMicros).toBe(toMowerMicros(.9))
  expect(queue.tasks.filter(t=>t!==task).some(t=>t.plan.dormitory_1?.[1]==='Free')).toBe(true)
 })
})
