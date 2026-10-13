import { describe, expect, it } from 'vitest'
import oracle from './fixtures/mower-alpha-decisions-20261013.json'
import { MowerDormState, MowerSchedulingData } from './mowerSchedulingData'
import { MowerOperatorState } from './mowerOperatorState'
import { orderMowerAlphaDormIndices } from './mowerDormOrder'
import { mowerGetRestingPlan } from './mowerOrdinaryPlanning'
import type { MowerTaskPlan } from './mowerTaskQueue'

describe('October 13 changed decisions against unmodified native Python', () => {
  for (const [index, sample] of oracle.dormCases.entries()) it(`ordered beds ${index}`, () => {
    const dorms = [1, 2].flatMap(room => [0, 1].map(slot => new MowerDormState([`dormitory_${room}`, slot])))
    const plan: Record<string, string[]> = { dormitory_1: ['Free', 'Free'], dormitory_2: ['Free', 'Free'] }
    for (const closed of sample.closed) {
      const [room, slot] = dorms[closed]!.position
      plan[room]![slot] = 'keeper'
    }
    const data = new MowerSchedulingData({ alpha: true, nowMicros: 0, plan, dorms, dormOrder: sample.order, operators: {} })
    expect(orderMowerAlphaDormIndices(data)).toEqual(sample.indices)
  })
  for (const sample of oracle.covers) it(sample.name, () => {
    const data = new MowerSchedulingData({ alpha: true, nowMicros: 0,
      plan: { room_1_1: ['A', 'Current'], room_1_2: ['Current'], dormitory_1: ['Free', 'Free'] },
      dorms: [new MowerDormState(['dormitory_1', 0]), new MowerDormState(['dormitory_1', 1])],
      operators: {
        A: new MowerOperatorState({ name: 'A', room: 'room_1_1', index: 0, currentRoom: sample.room === 'room_1_1' && sample.index === 0 ? '' : 'room_1_1', currentIndex: 0, operatorType: 'high', restingPriority: 'high', mood: 10, timeStampMicros: 0, replacement: ['C'] }),
        C: new MowerOperatorState({ name: 'C', currentRoom: sample.room, currentIndex: sample.index, mood: 24, timeStampMicros: 0 }),
      },
    })
    const plan: MowerTaskPlan = sample.retained ? { room_1_1: ['C', 'Current'] } : {}
    expect(mowerGetRestingPlan(data, ['A'], sample.existing ? ['C'] : [], plan)).toBe(sample.accepted)
    if (sample.accepted) {
      expect(plan.room_1_1?.[0]).toBe('C')
      expect(data.dorms.some(bed => bed.name === 'A')).toBe(true)
    }
  })
})
