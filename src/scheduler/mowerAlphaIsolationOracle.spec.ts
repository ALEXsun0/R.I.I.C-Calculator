import { describe, expect, it } from 'vitest'
import oracle from './fixtures/mower-alpha-isolation-20261014.json'
import { alphaFindDormSlot, alphaPosition } from './mowerAlphaDorm'
import { planMowerDormIsolation } from './mowerDormIsolation'
import { MowerOperatorState, type MowerOperatorOptions } from './mowerOperatorState'
import { MowerDormState, MowerSchedulingData } from './mowerSchedulingData'
import type { MowerTaskPlan } from './mowerTaskQueue'

interface StateInput {
  plan: MowerTaskPlan
  operators: (MowerOperatorOptions & { known?: boolean })[]
  beds: { position: [string, number]; name: string }[]
  dormIsolation: string[][]
  dormOrder?: string[]
  reservedProductBeds?: [string, number, string][]
  freeRoomExclusions?: string[]
  freeBlacklist?: string[]
  priorityNames?: string[]
}
interface IsolationCase {
  name: string; state: StateInput; input: MowerTaskPlan; reservedSlots: [string, number][]
  reservedNames: string[]; expected: MowerTaskPlan
}
interface AssignmentCase {
  name: string; state: StateInput; requester: string; used: number[]; input: MowerTaskPlan
  expectedPosition: [string, number] | null
}
function state(input: StateInput): MowerSchedulingData {
  return new MowerSchedulingData({ alpha: true, nowMicros: 0, freeRoom: true,
    plan: structuredClone(input.plan), dormIsolation: input.dormIsolation, dormOrder: input.dormOrder,
    operators: Object.fromEntries(input.operators.map(({ known, ...op }) => [op.name,
      new MowerOperatorState({ mood: 10, restingPriority: 'low', ...op, timeStampMicros: known === false ? undefined : 0 }),
    ])),
    dorms: input.beds.map(bed => new MowerDormState([...bed.position], bed.name)),
    reservedProductBeds: new Map(input.reservedProductBeds?.map(([room, index, name]) => [alphaPosition(room, index), name])),
    freeRoomExclusions: input.freeRoomExclusions, freeBlacklist: input.freeBlacklist, restingPriorityNames: input.priorityNames,
  })
}

describe('unchanged native 3de2b2ac6 dorm isolation and assignment oracle', () => {
  it.each(oracle.isolationCases as unknown as IsolationCase[])('$name', fixture => {
    const data = state(fixture.state), input = structuredClone(fixture.input), before = JSON.stringify(data)
    const actual = planMowerDormIsolation(data, input,
      new Set(fixture.reservedSlots.map(([room, index]) => alphaPosition(room, index))), new Set(fixture.reservedNames))
    expect(actual).toEqual(fixture.expected)
    expect(input).toEqual(fixture.input)
    expect(JSON.stringify(data)).toBe(before)
  })

  it.each(oracle.assignmentCases as unknown as AssignmentCase[])('$name', fixture => {
    const data = state(fixture.state), before = JSON.stringify(data), used = new Set(fixture.used)
    const index = alphaFindDormSlot(data, fixture.requester, used, undefined, fixture.input)
    expect(index === undefined ? null : data.dorms[index]!.position).toEqual(fixture.expectedPosition)
    expect([...used]).toEqual(fixture.used)
    expect(JSON.stringify(data)).toBe(before)
  })
})
