import {describe,it,expect} from 'vitest'
import oracle from './fixtures/mower-alpha-resting-boundaries.json'
import {MowerOperatorState} from './mowerOperatorState'
import {MowerSchedulingData,MowerDormState} from './mowerSchedulingData'
import {mowerResting} from './mowerOrdinaryPlanning'
import {MowerTaskQueue} from './mowerTaskQueue'
import {alphaRestingTier,alphaSlotTakable} from './mowerAlphaDorm'
import {mowerUpdateDetail,projectMowerArrangements} from './mowerObservations'
import {planMowerMetadata} from './mowerMetadata'

describe('alpha resting boundaries with permanent standby priority',()=>{
 for(const c of oracle.cases)it(c.kind,()=>{
  const standby=c.kind==='standby'
  const operators={A:new MowerOperatorState({name:'A',room:'room_1_1',index:0,currentRoom:'room_1_1',currentIndex:0,operatorType:'high',mood:4,timeStampMicros:['unknown','estimated'].includes(c.kind)?undefined:0,replacement:['R'],restingPriority:standby?'standby':'high'}),R:new MowerOperatorState({name:'R',mood:10,timeStampMicros:0}),...Object.fromEntries(['K1','K2'].map((name,index)=>[name,new MowerOperatorState({name,room:'dormitory_1',index,currentRoom:'dormitory_1',currentIndex:index,operatorType:'high',mood:24,timeStampMicros:0})]))}
  const data=new MowerSchedulingData({alpha:true,plan:{room_1_1:['A'],dormitory_1:['K1','K2','Free','Free','Free']},operators,dorms:[new MowerDormState(['dormitory_1',2])],nowMicros:0,standbyNames:standby?['A']:[],dormMoodEstimates:c.kind==='estimated'?new Map([['A',[4,0]]]):undefined,reservedProductReplacements:new Set(c.kind==='reserved-primary'?['A']:c.kind==='reserved-cover'?['R']:[])})
  expect(mowerResting(data,new MowerTaskQueue())).toEqual(c.plan)
  expect(data.dorms.map(b=>b.name)).toEqual(c.bedNames)
  // The pinned fixture retains its historical standbyLow=true observation.
  // The simulator intentionally removes that promotion while retaining its plan.
  expect(alphaRestingTier(data,'A')).toBe(standby?4:1)
 })
})

describe('standby priority does not depend on observed morale',()=>{
 function fixture(alpha=true){
  const operators={
   S:new MowerOperatorState({name:'S',room:'room_1_1',index:1,group:'g',replacement:['R'],operatorType:'high',restingPriority:'standby',mood:12,timeStampMicros:0,currentRoom:'dormitory_1',currentIndex:2}),
   R:new MowerOperatorState({name:'R',mood:24,timeStampMicros:0,currentRoom:'room_1_1',currentIndex:1}),
   L:new MowerOperatorState({name:'L',room:'room_1_2',index:0,operatorType:'high',restingPriority:'low',mood:4,timeStampMicros:0}),
   H:new MowerOperatorState({name:'H',room:'room_1_1',index:0,group:'g',operatorType:'high',restingPriority:'high',mood:12,timeStampMicros:0,currentRoom:'dormitory_1',currentIndex:3}),
  }
  const data=new MowerSchedulingData({alpha,operators,plan:{room_1_1:['H','S'],room_1_2:['L'],dormitory_1:['Free','Free','Free','Free','Free']},dorms:[new MowerDormState(['dormitory_1',2],'S',3_600_000_000),new MowerDormState(['dormitory_1',3],'H',3_600_000_000)],nowMicros:0,standbyNames:['S']})
  return {data,operators}
 }
 it.each([4,0])('keeps tier 4 after observing and planning with morale %s',mood=>{
  const {data}=fixture()
  mowerUpdateDetail(data,'S',mood,'dormitory_1',2,true)
  expect(alphaRestingTier(data,'S')).toBe(4)
  mowerResting(data,new MowerTaskQueue())
  expect(alphaRestingTier(data,'S')).toBe(4)
  expect(alphaRestingTier(data,'L')).toBe(2)
  expect(data.dorms[0]!.name).toBe('S')
  expect(alphaSlotTakable(data,data.dorms[0]!,'L')).toBe(true)
 })
 it.each([false,true])('keeps a zero-morale standby idle until its group returns, alpha=%s',alpha=>{
  const {data,operators}=fixture(alpha)
  mowerUpdateDetail(data,'S',0,'',-1,true)
  expect(data.canStandby(operators.S)).toBe(true)
  expect(data.isStandby('S')).toBe(true)
  const queue=new MowerTaskQueue();planMowerMetadata(data,queue)
  const returning=queue.tasks.find(task=>task.type.key==='SHIFT_ON')!
  expect(returning.plan.room_1_1).toEqual(['H','S'])
  const projected=projectMowerArrangements(data,[returning.plan])
  expect(projected.operators.S!.currentRoom).toBe('room_1_1')
  expect(projected.operators.S!.currentIndex).toBe(1)
  expect(projected.isStandby('S')).toBe(false)
 })
 it('keeps manually configured priority above ordinary low priority at zero morale',()=>{
  const {data}=fixture()
  data.restingPriorityNames=['S']
  mowerUpdateDetail(data,'S',0,'dormitory_1',2,true)
  mowerResting(data,new MowerTaskQueue())
  expect(alphaRestingTier(data,'S')).toBe(0)
  expect(alphaSlotTakable(data,data.dorms[0]!,'L')).toBe(false)
 })
})
