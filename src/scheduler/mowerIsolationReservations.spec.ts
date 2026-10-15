import {describe,it,expect} from 'vitest'
import {createDefaultWorkspace} from '../workbench/defaults'
import {compileRosterSchedule} from './compileRosterSchedule'
import {compiledScheduleToRuntimeConfig} from './scheduleAdapter'
import {createRosterRuntime} from './rosterRuntime'
import {createBackupPlanController} from './backupPlans'
import {getMowerSourceRuntime} from './mowerSourceRuntime'
import {MowerOperatorState} from './mowerOperatorState'
import {MowerSchedulingData,MowerDormState} from './mowerSchedulingData'
import {MowerTask,MowerTaskQueue,MOWER_TASK_TYPES as T} from './mowerTaskQueue'
import {prepareMowerShiftBackup,prepareMowerShiftCycle,type MowerShiftModel} from './mowerShiftCycle'

function fixture(){
 const operators=Object.fromEntries(['A','B','C'].map(name=>[name,new MowerOperatorState({name,mood:10,timeStampMicros:0})]))
 operators.A!.setProjectedPosition('dormitory_1',0);operators.C!.setProjectedPosition('dormitory_2',1)
 const data=new MowerSchedulingData({alpha:true,nowMicros:0,operators,plan:{dormitory_1:['Free','Free'],dormitory_2:['Free','Free'],meeting:['C']},dorms:[new MowerDormState(['dormitory_1',0],'A'),new MowerDormState(['dormitory_1',1]),new MowerDormState(['dormitory_2',0]),new MowerDormState(['dormitory_2',1],'C')],dormIsolation:[['A','B']]})
 const task=new MowerTask({type:T.SHIFT_OFF,plan:{dormitory_1:['Current','B']}});task.productShiftLocked=true
 const queue=new MowerTaskQueue();queue.tasks=[task]
 const model:MowerShiftModel={count:0,evaluate:()=>[],swap:d=>d,transition:()=>({}),activate:()=>{}}
 return {data,task,queue,model}
}
describe('isolation reservations at complete arrangement entry',()=>{
 it('does not borrow a resident reserved for a pending work-room task',()=>{
  const {data,task,queue,model}=fixture()
  queue.tasks.push(new MowerTask({type:T.SELF_CORRECTION,plan:{meeting:['C']}}))
  const original=structuredClone(task.plan),before=JSON.stringify(data)
  prepareMowerShiftCycle(data,task,queue,model)
  expect(task.plan).toEqual(original);expect(JSON.stringify(data)).toBe(before)
 })
 it('keeps a concrete backup entry slot even when isolation could improve',()=>{
  const {data,task,queue,model}=fixture()
  task.backupExplicitSlots=new Set(['dormitory_1\0'+'1'])
  const original=structuredClone(task.plan)
  prepareMowerShiftCycle(data,task,queue,model)
  expect(task.plan).toEqual(original)
 })
})

it('captures only newly activated concrete entry-task slots through both backup paths',()=>{
 const workspace=createDefaultWorkspace()
 workspace.mainPlan.facilities.dormitory_1.slots=Array.from({length:5},()=>({occupant:{kind:'free' as const},groupId:null,replacements:[]}))
 workspace.compatibility.backupPlans=[{trigger:'True',task:{dormitory_1:['Current','Current','芬','Free','Current']}}]
 const schedule=compileRosterSchedule(workspace),config=compiledScheduleToRuntimeConfig(schedule);config.mowerAlpha=true
 const state=createRosterRuntime(config)
 const controller=createBackupPlanController(schedule,state),source=getMowerSourceRuntime(state),model=state.mowerShiftModel!
 expect([...model.explicitSlots!([false],[true])]).toEqual(['dormitory_1\0'+'2','dormitory_1\0'+'3'])
 expect([...model.explicitSlots!([true],[true])]).toEqual([])
 expect([...model.explicitSlots!([true],[false])]).toEqual([])
 source.queue.tasks=[]
 expect(controller.evaluate('END')).toBe(true)
 const generated=state.mowerBackupGenerated!.find(task=>Object.keys(task.plan).length)!
 expect([...generated.backupExplicitSlots]).toEqual(['dormitory_1\0'+'2','dormitory_1\0'+'3'])
 source.data.planConditions=[false]
 const task=new MowerTask({type:T.SHIFT_OFF,plan:{dormitory_1:['Current','Current','Current','Free','Current']}})
 prepareMowerShiftBackup(source.data,task,model)
 expect([...task.backupExplicitSlots]).toEqual(['dormitory_1\0'+'2','dormitory_1\0'+'3'])
})
