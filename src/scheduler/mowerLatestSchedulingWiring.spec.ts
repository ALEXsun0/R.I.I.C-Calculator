import {describe,it,expect} from 'vitest'
import {createDefaultWorkspace} from '../workbench/defaults'
import {compileRosterSchedule} from './compileRosterSchedule'
import {compiledScheduleToRuntimeConfig} from './scheduleAdapter'
import {createRosterRuntime} from './rosterRuntime'
import {createBackupPlanController} from './backupPlans'
import {mowerRunOrderContext} from './mowerSourceRuntime'
import {runDefaultTradeSegment} from './mowerRunOrderPlanning'
import {MowerTask,MOWER_TASK_TYPES as T,toMowerMicros} from './mowerTaskQueue'
import type {MowerTaskSchedulingOptions} from './mowerTaskScheduling'

const timing:MowerTaskSchedulingOptions={
 firstDailyResetMicros:toMowerMicros(1),maintenance:[toMowerMicros(2),toMowerMicros(2.25)],
 maintenanceEndMicros:toMowerMicros(3),runOrderDelayMinutes:5,executionMinutes:1,
}
function fixture(options:MowerTaskSchedulingOptions={}){
 const state=createRosterRuntime({positions:[],beds:[],mowerAlpha:true,mowerSourcePlan:{room_1_1:[]},mowerSourceRules:{workaholic:[],exhaustRequire:[],restInFull:[],lowPriority:[],refreshDrained:[],lingMode:0},mowerPolicy:{restingThreshold:.65,powerPlantCount:2,opeRestingPriority:[]},mowerTaskScheduling:options})
 const [planning,seam]=mowerRunOrderContext(state)
 planning.runOrderRooms=['room_1_1']
 return {state,planning,seam}
}
function execute(options:MowerTaskSchedulingOptions,orderHours:number,swapHours?:number){
 const context=fixture(options),order=new MowerTask({time:orderHours,type:T.RUN_ORDER,metadata:'room_1_1'})
 context.planning.queue.tasks=[order]
 const swap=swapHours===undefined?undefined:new MowerTask({time:swapHours,type:T.SWAP_SUPPORT})
 if(swap)context.planning.queue.tasks.push(swap)
 expect(runDefaultTradeSegment(context.planning,context.seam).next()).toEqual({done:true,value:{tailShouldRun:true}})
 return {order,swap}
}

describe('latest alpha scheduling through runtime boundaries',()=>{
 it('takes alpha from the active model and forwards explicit timing options',()=>{
  const {seam}=fixture({...timing,alpha:false,adjustForRunOrders:false})
  expect(seam.scheduling).toEqual({...timing,alpha:true,adjustForRunOrders:false})
 })
 it('advances an observed run order through the explicit daily reset phase',()=>{
  const {order}=execute({firstDailyResetMicros:toMowerMicros(1)},1)
  expect(order.timeMicros).toBe(toMowerMicros(50/60)-1_000_000)
  expect(order.adjusted).toBe(true)
 })
 it('advances a support swap inside the full maintenance end after the order update window',()=>{
  const {swap}=execute({maintenance:timing.maintenance,maintenanceEndMicros:timing.maintenanceEndMicros,executionMinutes:1},4,2.5)
  expect(swap!.timeMicros).toBe(toMowerMicros(109/60)-1_000_000)
  expect(swap!.advanceSupportSwap).toBe(true)
 })
 it('does not invent a daily phase or full announcement end when absent',()=>{
  expect(execute({},1).order.timeMicros).toBe(toMowerMicros(1))
  const {swap}=execute({maintenance:timing.maintenance},4,2.5)
  expect(swap!.timeMicros).toBe(toMowerMicros(2.5));expect(swap!.advanceSupportSwap).toBe(false)
 })
 it('retains ideal-order exclusion while still scheduling maintenance support swaps',()=>{
  const {order,swap}=execute({...timing,adjustForRunOrders:false},1,2.5)
  expect(order.timeMicros).toBe(toMowerMicros(1))
  expect(swap!.timeMicros).toBe(toMowerMicros(109/60)-1_000_000)
 })
 it('retains explicit timing and ideal-order settings after an alpha backup recompile',()=>{
  const workspace=createDefaultWorkspace()
  workspace.mainPlan.facilities.room_1_1.slots=[{occupant:{kind:'operator',operatorId:'char_123_fang'},groupId:null,replacements:['char_502_nblade']}]
  workspace.compatibility.backupPlans=[{trigger:'True',plan:{room_1_1:{plans:[{agent:'香草',group:'',replacement:['芬']}]}}}]
  const compiled=compileRosterSchedule(workspace),config=compiledScheduleToRuntimeConfig(compiled)
  config.mowerAlpha=true;config.mowerTaskScheduling={...config.mowerTaskScheduling,...timing,adjustForRunOrders:false}
  const state=createRosterRuntime(config),controller=createBackupPlanController(compiled,state)
  expect(controller.evaluate('END')).toBe(true)
  const retained={firstDailyResetMicros:timing.firstDailyResetMicros,maintenance:timing.maintenance,maintenanceEndMicros:timing.maintenanceEndMicros,adjustForRunOrders:false}
  expect(state.config.mowerTaskScheduling).toMatchObject(retained)
  expect(mowerRunOrderContext(state)[1].scheduling).toMatchObject({...retained,alpha:true})
 })
})
