import {describe,it,expect} from 'vitest'
import {createRosterRuntime} from './rosterRuntime'
import {MowerOperatorState} from './mowerOperatorState'
import {MowerSchedulingData} from './mowerSchedulingData'
import {MowerTask,MowerTaskQueue,MOWER_TASK_TYPES as T,toMowerMicros} from './mowerTaskQueue'
import {retainMowerFailedTask,resumeMowerFailedTasks} from './mowerTaskFailure'
import {prepareMowerRunEntry} from './mowerRunLifecycle'
import {scheduleMowerTasks} from './mowerTaskScheduling'
import {normalizeMowerSharedArrangement} from './mowerSharedGroups'

function fixture(){
 const state=createRosterRuntime({positions:[],beds:[],mowerSourcePlan:{room_1_1:[{agent:'A',group:'',replacement:['R']}]}})
 state.mowerFacilityProducts={room_1_1:'gold'}
 const data=new MowerSchedulingData({alpha:true,plan:{room_1_1:['A']},operators:{A:new MowerOperatorState({name:'A',room:'room_1_1',index:0,currentRoom:'room_1_1',currentIndex:0,mood:12,timeStampMicros:0}),R:new MowerOperatorState({name:'R',mood:24,timeStampMicros:0})},dorms:[],nowMicros:0})
 const task=new MowerTask({type:T.SHIFT_ON,plan:{room_1_1:['R']}}),queue=new MowerTaskQueue();queue.tasks=[task]
 retainMowerFailedTask(state,data,task,'failed preview')
 return {state,data,task,queue}
}

describe('native task failures retain work and release dispatch',()=>{
 it('does not resume from clock advancement or predictions and preserves the original deadline',()=>{
  const {state,data,task,queue}=fixture()
  state.time=4;data.nowMicros=toMowerMicros(4)
  data.operators.A!.moodIsPrediction=true;data.operators.A!.mood=0;data.operators.A!.timeStampMicros=data.nowMicros
  expect(resumeMowerFailedTasks(state,data,queue)).toBe(false)
  expect(task.executionFailure).toBeDefined();expect(task.timeMicros).toBe(0)
  prepareMowerRunEntry(queue,data.nowMicros,true)
  expect(queue.tasks).toContain(task)
  expect(task.timeMicros).toBe(0)
 })
 it.each(['measurement','position','effective-plan','product','backup-conditions'])('resumes after a new relevant %s',change=>{
  const {state,data,task,queue}=fixture()
  if(change==='measurement')data.operators.A!.timeStampMicros=1
  if(change==='position')data.operators.A!.currentRoom='dormitory_1'
  if(change==='effective-plan')state.config.mowerSourcePlan!.room_1_1![0]!.replacement=[]
  if(change==='product')state.mowerFacilityProducts={room_1_1:'exp3'}
  if(change==='backup-conditions')data.planConditions=[true]
  expect(resumeMowerFailedTasks(state,data,queue)).toBe(true)
  expect(queue.tasks).toEqual([task]);expect(task.executionFailure).toBeUndefined()
  expect(task.executionRetained).toBe(true);expect(task.timeMicros).toBe(0)
  prepareMowerRunEntry(queue,toMowerMicros(2),true)
  expect(queue.tasks).toContain(task)
  queue.removeDerived();expect(queue.tasks).toContain(task)
 })
 it('ignores unrelated observations and product changes',()=>{
  const {state,data,task,queue}=fixture()
  data.operators.X=new MowerOperatorState({name:'X',currentRoom:'room_2_1',currentIndex:0,mood:3,timeStampMicros:1})
  state.mowerFacilityProducts={room_1_1:'gold',room_2_1:'exp3'}
  expect(resumeMowerFailedTasks(state,data,queue)).toBe(false)
  expect(task.executionFailure).toBeDefined()
 })
 it('excludes suspended failures from dispatch and scheduling without rewriting remaining work',()=>{
  const {task,queue}=fixture(),other=new MowerTask({time:1,type:T.FIAMMETTA}),plan=structuredClone(task.plan)
  queue.tasks.push(other);queue.sort()
  expect(queue.find()).toBe(other)
  scheduleMowerTasks(queue.tasks,toMowerMicros(1),{alpha:true,adjustForRunOrders:false})
  expect(queue.find()).toBe(other)
  expect(queue.tasks).toContain(task);expect(task.plan).toEqual(plan);expect(task.timeMicros).toBe(0)
  queue.removeDerived();expect(queue.tasks).toContain(task)
 })
})

function sharedFailureFixture(){
 const {state,data,task,queue}=fixture()
 data.operators.A!.operatorType='high';data.operators.A!.group='a';data.operators.A!.replacement=['R']
 data.groupShiftState={a:false,b:false}
 data.plan.room_1_3=['F']
 data.operators.F=new MowerOperatorState({name:'F',room:'room_1_3',index:0,currentRoom:'room_1_3',currentIndex:0,group:'a',replacement:['C'],groupBindings:[{group:'a',replacement:['C']},{group:'b',replacement:['D']}],operatorType:'high',mood:10,timeStampMicros:0})
 data.operators.C=new MowerOperatorState({name:'C',currentRoom:'train',currentIndex:0,mood:24,timeStampMicros:0})
 data.operators.D=new MowerOperatorState({name:'D',currentRoom:'train',currentIndex:1,mood:24,timeStampMicros:0})
 task.type=T.SHIFT_OFF
 expect(normalizeMowerSharedArrangement(data,task.plan)).toBe(false)
 expect(task.plan).toEqual({room_1_1:['R']})
 retainMowerFailedTask(state,data,task,'implicit shared replacement busy')
 return {state,data,task,queue}
}

describe('failed task dependencies from implicit shared followers',()=>{
 it('resumes the same original task when another room releases its implicit shared replacement',()=>{
  const {state,data,task,queue}=sharedFailureFixture(),plan=structuredClone(task.plan)
  data.operators.C!.currentRoom='';data.operators.C!.currentIndex=-1;data.operators.C!.timeStampMicros=1
  const feasible=structuredClone(task.plan)
  expect(normalizeMowerSharedArrangement(data,feasible)).toBe(true)
  expect(feasible).toEqual({room_1_1:['R'],room_1_3:['C']})
  expect(resumeMowerFailedTasks(state,data,queue)).toBe(true)
  expect(queue.tasks).toEqual([task]);expect(task.timeMicros).toBe(0);expect(task.plan).toEqual(plan)
  expect(task.executionFailure).toBeUndefined()
 })
 it('resumes after a new actual measurement of the relevant shared replacement',()=>{
  const {state,data,task,queue}=sharedFailureFixture()
  data.operators.C!.timeStampMicros=1;data.operators.C!.mood=20;data.operators.C!.moodIsPrediction=false
  expect(resumeMowerFailedTasks(state,data,queue)).toBe(true)
  expect(task.executionFailure).toBeUndefined()
 })
 it.each(['inactive-binding','unrelated','prediction'])('keeps the failure suspended for %s changes',change=>{
  const {state,data,task,queue}=sharedFailureFixture()
  if(change==='inactive-binding'){data.operators.D!.currentRoom='';data.operators.D!.currentIndex=-1;data.operators.D!.timeStampMicros=1}
  if(change==='unrelated')data.operators.Unrelated=new MowerOperatorState({name:'Unrelated',currentRoom:'room_3_3',currentIndex:0,mood:3,timeStampMicros:1})
  if(change==='prediction'){data.operators.C!.timeStampMicros=1;data.operators.C!.mood=0;data.operators.C!.moodIsPrediction=true}
  expect(resumeMowerFailedTasks(state,data,queue)).toBe(false)
  expect(task.executionFailure).toBeDefined();expect(task.timeMicros).toBe(0)
 })
 it('resumes after the relevant shared binding selects a different replacement',()=>{
  const {state,data,task,queue}=sharedFailureFixture()
  data.operators.E=new MowerOperatorState({name:'E',mood:24,timeStampMicros:0})
  data.operators.F!.groupBindings[0]!.replacement=['E']
  expect(normalizeMowerSharedArrangement(data,structuredClone(task.plan))).toBe(true)
  expect(resumeMowerFailedTasks(state,data,queue)).toBe(true)
  expect(task.executionFailure).toBeUndefined()
 })
})