import {describe,it,expect} from 'vitest'
import {mowerCorrectionPlan} from './mowerCorrection'
import {normalizeMowerSharedArrangement} from './mowerSharedGroups'
import {MowerSchedulingData,MowerDormState} from './mowerSchedulingData'
import {MowerOperatorState} from './mowerOperatorState'
import {alphaPosition} from './mowerAlphaDorm'
import type {MowerTaskPlan} from './mowerTaskQueue'

function fixture(shared=false){
 const plan={room_1_1:['A'],room_1_2:['B'],room_1_3:['F'],dormitory_1:['Free','Free']}
 const operators:Record<string,MowerOperatorState>={}
 for(const [name,room,group,replacement] of [['A','room_1_1','a',['X']],['B','room_1_2','b',['Y']],['F','room_1_3','a',['C','D']]] as [string,string,string,string[]][]){
  operators[name]=new MowerOperatorState({name,room,index:0,currentRoom:room,currentIndex:0,group:shared?group:'',replacement,operatorType:'high',mood:10,timeStampMicros:0})
 }
 if(shared)operators.F!.groupBindings=[{group:'a',replacement:['C','D']},{group:'b',replacement:['D','E']}]
 for(const name of ['X','Y','C','D','E'])operators[name]=new MowerOperatorState({name,mood:24,timeStampMicros:0})
 return new MowerSchedulingData({alpha:true,plan,operators,dorms:[0,1].map(index=>new MowerDormState(['dormitory_1',index])),nowMicros:0})
}
const explicit=(room:string,index=0)=>new Set([alphaPosition(room,index)])

describe('explicit backup slots retain physical ownership in correction',()=>{
 it('retains a physical occupant instead of restoring the static primary',()=>{
  const data=fixture();data.operators.A!.currentRoom='';data.operators.A!.currentIndex=-1
  Object.assign(data.operators.C!,{currentRoom:'room_1_1',currentIndex:0})
  const before=JSON.stringify(data)
  expect(mowerCorrectionPlan(data,false,explicit('room_1_1'))).toEqual({room_1_1:['C']})
  expect(JSON.stringify(data)).toBe(before)
 })
 it('retains an empty explicit position as Free',()=>{
  const data=fixture();data.operators.A!.currentRoom='';data.operators.A!.currentIndex=-1
  expect(mowerCorrectionPlan(data,false,explicit('room_1_1'))).toEqual({room_1_1:['Free']})
 })
 it('preserves the current occupant in an explicit static Free dorm slot',()=>{
  const data=fixture();Object.assign(data.operators.C!,{currentRoom:'dormitory_1',currentIndex:0})
  expect(mowerCorrectionPlan(data,false,explicit('dormitory_1'))).toEqual({dormitory_1:['C','Current']})
 })
 it('preserves an empty static Free position even when skipDorm is enabled',()=>{
  expect(mowerCorrectionPlan(fixture(),true,explicit('dormitory_1'))).toEqual({dormitory_1:['Free','Current']})
 })
 it('removes the same operator from another correction destination',()=>{
  const data=fixture();Object.assign(data.operators.A!,{currentRoom:'dormitory_1',currentIndex:0,mood:24})
  const plan=mowerCorrectionPlan(data,false,explicit('dormitory_1'))
  expect(plan).toEqual({dormitory_1:['A','Current']})
  expect(Object.values(plan).flat().filter(name=>name==='A')).toHaveLength(1)
 })
 it('ignores slots outside the effective plan',()=>{
  const slots=new Set([alphaPosition('absent',0),alphaPosition('room_1_1',-1),alphaPosition('room_1_1',1)])
  expect(mowerCorrectionPlan(fixture(),false,slots)).toEqual({})
 })
 it('leaves the default scheduler correction unchanged',()=>{
  const data=fixture();data.alpha=false;data.operators.A!.currentRoom='';data.operators.A!.currentIndex=-1
  expect(mowerCorrectionPlan(data,false,explicit('room_1_1'))).toEqual(mowerCorrectionPlan(data))
 })
})

describe('explicit shared positions stay outside automatic matching',()=>{
 it.each(['F','C','Free'])('preserves explicit follower assignment %s',name=>{
  const data=fixture(true),plan:MowerTaskPlan={room_1_1:['X'],room_1_3:[name]},before=JSON.stringify(data)
  expect(normalizeMowerSharedArrangement(data,plan,undefined,explicit('room_1_3'))).toBe(true)
  expect(plan).toEqual({room_1_1:['X'],room_1_3:[name]});expect(JSON.stringify(data)).toBe(before)
 })
 it('reserves the explicit follower occupant against other shared followers',()=>{
  const data=fixture(true);data.plan.room_1_3!.push('G')
  data.operators.G=new MowerOperatorState({name:'G',room:'room_1_3',index:1,currentRoom:'room_1_3',currentIndex:1,operatorType:'high',group:'a',replacement:['C','D'],groupBindings:[{group:'a',replacement:['C','D']},{group:'b',replacement:['D','E']}]})
  const plan:MowerTaskPlan={room_1_1:['X'],room_1_3:['C','Current']}
  expect(normalizeMowerSharedArrangement(data,plan,undefined,explicit('room_1_3'))).toBe(true)
  expect(plan.room_1_3).toEqual(['C','D'])
 })
 it('rejects a shared candidate conflict atomically when an explicit slot owns the only cover',()=>{
  const data=fixture(true);data.operators.F!.groupBindings[0]!.replacement=['C']
  const plan:MowerTaskPlan={room_1_1:['X'],room_1_2:['C']},before=structuredClone(plan)
  expect(normalizeMowerSharedArrangement(data,plan,undefined,explicit('room_1_2'))).toBe(false)
  expect(plan).toEqual(before)
 })
 it('still enforces a working primary blocker when the shared follower is explicit',()=>{
  const data=fixture(true);data.operators.A!.replacement=['F'];data.operators.A!.currentRoom='';data.operators.A!.currentIndex=-1
  Object.assign(data.operators.F!,{currentRoom:'room_1_1',currentIndex:0})
  const plan:MowerTaskPlan={room_1_3:['Free']},before=structuredClone(plan)
  expect(normalizeMowerSharedArrangement(data,plan,{b:true},explicit('room_1_3'))).toBe(false)
  expect(plan).toEqual(before)
 })
})
