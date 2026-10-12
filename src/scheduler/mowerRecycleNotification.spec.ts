import { describe, expect, it } from 'vitest'
import { MowerTaskQueue } from './mowerTaskQueue'
import { collectMowerTodoList, type MowerNotificationRequest, type MowerNotificationState } from './mowerNotification'

function observe(now: number, state: MowerNotificationState, pending = true) {
  const requests: MowerNotificationRequest[] = []
  const generator = collectMowerTodoList(state, { nowMicros: () => now })
  let next = generator.next()
  while (!next.done) {
    const request = next.value
    requests.push(request)
    next = generator.next({ kind: request.kind, observedAtMicros: now, value: request.kind === 'find-collect' && request.resource === 'recycle' && pending ? { control: 'infra_collect_recycle' } : null })
  }
  return requests
}

const state = (): MowerNotificationState => ({ queue: new MowerTaskQueue(), flags: { todoTask: false, collectNotification: false, planned: false }, lastTodoMicros: 0, collectRecycle: true })

describe('pinned alpha recycling todo extension', () => {
  it('collects recycling last at the inclusive fifteen-minute boundary', () => {
    const current = state()
    const requests = observe(900_000_000, current)
    expect(requests.filter(request => request.kind === 'find-collect').map(request => request.resource)).toEqual(['bill', 'factory', 'trust', 'recycle'])
    expect(requests[requests.length - 1]).toMatchObject({ kind: 'tap-collect', resource: 'recycle' })
    expect(current.lastTodoMicros).toBe(900_000_000)
    expect(current.flags.todoTask).toBe(false)
  })

  it('does not recollect until the interval elapses and closes an empty todo page', () => {
    const current = state()
    expect(observe(899_999_999, current)).toEqual([{ kind: 'tap-close-todo', target: [1840, 140] }])
    const empty = state()
    const emptyRequests = observe(900_000_000, empty, false)
    expect(emptyRequests[emptyRequests.length - 1]).toEqual({ kind: 'tap-close-todo', target: [1840, 140] })
    expect(empty.flags.todoTask).toBe(true)
  })

  it('retains the frozen legacy strict boundary and resource list for old plans', () => {
    const legacy = state()
    legacy.collectRecycle = false
    expect(observe(900_000_000, legacy)).toEqual([{ kind: 'tap-close-todo', target: [1840, 140] }])
    expect(observe(900_000_001, legacy).filter(request => request.kind === 'find-collect').map(request => request.resource)).toEqual(['bill', 'factory', 'trust'])
  })
})
