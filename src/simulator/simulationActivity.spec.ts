import {describe, expect, it} from 'vitest'
import {createRosterRuntime, type RuntimeEvent} from '../scheduler/rosterRuntime'
import {getMowerSourceRuntime} from '../scheduler/mowerSourceRuntime'
import {MowerTask, MOWER_TASK_TYPES as T} from '../scheduler/mowerTaskQueue'
import {resolveOperatorCharId as id} from '../domain/operatorIdentifiers'
import {createSimulationActivityMonitor} from './simulationActivity'

const event=(operators:string[],type:RuntimeEvent['type']='shift-on'):RuntimeEvent=>({time:0,type,operators})
const state=()=>createRosterRuntime({positions:[],beds:[],initialMorale:{}})
function nativeState(){
 const s=createRosterRuntime({positions:[{id:'room_1_1_0',roomId:'room_1_1',primary:'A',candidates:[],group:'main'}],beds:[],initialMorale:{A:9},
  mowerSourcePlan:{room_1_1:[{agent:'A',group:'main',replacement:[],groupBindings:[{group:'shared',replacement:[]}]}]},
  mowerSourceRules:{workaholic:[],exhaustRequire:[],restInFull:[],lowPriority:[],refreshDrained:[],lingMode:0},
  mowerPolicy:{restingThreshold:.65,powerPlantCount:2,opeRestingPriority:[]}})
 const source=getMowerSourceRuntime(s);source.queue.tasks=[]
 return {s,source}
}

describe('read-only wall-clock simulation activity',()=>{
 it('captures once per second and leaves the last observation available between captures',()=>{
  let wall=0;const monitor=createSimulationActivityMonitor(()=>wall),s=state()
  const first=monitor.capture(s,0)
  wall=999;s.time=1
  expect(monitor.capture(s,1)).toBeUndefined();expect(monitor.latest).toBe(first)
  wall=1000;expect(monitor.capture(s,2)?.capturedHours).toBe(1)
 })
 it('does not label a short pause slow before the full 15-second boundary',()=>{
  let wall=0;const monitor=createSimulationActivityMonitor(()=>wall),s=state()
  monitor.capture(s,0);wall=14000
  expect(monitor.capture(s,10)?.status).toBe('running')
  wall=14999;expect(monitor.capture(s,11)).toBeUndefined()
  wall=15000
  expect(monitor.capture(s,11)).toMatchObject({status:'slow',windowSeconds:15,advancedHours:0,iterations:11})
 })
 it.each([.25,1,72])('keeps normal advancement, including a long simulated recovery of %s hours, running',hours=>{
  let wall=0;const monitor=createSimulationActivityMonitor(()=>wall),s=state()
  monitor.capture(s,0);wall=15000;s.time=hours
  expect(monitor.capture(s,10)).toMatchObject({status:'running',advancedHours:hours})
 })
 it('detects slowdown in the current window and clears it when simulation advances again',()=>{
  let wall=0;const monitor=createSimulationActivityMonitor(()=>wall),s=state()
  monitor.capture(s,0)
  for(let second=1;second<=15;second++){wall=second*1000;s.time=second;monitor.capture(s,second)}
  expect(monitor.latest?.status).toBe('running')
  for(let second=16;second<=30;second++){wall=second*1000;monitor.capture(s,second)}
  expect(monitor.latest).toMatchObject({status:'slow',windowSeconds:15,advancedHours:0,iterations:15})
  wall=31000;s.time+=1
  expect(monitor.capture(s,31)).toMatchObject({status:'running',windowSeconds:15,advancedHours:1})
 })
 it('bounds event processing to 256 and displays at most five operators and event kinds',()=>{
  const s=state(),monitor=createSimulationActivityMonitor(()=>0)
  s.events=Array.from({length:300},(_,index)=>event(index<44?['expired']:[`person-${index%8}`,`person-${index%8}`]))
  const activity=monitor.capture(s,300)!
  expect(activity.recentEvents).toEqual([{label:'上班',count:256}])
  expect(activity.operators).toHaveLength(5)
  expect(activity.operators.every(op=>op.id!=='expired'&&op.eventCount===32)).toBe(true)
  const types:RuntimeEvent['type'][]=['shift-off','shift-on','fiammetta','backup-plan','backup-task','rest-limit-release','rest-bed-takeover','exhaust-support']
  const diverse=state();diverse.events=types.map(type=>event([],type))
  expect(createSimulationActivityMonitor(()=>0).capture(diverse,8)!.recentEvents).toHaveLength(5)
 })
 it('expires old observations and does not recount the same runtime events',()=>{
  let wall=0;const monitor=createSimulationActivityMonitor(()=>wall),s=state()
  s.events=[event(['A'])];monitor.capture(s,1)
  wall=1000;expect(monitor.capture(s,2)?.operators[0]?.eventCount).toBe(1)
  wall=15000;expect(monitor.capture(s,3)?.operators).toHaveLength(1)
  wall=16000
  expect(monitor.capture(s,4)).toMatchObject({operators:[],recentEvents:[]})
  s.events.push(event(['B']));wall=17000
  expect(monitor.capture(s,5)?.operators.map(op=>op.id)).toEqual(['B'])
 })
 it('ranks the five most frequently involved operators before task-only candidates',()=>{
  const {s,source}=nativeState()
  s.events=['B','C','D','E','F','G'].flatMap((name,index)=>Array.from({length:index+1},()=>event([name])))
  source.queue.tasks=[new MowerTask({plan:{room_1_1:['A']}})]
  expect(createSimulationActivityMonitor(()=>0).capture(s,21)?.operators.map(op=>[op.id,op.eventCount])).toEqual([['G',6],['F',5],['E',4],['D',3],['C',2]])
 })
 it('reports catalog and fallback names without requiring a native scheduler',()=>{
  const s=createRosterRuntime({positions:[{id:'room_1_1_0',roomId:'room_1_1',primary:id('令'),candidates:[],group:'感知',upperLimit:12}],beds:[],initialMorale:{[id('令')]:8,unknown:6}})
  s.morale.unknown=6;s.events=[event([id('令'),'unknown'])]
  expect(createSimulationActivityMonitor(()=>0).capture(s,1)?.operators).toEqual([
   {id:id('令'),name:'令',morale:8,upperLimit:12,groups:['感知'],room:'room_1_1',eventCount:1},
   {id:'unknown',name:'unknown',morale:6,upperLimit:24,groups:[],room:'',eventCount:1},
  ])
 })
 it('uses native names, physical rooms and shared groups while distinguishing queued from active work',()=>{
  const {s,source}=nativeState(),op=source.data.operators.A!
  op.nativeName='原生甲';op.currentRoom='dormitory_2';op.upperLimit=12
  source.queue.tasks=[new MowerTask({time:20,type:T.RUN_ORDER,plan:{room_2_1:['A']}}),new MowerTask({time:10,type:T.SHIFT_ON,plan:{room_1_1:['A']}})]
  let wall=0;const monitor=createSimulationActivityMonitor(()=>wall),queued=monitor.capture(s,0)!
  expect(queued.task).toMatchObject({label:'上班',dueHours:10,source:'queued'})
  expect(queued.operators[0]).toMatchObject({id:'A',name:'原生甲',morale:9,upperLimit:12,groups:['main','shared'],room:'dormitory_2',eventCount:0})
  source.activeTask=new MowerTask({time:30,type:T.SHIFT_OFF,metadata:'A',plan:{dormitory_2:['Free']}})
  wall=1000;expect(monitor.capture(s,1)?.task).toMatchObject({label:'下班',dueHours:30,source:'active'})
  expect(source.queue.tasks.map(task=>task.time)).toEqual([20,10])
  delete source.activeTask
  source.execution={task:new MowerTask({time:40,type:T.FIAMMETTA}),steps:(function*(){return true})(),wakeMicros:0,intent:{},data:source.data}
  wall=2000;expect(monitor.capture(s,2)?.task).toMatchObject({label:'菲亚充能',dueHours:40,source:'active'})
 })
 it('leaves unattributed operator lists empty even when progress is slow',()=>{
  let wall=0;const {s,source}=nativeState(),monitor=createSimulationActivityMonitor(()=>wall)
  source.queue.tasks=[new MowerTask({type:T.SELF_CORRECTION,plan:{dormitory_1:['Current','Free']},metadata:'副表内存收敛'})]
  monitor.capture(s,0);wall=15000
  expect(monitor.capture(s,100)).toMatchObject({status:'slow',operators:[],recentEvents:[],task:{source:'queued'}})
 })
 it('does not mutate runtime state, the native queue, morale, events or operator records',()=>{
  const {s,source}=nativeState();s.events=[event(['A'])]
  source.queue.tasks=[new MowerTask({time:4,plan:{room_1_1:['A']}})]
  const before=JSON.stringify(s),queue=source.queue.tasks,operator=source.data.operators.A
  let wall=0;const monitor=createSimulationActivityMonitor(()=>wall);monitor.capture(s,100);wall=15000;monitor.capture(s,101)
  expect(JSON.stringify(s)).toBe(before);expect(source.queue.tasks).toBe(queue);expect(source.data.operators.A).toBe(operator)
 })
})
