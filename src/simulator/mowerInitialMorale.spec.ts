import {describe, expect, it} from 'vitest'
import {createDefaultWorkspace} from '../workbench/defaults'
import {resolveOperatorCharId as id} from '../domain/operatorIdentifiers'
import {compileRosterSchedule} from '../scheduler/compileRosterSchedule'
import {compiledScheduleToRuntimeConfig} from '../scheduler/scheduleAdapter'
import {advanceRoster, createRosterRuntime, nextRosterActionHours, settleRoster} from '../scheduler/rosterRuntime'
import {createBackupPlanController} from '../scheduler/backupPlans'
import {getMowerSourceRuntime} from '../scheduler/mowerSourceRuntime'
import {MowerTask, MOWER_TASK_TYPES as T} from '../scheduler/mowerTaskQueue'
import {simulateSchedule} from './scheduleSimulation'

const slot=(name:string,replacements:string[]=[])=>({occupant:{kind:'operator' as const,operatorId:name},groupId:null,replacements})
function workspace(){
 const ws=createDefaultWorkspace()
 for(const room of Object.values(ws.mainPlan.facilities))room.slots=[]
 return ws
}
function initial(schedule:ReturnType<typeof compileRosterSchedule>){
 const report=simulateSchedule(schedule,{schedulingModel:'mower-alpha',sampleHours:.001})
 expect(report.success,JSON.stringify(report.diagnostics)).toBe(true)
 return Object.fromEntries(report.operators.map(op=>[op.operatorName,op.initialMorale]))
}

describe('alpha default initial morale follows effective personal upper limits',()=>{
 it.each([[1,12,24],[2,24,12],[0,24,24],[3,24,24]] as const)('initializes Ling/Xi mode %s', (mode,ling,xi)=>{
  const ws=workspace();ws.mainPlan.conf.ling_xi=mode
  ws.mainPlan.facilities.central.slots=[slot('令'),slot('夕'),slot('砾')]
  expect(initial(compileRosterSchedule(ws))).toMatchObject({'令':ling,'夕':xi,'砾':24})
 })
 it('starts Totter at 12 with Vermeil in the same factory, and 24 without her',()=>{
  const ws=workspace();ws.mainPlan.facilities.room_1_1.slots=[slot('铅踝'),slot('红云')]
  expect(initial(compileRosterSchedule(ws))).toMatchObject({'铅踝':12,'红云':24})
  ws.mainPlan.facilities.room_1_1.slots=[slot('铅踝')]
  expect(initial(compileRosterSchedule(ws))).toMatchObject({'铅踝':24})
 })
 it('uses global and personal limits for primaries, ordered replacements and standby primaries',()=>{
  const ws=workspace()
  ws.mainPlan.facilities.room_1_1.slots=[slot('砾',['斑点','芬']),slot('香草')]
  Object.assign(ws.mainPlan.conf,{mood_limits:{lower:0,upper:20},operator_mood_limits:{'斑点':{upper:17},'香草':{upper:18}},resting_standby:['香草']})
  expect(initial(compileRosterSchedule(ws))).toMatchObject({'砾':20,'斑点':17,'芬':20,'香草':18})
 })
 it.each([0,24])('preserves explicit global initial morale %s above or below a personal limit',initialMorale=>{
  const ws=workspace();ws.mainPlan.facilities.central.slots=[slot('令')]
  expect(initial(compileRosterSchedule(ws,{initialMorale}))).toMatchObject({'令':initialMorale})
 })
 it.each([undefined,7])('preserves explicit per-operator zero and 24 with global initial %s',initialMorale=>{
  const ws=workspace();ws.mainPlan.facilities.central.slots=[slot('令'),slot('夕'),slot('砾')]
  const assumptions={...(initialMorale===undefined?{}:{initialMorale}),operatorMorale:{[id('令')]:24,[id('夕')]:0}}
  expect(initial(compileRosterSchedule(ws,assumptions))).toMatchObject({'令':24,'夕':0,'砾':initialMorale??24})
 })
 it('preserves accrued morale when a later backup lowers and restores an existing upper limit',()=>{
  const ws=workspace();ws.mainPlan.facilities.room_1_1.slots=[slot('砾',['斑点'])]
  Object.assign(ws.mainPlan.conf,{mood_limits:{upper:20}})
  ws.compatibility.backupPlans=[{trigger:'False',conf:{operator_mood_limits:{'砾':{upper:12}}}}]
  const schedule=compileRosterSchedule(ws),config=compiledScheduleToRuntimeConfig(schedule);config.mowerAlpha=true
  const state=createRosterRuntime(config);createBackupPlanController(schedule,state)
  getMowerSourceRuntime(state);expect(state.morale[id('砾')]).toBe(20);state.morale[id('砾')]=15
  state.mowerShiftModel!.activate([true])
  expect(getMowerSourceRuntime(state).data.operators[id('砾')]!.upperLimit).toBe(12)
  expect(state.morale[id('砾')]).toBe(15)
  state.mowerShiftModel!.activate([false])
  expect(getMowerSourceRuntime(state).data.operators[id('砾')]!.upperLimit).toBe(20)
  expect(state.morale[id('砾')]).toBe(15)
 })
 it('initializes an operator first introduced by a backup from that backup personal limit',()=>{
  const ws=workspace();ws.mainPlan.facilities.room_1_1.slots=[slot('砾')]
  ws.compatibility.backupPlans=[{trigger:'True',plan:{room_1_1:{plans:[{agent:'芬',replacement:[],group:''}]}},conf:{operator_mood_limits:{'芬':{upper:16}}}}]
  expect(initial(compileRosterSchedule(ws))).toMatchObject({'砾':24,'芬':16})
 })
 it('preserves morale already observed by a Free selection when a backup later assigns that operator',()=>{
  const ws=workspace();ws.mainPlan.facilities.room_1_1.slots=[slot('砾')];ws.mainPlan.conf.workaholic=['砾']
  ws.mainPlan.facilities.dormitory_1.slots=[{occupant:{kind:'free'},groupId:null,replacements:[]}]
  ws.compatibility.backupPlans=[{trigger:'False',plan:{room_1_1:{plans:[{agent:'芬',replacement:[],group:''}]}},conf:{operator_mood_limits:{'芬':{upper:16}}}}]
  const schedule=compileRosterSchedule(ws),config=compiledScheduleToRuntimeConfig(schedule);config.mowerAlpha=true;config.availableIdleOperators=[id('芬')]
  const state=createRosterRuntime(config);createBackupPlanController(schedule,state)
  const source=getMowerSourceRuntime(state);source.initial=false;state.morale[id('芬')]=7
  expect(source.data.operators[id('芬')]).toBeUndefined()
  const task=new MowerTask({type:T.SELF_CORRECTION,plan:{dormitory_1:['Free']}})
  source.queue.tasks=[task]
  const rates={workRate:()=>1,recoveryRate:()=>2}
  for(let step=0;step<30&&source.queue.tasks.includes(task);step++){
   settleRoster(state,rates)
   if(source.queue.tasks.includes(task))advanceRoster(state,nextRosterActionHours(state,rates),rates)
  }
  expect(source.error).toBeFalsy()
  expect(source.queue.tasks).not.toContain(task)
  expect(source.data.operators[id('芬')]).toBeDefined()
  expect(state.bedOccupants.dormitory_1_0).toBe(id('芬'))
  const observed=state.morale[id('芬')]
  expect(observed).toBeLessThan(16)
  state.mowerShiftModel!.activate([true])
  expect(getMowerSourceRuntime(state).data.operators[id('芬')]!.upperLimit).toBe(16)
  expect(state.morale[id('芬')]).toBe(observed)
 })
})
