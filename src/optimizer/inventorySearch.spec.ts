import {describe,it,expect} from 'vitest'
import {createDefaultWorkspace} from '../workbench/defaults'
import {rosterIncomeSearchSteps,type IncomeSearchRequest} from './rosterIncomeSearch'

function request():IncomeSearchRequest{
 return {baseline:createDefaultWorkspace(),inventory:[],objective:'composite',maxCandidates:2,options:{sampleHours:1,warmupHours:0,production:{outputMode:'potential',inventoryMode:'unlimited',collectionIntervalHours:2,initialResources:{gold:12,fragment:4,orirock:8,device:2,lmd:1600,exp:5000,drone:7}}}}
}
function firstBatch(input:IncomeSearchRequest){
 const step=rosterIncomeSearchSteps(input).next()
 if(step.done)throw new Error('Expected search scenarios')
 return step.value.jobs
}

describe('finite inventory shared across income-search scenarios',()=>{
 it.each(['baseline','draft','explicit'] as const)('preserves presets with %s inventory dependence',origin=>{
  const input=request(),trigger="op_data.inventory_count('赤金') < 10"
  if(origin==='explicit')input.options!.production!.inventoryMode='finite'
  else if(origin==='baseline')input.baseline.compatibility.backupPlans=[{trigger}]
  else{input.draft=structuredClone(input.baseline);input.draft.compatibility.backupPlans=[{trigger}]}
  const before=structuredClone(input),jobs=firstBatch(input)
  expect(jobs).toHaveLength(4)
  for(const job of jobs)expect(job.options!.production).toMatchObject({outputMode:'settled',inventoryMode:'finite',collectionIntervalHours:2,initialResources:before.options!.production!.initialResources})
  expect(input).toEqual(before)
 })
 it('normalizes missing finite entries to zero once for both benchmark and candidate jobs',()=>{
  const input=request();input.baseline.compatibility.backupPlans=[{trigger:"op_data.inventory_count('全部经验（计算）') >= 200"}]
  input.options!.production!.initialResources={lmd:1200,drone:3}
  for(const job of firstBatch(input))expect(job.options!.production!.initialResources).toEqual({gold:0,fragment:0,orirock:0,device:0,lmd:1200,exp:0,drone:3})
 })
 it('keeps existing potential behavior when neither plan depends on inventory',()=>{
  const input=request();input.assumptions={initialGold:100,initialFragments:25}
  for(const job of firstBatch(input)){
   expect(job.options!.production).toMatchObject({outputMode:'potential',inventoryMode:'unlimited',collectionIntervalHours:0,initialResources:{drone:7}})
   expect(job.assumptions).toMatchObject({initialGold:0,initialFragments:0})
  }
 })
 it('does not turn a facility-product condition into a finite inventory requirement',()=>{
  const input=request();input.baseline.compatibility.backupPlans=[{trigger:"op_data.facility_product('room_1_1') == gold"}]
  expect(firstBatch(input)[0]!.options!.production!.outputMode).toBe('potential')
 })
 it.each([-1,.5,Number.MAX_SAFE_INTEGER+1])('rejects invalid finite presets before dispatching jobs: %s',gold=>{
  const input=request();input.options!.production!.inventoryMode='finite';input.options!.production!.initialResources!.gold=gold
  expect(()=>firstBatch(input)).toThrow('安全整数')
 })
})
