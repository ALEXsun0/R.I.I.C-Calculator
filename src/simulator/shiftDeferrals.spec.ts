import {describe,it,expect} from 'vitest'
import {MORALE_EPSILON,type RuntimeEvent} from '../scheduler/rosterRuntime'
import {isDeferredShiftResolved} from './shiftDeferrals'

const episode={blockedAt:10,operatorIds:['A','B']}
const off=(time:number,operators:string[]):RuntimeEvent=>({time,type:'shift-off',operators})

describe('deferred shift recovery evidence',()=>{
 it('accepts a later combined task that takes the waiting group and another group off duty',()=>{
  expect(isDeferredShiftResolved(episode,[off(11,['C','B','D','A'])])).toBe(true)
 })

 it('preserves recovery from a complete event with reordered members',()=>{
  expect(isDeferredShiftResolved(episode,[off(11,['B','A'])])).toBe(true)
 })

 it('keeps the wait open when one member remains on duty',()=>{
  expect(isDeferredShiftResolved(episode,[off(11,['A','C'])])).toBe(false)
 })

 it('does not combine separate partial shifts into group recovery',()=>{
  expect(isDeferredShiftResolved(episode,[off(11,['A']),off(12,['B'])])).toBe(false)
 })

 it.each<RuntimeEvent['type']>(['shift-on','fiammetta','rest-limit-release','rest-bed-takeover','exhaust-support','backup-plan','backup-task'])('rejects %s as full shift-off evidence',type=>{
  expect(isDeferredShiftResolved(episode,[{time:11,type,operators:['A','B']}])).toBe(false)
 })

 it.each([9,10,10+MORALE_EPSILON/2,10+MORALE_EPSILON])('rejects an old or same-boundary event at %s',time=>{
  expect(isDeferredShiftResolved(episode,[off(time,['A','B'])])).toBe(false)
 })

 it('accepts evidence beyond the morale epsilon boundary',()=>{
  expect(isDeferredShiftResolved(episode,[off(10+MORALE_EPSILON*2,['A','B'])])).toBe(true)
 })

 it('requires an actual event and nonempty waiting membership',()=>{
  expect(isDeferredShiftResolved(episode,[])).toBe(false)
  expect(isDeferredShiftResolved({blockedAt:10,operatorIds:[]},[off(11,[])])).toBe(false)
 })

 it('finds one complete later event without mutating either input',()=>{
  const frozenEpisode=Object.freeze({blockedAt:10,operatorIds:Object.freeze(['A','B'])})
  const events=[off(9,['A','B']),off(11,['A']),off(12,['C','B','A'])]
  const before=JSON.stringify(events)
  expect(isDeferredShiftResolved(frozenEpisode,Object.freeze(events))).toBe(true)
  expect(JSON.stringify(events)).toBe(before)
 })
})
