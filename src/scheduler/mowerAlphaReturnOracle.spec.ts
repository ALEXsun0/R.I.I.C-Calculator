import {describe,expect,it} from 'vitest'
import oracle from './fixtures/mower-alpha-return-20261014.json'
import {MowerOperatorState,type MowerOperatorOptions} from './mowerOperatorState'
import {MowerSchedulingData,MowerDormState} from './mowerSchedulingData'
import {MowerTaskQueue,toMowerMicros,type MowerTaskPlan} from './mowerTaskQueue'
import {planMowerAlphaMetadata} from './mowerAlphaMetadata'
import {generateMowerDormTasks} from './mowerDormTasks'

interface StateInput {
 plan:MowerTaskPlan
 operators:(MowerOperatorOptions&{predictHours?:number})[]
 beds:{position:[string,number];name:string;hours:number;fixed?:boolean}[]
 groupShiftState:Record<string,boolean>
}
function makeState(spec:StateInput):MowerSchedulingData {
 const bed=(row:StateInput['beds'][number])=>new MowerDormState([...row.position],row.name,toMowerMicros(row.hours))
 return new MowerSchedulingData({alpha:true,nowMicros:0,plan:structuredClone(spec.plan),freeRoom:false,groupRestInFullOnMoodGap:false,
  groupShiftState:spec.groupShiftState,operators:Object.fromEntries(spec.operators.map(({predictHours,...op})=>[op.name,new MowerOperatorState({mood:10,operatorType:'high',restingPriority:'high',timeStampMicros:0,...op,depletionRate:predictHours===undefined?0:(op.mood??10)/(predictHours+.5)})])),
  dorms:spec.beds.filter(row=>!row.fixed).map(bed),groupDorms:spec.beds.filter(row=>row.fixed).map(bed),
 })
}
const describeTasks=(tasks:MowerTaskQueue['tasks'])=>tasks.map(task=>({type:task.type.key,timeMicros:task.timeMicros,plan:task.plan}))

describe('native 3de2b2ac6 metadata anchors and shared group returns',()=>{
 it.each(oracle.metadataCases)('$name',fixture=>{
  const data=makeState(fixture.state as unknown as StateInput),queue=new MowerTaskQueue(),before=JSON.stringify(data)
  planMowerAlphaMetadata(data,queue,[])
  expect(describeTasks(queue.tasks)).toEqual(fixture.expected)
  expect(JSON.stringify(data)).toBe(before)
 })
 it(oracle.sharedReturnCase.name,()=>{
  const fixture=oracle.sharedReturnCase,data=makeState(fixture.state as unknown as StateInput),before=JSON.stringify(data)
  const tasks=generateMowerDormTasks(data.dorms.map(bed=>({timeMicros:bed.timeMicros!,dorms:[bed],restInFull:false})),data)
  expect(describeTasks(tasks)).toEqual(fixture.expected)
  expect(JSON.stringify(data)).toBe(before)
 })
})
