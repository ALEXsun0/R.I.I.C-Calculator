import {describe,it,expect} from 'vitest'
import {createDefaultWorkspace} from '../workbench/defaults'
import {resolveOperatorCharId as id} from '../domain/operatorIdentifiers'
import {compileRosterSchedule} from './compileRosterSchedule'
import {compiledScheduleToRuntimeConfig} from './scheduleAdapter'
import {createRosterRuntime,advanceRoster,nextRosterActionHours} from './rosterRuntime'
import {createBackupPlanController} from './backupPlans'
import {getMowerSourceRuntime,settleMowerSource} from './mowerSourceRuntime'
import {mergeMowerBackupRefreshRule,inheritMowerBackupRefreshRules} from './mowerBackupRefresh'
import {MowerTask,MowerTaskQueue,MOWER_TASK_TYPES as T,type MowerBackupRefreshRule} from './mowerTaskQueue'
import {executeMowerTaskArrangement,type MowerTaskExecutionHooks} from './mowerTaskExecutor'
import {prepareMowerShiftBackup} from './mowerShiftCycle'
import {mowerRefreshTradingSpec} from './mowerRunOrderRefresh'

const rates={workRate:()=>1,recoveryRate:()=>2}
function fixture(entry:'cached'|'shift',move=true){
 const workspace=createDefaultWorkspace()
 for(const room of Object.values(workspace.mainPlan.facilities))room.slots=[]
 workspace.mainPlan.facilities.central.slots=[{occupant:{kind:'operator',operatorId:'夕'},groupId:null,replacements:['芬']}]
 workspace.mainPlan.facilities.room_1_1.slots=[{occupant:{kind:'operator',operatorId:'阿米娅'},groupId:null,replacements:['但书']}]
 Object.assign(workspace.mainPlan.conf,{refresh_drained:['夕'],refresh_trading:['夕'],exhaust_require:['阿米娅'],workaholic:['夕','芬']})
 workspace.compatibility.backupPlans=[{name:'remove refresh with staff change',trigger:entry==='cached'?'True':"not op_data.operators['夕'].is_working()",plan:move?{central:{plans:[{agent:'芬',group:'',replacement:[]}]}}:{},conf:{removed_operators:{refresh_drained:['夕'],refresh_trading:['夕']}}}]
 const schedule=compileRosterSchedule(workspace,{initialMorale:24}),config=compiledScheduleToRuntimeConfig(schedule)
 config.mowerAlpha=true;config.availableIdleOperators=[]
 const state=createRosterRuntime(config),controller=createBackupPlanController(schedule,state),source=getMowerSourceRuntime(state)
 for(const op of Object.values(source.data.operators)){
  const position=Object.entries(state.occupants).find(([,name])=>name===op.name)?.[0]
  op.currentRoom=position?.slice(0,position.lastIndexOf('_'))??'';op.currentIndex=position?0:-1
  op.mood=24;op.timeStampMicros=0
 }
 source.initial=false;source.firstInit=false
 const exhaust=new MowerTask({time:1,type:T.EXHAUST_OFF,metadata:id('阿米娅')})
 const order=new MowerTask({time:1,type:T.RUN_ORDER,metadata:'room_1_1'})
 source.queue.tasks=[exhaust,order]
 return {state,source,controller,exhaust,order}
}

describe('backup refresh rules follow the physical arrangement',()=>{
 it.each(['cached','shift'] as const)('refreshes on departure after %s activation and clears the old rules on completion',entry=>{
  const {state,source,controller,exhaust,order}=fixture(entry)
  let task:MowerTask
  if(entry==='cached'){
   expect(controller.evaluate('END')).toBe(true)
   task=state.mowerBackupGenerated!.find(task=>Object.keys(task.plan).length)!
   expect(source.queue.tasks).toContain(exhaust);expect(source.queue.tasks).toContain(order)
   expect(state.occupants.central_0).toBe(id('夕'))
  }else{
   task=new MowerTask({time:-1/3_600_000_000,type:T.SELF_CORRECTION,plan:{central:[id('芬')]}})
   source.queue.tasks.unshift(task)
  }
  settleMowerSource(state,rates)
  expect(controller.active).toEqual([true])
  expect(state.occupants.central_0).toBe(id('芬'))
  expect(source.queue.tasks).not.toContain(exhaust);expect(source.queue.tasks).not.toContain(order)
  expect(task.backupRefreshRules?.[id('夕')]).toBeDefined()
  expect(source.data.operators[id('夕')]!.refreshOrderRooms).toEqual([false,[]])
  for(let i=0;i<10&&source.queue.tasks.includes(task);i++){
   advanceRoster(state,Math.max(nextRosterActionHours(state,rates),1/3_600_000_000),rates)
   settleMowerSource(state,rates)
  }
  expect(source.queue.tasks).not.toContain(task)
  expect(task.backupRefreshRules).toBeUndefined()
  const laterExhaust=new MowerTask({time:state.time+1,type:T.EXHAUST_OFF,metadata:id('阿米娅')})
  const laterOrder=new MowerTask({time:state.time+1,type:T.RUN_ORDER,metadata:'room_1_1'})
  const laterMove=new MowerTask({time:state.time-1/3_600_000_000,plan:{central:[id('夕')]}})
  source.queue.tasks=[laterMove,laterExhaust,laterOrder]
  for(let i=0;i<10&&state.occupants.central_0!==id('夕');i++){
   settleMowerSource(state,rates)
   if(state.occupants.central_0!==id('夕'))advanceRoster(state,Math.max(nextRosterActionHours(state,rates),1/3_600_000_000),rates)
  }
  expect(state.occupants.central_0).toBe(id('夕'))
  expect(source.queue.tasks).toContain(laterExhaust);expect(source.queue.tasks).toContain(laterOrder)
 })

 it('does not refresh queued timers for configuration-only activation or a memory preview',()=>{
  const noMove=fixture('cached',false)
  expect(noMove.controller.evaluate('END')).toBe(false)
  expect(noMove.source.queue.tasks).toContain(noMove.exhaust);expect(noMove.source.queue.tasks).toContain(noMove.order)
  expect(noMove.state.mowerBackupGenerated!.every(task=>!task.backupRefreshRules)).toBe(true)
  const preview=fixture('shift'),task=new MowerTask({type:T.SELF_CORRECTION,plan:{central:[id('芬')]}})
  prepareMowerShiftBackup(preview.source.data,task,preview.state.mowerShiftModel!)
  expect(task.backupShiftConditions).toEqual([true])
  expect(task.backupRefreshRules).toBeUndefined()
  expect(preview.controller.active).toEqual([false])
  expect(preview.state.occupants.central_0).toBe(id('夕'))
  expect(preview.source.queue.tasks).toEqual([preview.exhaust,preview.order])
 })

 it('refreshes only the specified trading room during an actual departure after the rule is removed',()=>{
  const {state,source,controller,order}=fixture('cached')
  // Use the native decoded room restriction; this test targets the physical callback.
  source.data.operators[id('夕')]!.refreshOrderRooms=mowerRefreshTradingSpec('夕',['夕room_1_1'])
  const unrelated=new MowerTask({time:1,type:T.RUN_ORDER,metadata:'room_1_2'})
  source.queue.tasks.push(unrelated)
  expect(controller.evaluate('END')).toBe(true)
  const task=state.mowerBackupGenerated!.find(task=>Object.keys(task.plan).length)!
  expect(task.backupRefreshRules?.[id('夕')]?.trading).toEqual([true,['room_1_1']])
  settleMowerSource(state,rates)
  expect(state.occupants.central_0).toBe(id('芬'))
  expect(source.queue.tasks).not.toContain(order)
  expect(source.queue.tasks).toContain(unrelated)
 })

 it('queues near-order refreshes in previous-then-effective room order during the actual move',()=>{
  const {state,source,controller}=fixture('cached')
  source.data.operators[id('夕')]!.refreshOrderRooms=mowerRefreshTradingSpec('夕',['夕room_1_1'])
  source.queue.tasks=['room_1_1','room_1_2'].map((room,index)=>new MowerTask({time:.1*(index+1),type:T.RUN_ORDER,metadata:room}))
  expect(controller.evaluate('END')).toBe(true)
  // Native configuration parsing supplies the effective restricted rule after activation.
  source.data.operators[id('夕')]!.refreshOrderRooms=mowerRefreshTradingSpec('夕',['夕room_1_2'])
  settleMowerSource(state,rates)
  expect(state.occupants.central_0).toBe(id('芬'))
  expect(source.queue.tasks.filter(task=>task.type===T.REFRESH_TIME).map(task=>task.metadata)).toEqual(['room_1_1','room_1_2'])
 })

 it.each([
  [[true,['room_1_1']],[true,['room_1_2']],[true,['room_1_1','room_1_2']]],
  [[false,[]],[true,['room_1_2']],[true,['room_1_2']]],
  [[true,[]],[true,['room_1_2']],[true,[]]],
  [[true,['room_1_1']],[true,[]],[true,[]]],
 ] as [MowerBackupRefreshRule['trading'],MowerBackupRefreshRule['trading'],MowerBackupRefreshRule['trading']][])('unions restricted rooms and only treats enabled empty lists as wildcard', (current,previous,expected)=>{
  expect(mergeMowerBackupRefreshRule({drained:false,trading:current},{drained:true,trading:previous})).toEqual({drained:true,trading:expected})
 })

 it('retains inherited rules across a deferred arrangement and drops them after its last room',()=>{
  const old=new MowerTask(),task=new MowerTask({type:T.SHIFT_OFF,plan:{room_1_1:['R'],dormitory_1:['A']}}),queue=new MowerTaskQueue()
  old.backupRefreshRules={A:{drained:true,trading:[true,['room_1_1']]}}
  task.backupRefreshRules={A:{drained:false,trading:[true,['room_1_2']]}}
  inheritMowerBackupRefreshRules(task,[old]);queue.tasks=[task]
  let deferred=true
  const hooks:MowerTaskExecutionHooks={alpha:true,protectShift:true,backup:()=>({changed:false,generated:[]}),arrangeRoom:()=>{},metadata:()=>{},deferRoom:room=>room.startsWith('dorm')&&deferred}
  expect(executeMowerTaskArrangement(task,queue,hooks)).toBe(false)
  expect(task.backupRefreshRules?.A).toEqual({drained:true,trading:[true,['room_1_1','room_1_2']]})
  expect(old.backupRefreshRules?.A?.trading[1]).toEqual(['room_1_1'])
  deferred=false
  expect(executeMowerTaskArrangement(task,queue,hooks)).toBe(true)
  expect(task.backupRefreshRules).toBeUndefined()
 })
})
