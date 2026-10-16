import {describe, expect, it} from 'vitest'
import {alphaPosition, alphaSlotTakable} from './mowerAlphaDorm'
import {mowerAssignDormGroup} from './mowerDormAssignment'
import {MowerOperatorState} from './mowerOperatorState'
import {MowerDormState, MowerSchedulingData} from './mowerSchedulingData'

const incoming = ['priority', 'hunter1', 'hunter2', 'hunter3', 'hunter4']

/** Pure decision state: no production, RNG, seed or saved observation replay. */
function fixture(lowTierBedCount = 4) {
  const ownerNames = ['main', ...Array.from({length: 4}, (_, index) => `cover${index + 1}`)]
  const operators: Record<string, MowerOperatorState> = {}
  for (const [index, name] of incoming.entries()) {
    operators[name] = new MowerOperatorState({name, room: 'work', index,
      currentRoom: 'work', currentIndex: index, group: 'hunters', operatorType: 'high',
      restingPriority: index === 0 ? 'high' : 'low', mood: index === 0 ? 15 : 22,
      timeStampMicros: 0, replacement: ownerNames.slice(1)})
  }
  for (const [index, name] of ownerNames.entries()) {
    const isMain = index === 0 || index > lowTierBedCount
    operators[name] = new MowerOperatorState({name, room: isMain ? 'owners' : '',
      index: isMain ? index : -1, currentRoom: 'dormitory_1', currentIndex: index,
      operatorType: isMain ? 'high' : 'low', restingPriority: isMain ? 'high' : 'low',
      mood: 10, timeStampMicros: 0})
  }
  return new MowerSchedulingData({alpha: true, nowMicros: 0,
    plan: {work: [...incoming], owners: [...ownerNames], dormitory_1: ownerNames.map(() => 'Free')},
    operators, dorms: ownerNames.map((name, index) => new MowerDormState(['dormitory_1', index], name, 123)),
    restingPriorityNames: ['priority'], dormOrder: ['dormitory_1'], freeRoom: false})
}

const bedsSnapshot = (data: MowerSchedulingData) => data.dorms.map(bed => ({position: [...bed.position], name: bed.name, timeMicros: bed.timeMicros}))

describe('Mower native ordered group bed admission', () => {
  it('does not move a priority member onto a protected primary bed to admit its group', () => {
    const data = fixture()
    const before=bedsSnapshot(data)
    // Native 617aef protects tiers 0..3, even from a higher-priority requester.
    expect(alphaSlotTakable(data, data.dorms[0]!, 'priority')).toBe(false)
    for (const [index, name] of incoming.slice(1).entries()) {
      expect(alphaSlotTakable(data, data.dorms[index + 1]!, name)).toBe(true)
    }

    const assigned = mowerAssignDormGroup(data, incoming)

    expect(assigned).toBeUndefined()
    expect(bedsSnapshot(data)).toEqual(before)
  })

  it('rejects four low-priority members when only three takable cover beds exist', () => {
    const data = fixture(3)
    const before = bedsSnapshot(data)
    const plan = {work: incoming.map(() => 'Current')}
    const beforePlan = structuredClone(plan)

    expect(mowerAssignDormGroup(data, incoming, undefined, undefined, plan)).toBeUndefined()
    expect(bedsSnapshot(data)).toEqual(before)
    expect(plan).toEqual(beforePlan)
  })

  it('keeps a reserved bed unavailable and leaves every bed unchanged on failure', () => {
    const data = fixture()
    const before = bedsSnapshot(data)
    const reserved = new Set([alphaPosition('dormitory_1', 4)])
    const plan = {work: incoming.map(() => 'Current')}
    const beforePlan = structuredClone(plan)

    expect(mowerAssignDormGroup(data, incoming, undefined, undefined, plan, reserved)).toBeUndefined()
    expect(bedsSnapshot(data)).toEqual(before)
    expect(plan).toEqual(beforePlan)
  })

  it('keeps the existing greedy assignments when they already admit every member', () => {
    const data = fixture()

    const assigned = mowerAssignDormGroup(data, incoming.slice(0, 4))

    expect(assigned?.map(bed => ({name: bed.name, index: bed.position[1]}))).toEqual([
      {name: 'priority', index: 1},
      {name: 'hunter1', index: 2},
      {name: 'hunter2', index: 3},
      {name: 'hunter3', index: 4},
    ])
    expect(data.dorms[0]!.name).toBe('main')
    expect(data.dorms[0]!.timeMicros).toBe(123)
  })

  it('admits all mandatory members before skipping an optional standby member without a bed', () => {
    const data = fixture()
    data.operators.hunter4!.restingPriority = 'standby'

    const assigned = mowerAssignDormGroup(data, incoming)

    expect(assigned).toHaveLength(4)
    expect(new Set(assigned!.map(bed => bed.name))).toEqual(new Set(incoming.slice(0, 4)))
    expect(data.dorms[0]!.name).toBe('main')
    expect(data.dorms[0]!.timeMicros).toBe(123)
  })

  it('preserves native greedy failure when a later empty bed is reserved for the first member',()=>{
    const operators={
      A:new MowerOperatorState({name:'A',room:'work',index:0,currentRoom:'work',currentIndex:0,operatorType:'high',restingPriority:'high',mood:8,timeStampMicros:0}),
      B:new MowerOperatorState({name:'B',room:'work',index:1,currentRoom:'work',currentIndex:1,operatorType:'high',restingPriority:'low',mood:10,timeStampMicros:0}),
    }
    const data=new MowerSchedulingData({alpha:true,nowMicros:0,operators,plan:{work:['A','B'],dormitory_1:['Free','Free']},
      dorms:[new MowerDormState(['dormitory_1',0]),new MowerDormState(['dormitory_1',1])],
      restingPriorityNames:['A'],reservedProductBeds:new Map([[alphaPosition('dormitory_1',1),'A']])})
    const before=bedsSnapshot(data),plan={work:['Current','Current']}
    expect(mowerAssignDormGroup(data,['A','B'],undefined,undefined,plan)).toBeUndefined()
    expect(bedsSnapshot(data)).toEqual(before)
    expect(plan).toEqual({work:['Current','Current']})
  })
})
