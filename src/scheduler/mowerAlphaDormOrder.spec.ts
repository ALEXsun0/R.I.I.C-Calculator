import { describe, expect, it } from 'vitest'
import { effectiveMowerDormOrder } from '../domain/mowerDormOrder'
import { MowerDormState, MowerSchedulingData } from './mowerSchedulingData'
import { MowerOperatorState } from './mowerOperatorState'
import { orderMowerAlphaDormIndices } from './mowerDormOrder'
import { alphaFindDormSlot } from './mowerAlphaDorm'

function data(order: string[]) {
  return new MowerSchedulingData({ alpha: true, dormOrder: order, nowMicros: 0,
    plan: { dormitory_1: ['Free', 'Free'], dormitory_2: ['Free', 'Free'] },
    dorms: [new MowerDormState(['dormitory_1', 0]), new MowerDormState(['dormitory_1', 1]), new MowerDormState(['dormitory_2', 0]), new MowerDormState(['dormitory_2', 1])],
    operators: { worker: new MowerOperatorState({ name: 'worker', room: 'room_1_1', index: 0, operatorType: 'high', restingPriority: 'high', mood: 10 }) },
  })
}

describe('alpha high and low dormitory priorities', () => {
  it('normalizes numbered legacy beds without losing explicit low priority', () => {
    expect(effectiveMowerDormOrder(['dormitory_2_low', 'dormitory_3_4', 'dormitory_3', 'invalid'])).toEqual(['dormitory_2_low', 'dormitory_3', 'dormitory_1', 'dormitory_2', 'dormitory_4'])
  })
  it('places all high beds first by default rather than all beds of the first room', () => {
    expect(orderMowerAlphaDormIndices(data([]))).toEqual([0, 2, 1, 3])
  })
  it('uses explicit low positions before high positions for both applicant tiers', () => {
    const state = data(['dormitory_2_low', 'dormitory_1'])
    expect(alphaFindDormSlot(state, 'worker', new Set())).toBe(3)
    state.operators.worker!.restingPriority = 'low'
    expect(alphaFindDormSlot(state, 'worker', new Set())).toBe(3)
    expect(alphaFindDormSlot(state, 'worker', new Set([3]))).toBe(0)
  })
})
