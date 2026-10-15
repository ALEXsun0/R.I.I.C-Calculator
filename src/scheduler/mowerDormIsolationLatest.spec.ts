import { describe, expect, it } from 'vitest'
import { alphaFindDormSlot, alphaPosition } from './mowerAlphaDorm'
import { planMowerDormIsolation } from './mowerDormIsolation'
import { projectMowerArrangements } from './mowerObservations'
import { MowerOperatorState } from './mowerOperatorState'
import { MowerDormState, MowerSchedulingData } from './mowerSchedulingData'
import type { MowerTaskPlan } from './mowerTaskQueue'

// Synthetic equivalents of 3de2b2ac6f1aeff6513b63faaeea4b2369cf8856
// dorm_isolation_tests.py: ordinary residency, reservations, recovery rank and assign_dorm.
function fixture() {
  const operators: Record<string, MowerOperatorState> = {}
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) operators[name] = new MowerOperatorState({ name, mood: 10, timeStampMicros: 0 })
  const plan: MowerTaskPlan = {}
  for (const room of ['dormitory_1', 'dormitory_2']) {
    plan[room] = [`${room}_manager0`, `${room}_manager1`, 'Free', 'Free', 'Free']
    for (let index = 0; index < 2; index++) {
      const name = plan[room]![index]!
      operators[name] = new MowerOperatorState({ name, room, index, currentRoom: room, currentIndex: index, operatorType: 'high', mood: 10, timeStampMicros: 0 })
    }
  }
  return new MowerSchedulingData({ alpha: true, freeRoom: true, nowMicros: 0, operators, plan, dormIsolation: [['A', 'B']],
    dorms: Object.keys(plan).flatMap(room => [2, 3, 4].map(index => new MowerDormState([room, index]))),
  })
}
function put(data: MowerSchedulingData, name: string, room: string, index: number) {
  data.operators[name]!.setProjectedPosition(room, index)
  data.dorms.find(bed => bed.position[0] === room && bed.position[1] === index)!.name = name
}
function reserveOther(data: MowerSchedulingData, allowed: [string, number][]) {
  const available = new Set(allowed.map(position => alphaPosition(...position)))
  return new Set(data.dorms.map(bed => alphaPosition(...bed.position)).filter(position => !available.has(position)))
}

describe('latest alpha isolation before physical admission', () => {
  it.each(['default', 'explicit-low'])('allows cross-tier exchange with an ordinary resident under %s order', order => {
    const data = fixture()
    if (order === 'explicit-low') data.dormOrder = ['dormitory_1', 'dormitory_1_low', 'dormitory_2']
    data.restingPriorityNames = ['B']
    put(data, 'A', 'dormitory_1', 2)
    put(data, 'C', 'dormitory_2', 3)
    const plan = { dormitory_1: ['Current', 'Current', 'Current', 'B', 'Current'] }
    const reserved = reserveOther(data, [['dormitory_1', 3], ['dormitory_2', 3]])
    const before = JSON.stringify(data), original = structuredClone(plan)
    const result = planMowerDormIsolation(data, plan, reserved)
    expect(result.dormitory_1![3]).toBe('C')
    expect(result.dormitory_2![3]).toBe('B')
    expect(result.dormitory_1!.slice(0, 3)).toEqual(['Current', 'Current', 'Current'])
    expect(JSON.stringify(data)).toBe(before)
    expect(plan).toEqual(original)
    expect(planMowerDormIsolation(data, result, reserved)).toEqual(result)
    expect(planMowerDormIsolation(projectMowerArrangements(data, [result]), result, reserved)).toEqual(result)
  })

  it.each(['slot', 'name', 'product', 'excluded', 'retention', 'future'])('protects %s reservations or existing resident retention', guard => {
    const data = fixture()
    put(data, 'A', 'dormitory_1', 2)
    put(data, 'C', 'dormitory_2', 3)
    data.restingPriorityNames = ['B']
    const plan = { dormitory_1: ['Current', 'Current', 'Current', 'B', 'Current'] }
    const reserved = reserveOther(data, [['dormitory_1', 3], ['dormitory_2', 3]]), names = new Set<string>()
    if (guard === 'slot') reserved.add(alphaPosition('dormitory_2', 3))
    if (guard === 'name') names.add('C')
    if (guard === 'product') data.reservedProductBeds.set(alphaPosition('dormitory_2', 3), 'C')
    if (guard === 'excluded') data.freeBlacklist = ['C']
    if (guard === 'retention') data.freeRoomExclusions = ['C']
    if (guard === 'future') data.operators.C!.setProjectedPosition('', -1)
    const before = JSON.stringify(data)
    expect(planMowerDormIsolation(data, plan, reserved, names)).toEqual(plan)
    expect(JSON.stringify(data)).toBe(before)
  })

  it('keeps an established first recovery resident and fixed managers in place', () => {
    const data = fixture()
    put(data, 'A', 'dormitory_1', 2)
    put(data, 'C', 'dormitory_2', 2)
    const plan = { dormitory_1: ['Current', 'Current', 'Current', 'B', 'Current'] }
    const result = planMowerDormIsolation(data, plan)
    const projected = projectMowerArrangements(data, [result])
    expect(projected.operators.A!.currentRoom).toBe('dormitory_1')
    expect(projected.operators.A!.currentIndex).toBe(2)
    expect(projected.operators.C!.currentRoom).toBe('dormitory_2')
    expect(projected.operators.C!.currentIndex).toBe(2)
    expect(projected.operators.B!.currentRoom).toBe('dormitory_2')
    for (const room of Object.keys(data.plan)) for (let index = 0; index < 2; index++) {
      const name = data.plan[room]![index]!
      expect(projected.operators[name]!.currentRoom).toBe(room)
      expect(projected.operators[name]!.currentIndex).toBe(index)
    }
  })

  it('first moves an ordinary resident so a new first recovery target can stay', () => {
    const data = fixture()
    put(data, 'A', 'dormitory_1', 3)
    const result = planMowerDormIsolation(data, { dormitory_1: ['Current', 'Current', 'B', 'Current', 'Current'] })
    const projected = projectMowerArrangements(data, [result])
    expect(projected.operators.B!.currentRoom).toBe('dormitory_1')
    expect(projected.operators.B!.currentIndex).toBe(2)
    expect(projected.operators.A!.currentRoom).toBe('dormitory_2')
  })

  it('allows a new first target to yield to isolate from a fixed manager, then promotes a higher tier into that target', () => {
    const data = fixture()
    data.dormIsolation = [['A', 'dormitory_1_manager0']]
    data.restingPriorityNames = ['A']
    data.operators.C!.operatorType = 'high'
    data.operators.C!.restingPriority = 'high'
    put(data, 'B', 'dormitory_2', 3)
    const plan = { dormitory_1: ['Current', 'Current', 'A', 'C', 'Current'] }
    const reserved = reserveOther(data, [['dormitory_1', 2], ['dormitory_1', 3], ['dormitory_2', 3]])
    const result = planMowerDormIsolation(data, plan, reserved)
    expect(result.dormitory_1).toEqual(['Current', 'Current', 'C', 'B', 'Current'])
    expect(result.dormitory_2![3]).toBe('A')
    expect(planMowerDormIsolation(data, result, reserved)).toEqual(result)
  })

  it('does not initiate movement solely to isolate existing residents', () => {
    const data = fixture()
    put(data, 'A', 'dormitory_1', 2)
    put(data, 'B', 'dormitory_1', 3)
    const plan = { dormitory_1: ['Current', 'Current', 'Current', 'B', 'Current'] }
    expect(planMowerDormIsolation(data, plan)).toEqual(plan)
  })

  it('does not count a work-room assignment as a new dorm admission', () => {
    const data = fixture()
    data.plan.room_1_1 = ['C']
    put(data, 'A', 'dormitory_1', 2)
    put(data, 'B', 'dormitory_1', 3)
    const plan = { room_1_1: ['C'], dormitory_1: ['Current', 'Current', 'Current', 'B', 'Current'] }
    expect(planMowerDormIsolation(data, plan)).toEqual(plan)
  })

  it('does not move equal-speed ordinary residents solely because their same-tier morale differs', () => {
    const data = fixture()
    put(data, 'D', 'dormitory_2', 3)
    data.operators.C!.mood = 1
    data.operators.D!.mood = 23
    const plan = { dormitory_1: ['Current', 'Current', 'Current', 'C', 'Current'] }
    const reserved = reserveOther(data, [['dormitory_1', 3], ['dormitory_2', 3]])
    expect(planMowerDormIsolation(data, plan, reserved)).toEqual(plan)
  })
})

describe('latest alpha assign_dorm ordering', () => {
  it('applies isolation even when the ordinary bed appears earlier in an explicit low order', () => {
    const data = fixture()
    data.dormOrder = ['dormitory_1', 'dormitory_1_low', 'dormitory_2']
    put(data, 'A', 'dormitory_1', 2)
    expect(data.dorms[alphaFindDormSlot(data, 'B', new Set())!]!.position[0]).toBe('dormitory_2')
  })

  it('compares isolation before recovery deficit when taking over the same resident tier', () => {
    const data = fixture()
    put(data, 'A', 'dormitory_1', 2)
    put(data, 'C', 'dormitory_1', 3)
    put(data, 'D', 'dormitory_2', 3)
    data.operators.C!.mood = 20
    data.operators.D!.mood = 5
    data.restingPriorityNames = ['B']
    const used = new Set(data.dorms.flatMap((bed, index) => ['dormitory_1\u00003', 'dormitory_2\u00003'].includes(alphaPosition(...bed.position)) ? [] : [index]))
    expect(data.dorms[alphaFindDormSlot(data, 'B', used)!]!.position).toEqual(['dormitory_2', 3])
  })

  it('still prefers a same-group vacant bed to taking over an occupied isolated bed', () => {
    const data = fixture()
    put(data, 'A', 'dormitory_1', 2)
    put(data, 'D', 'dormitory_2', 3)
    data.restingPriorityNames = ['B']
    const allowed = new Set([alphaPosition('dormitory_1', 3), alphaPosition('dormitory_2', 3)])
    const used = new Set(data.dorms.flatMap((bed, index) => allowed.has(alphaPosition(...bed.position)) ? [] : [index]))
    expect(data.dorms[alphaFindDormSlot(data, 'B', used)!]!.position).toEqual(['dormitory_1', 3])
  })
})
