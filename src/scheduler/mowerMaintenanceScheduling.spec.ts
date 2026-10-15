import { describe, expect, it } from 'vitest'
import { scheduleMowerTasks, type MowerTaskSchedulingOptions } from './mowerTaskScheduling'
import { MowerTask, MOWER_TASK_TYPES as T, toMowerMicros } from './mowerTaskQueue'
import { advanceMowerMaintenanceOrders, advanceMowerMaintenanceSwaps, mowerMaintenanceWindows, nextMowerDailyReset } from './mowerMaintenanceScheduling'

const seconds = (value: number) => value * 1_000_000
const hours = toMowerMicros
type Options = MowerTaskSchedulingOptions
const daily: Options = { alpha: true, firstDailyResetMicros: hours(13) }
const order = (hour: number) => new MowerTask({ type: T.RUN_ORDER, time: hour, metadata: 'room_1_1' })
const swap = (hour: number) => new MowerTask({ type: T.SWAP_SUPPORT, time: hour, plan: { train: ['A'] } })

describe('explicit alpha maintenance and daily reset scheduling', () => {
  it('advances an order around the supplied daily phase, retaining its original object', () => {
    const task = order(13), tasks = [task]
    scheduleMowerTasks(tasks, hours(12), daily)
    expect(task.timeMicros).toBe(hours(13) - seconds(601))
    expect(task.adjusted).toBe(true)
    expect(tasks[0]).toBe(task)
  })

  it('protects an instantaneous daily reset with a swap duration and one-second separation', () => {
    const task = swap(13), tasks = [task]
    scheduleMowerTasks(tasks, hours(12), daily)
    expect(task.timeMicros).toBe(hours(13) - seconds(661))
    expect(task.advanceSupportSwap).toBe(true)
    expect(tasks[0]).toBe(task)
  })

  it('handles the later reset before an overlapping earlier maintenance window', () => {
    const start = hours(13) - seconds(900)
    const task = order(13), options: Options = { ...daily, maintenance: [start, start] }
    scheduleMowerTasks([task], hours(12), options)
    expect(task.timeMicros).toBe(start - seconds(601))
  })

  it('does not infer a daily phase when the caller did not supply one', () => {
    expect(nextMowerDailyReset(hours(12))).toBeUndefined()
    expect(mowerMaintenanceWindows(hours(12), {}, 'orders')).toEqual([])
    const tasks = [order(13), swap(15)], before = tasks.map(task => task.timeMicros)
    scheduleMowerTasks(tasks, hours(12), { alpha: true })
    expect(tasks.map(task => task.timeMicros)).toEqual(before)
  })

  it.each([
    [hours(13) - 1, hours(13)], [hours(13), hours(37)], [hours(13) + 1, hours(37)], [hours(37), hours(61)],
  ])('selects the strictly next reset at now=%s', (now, expected) => {
    expect(nextMowerDailyReset(now, hours(13))).toBe(expected)
  })

  it('does not reprocess the current reset once its exact boundary has arrived', () => {
    const task = order(13)
    scheduleMowerTasks([task], hours(13), daily)
    expect(task.timeMicros).toBe(hours(13))
    expect(task.adjusted).toBe(false)
  })

  it('uses strict run-order buffer boundaries and leaves unrelated task types untouched', () => {
    const start = hours(13) - seconds(600), end = hours(13) + seconds(600)
    const times = [start, start + 1, hours(13), end - 1, end]
    const tasks = times.map(time => { const task = order(0); task.timeMicros = time; return task })
    const refresh = new MowerTask({ type: T.REFRESH_TIME, time: 13 }), original = [...tasks, refresh]
    advanceMowerMaintenanceOrders(original, hours(12), daily)
    expect(tasks.map(task => task.timeMicros)).toEqual([start, start - seconds(1), start - seconds(2), start - seconds(3), end])
    expect(refresh.timeMicros).toBe(hours(13))
    expect(original).toEqual([...tasks, refresh])
    expect(original[0]).toBe(tasks[0])
  })

  it('uses twice the configured run-order delay when it exceeds ten minutes', () => {
    const task = order(13)
    scheduleMowerTasks([task], hours(12), { ...daily, runOrderDelayMinutes: 8 })
    expect(task.timeMicros).toBe(hours(13) - seconds(16 * 60 + 1))
  })

  it('reserves multiple swaps backwards, preserving their original order and object identities', () => {
    const early = swap(12.95), late = swap(13), tasks = [early, late]
    scheduleMowerTasks(tasks, hours(12), daily)
    expect(early.timeMicros).toBe(hours(13) - seconds(722))
    expect(late.timeMicros).toBe(hours(13) - seconds(661))
    expect(tasks).toEqual([early, late])
    expect(tasks[0]).toBe(early)
    expect(tasks[1]).toBe(late)
    const before = tasks.map(task => task.timeMicros)
    scheduleMowerTasks(tasks, hours(12), daily)
    expect(tasks.map(task => task.timeMicros)).toEqual(before)
  })

  it('uses measured dorm operation budgets when a support swap involves a slow room', () => {
    const task = swap(13)
    task.plan.dormitory_1 = ['A']
    scheduleMowerTasks([task], hours(12), { ...daily, dormDurations: { dormitory_1: [180] } })
    // max(90, 180*1.2+15)=231s in the dorm, plus 45s in the training room.
    expect(task.timeMicros).toBe(hours(13) - seconds(600 + 276 + 1))
  })

  it('uses the full maintenance end for swaps while retaining the shorter order window', () => {
    const task = swap(14.25), options: Options = { alpha: true, maintenance: [hours(13), hours(14)], maintenanceEndMicros: hours(14.5) }
    scheduleMowerTasks([task], hours(12), options)
    expect(task.timeMicros).toBe(hours(13) - seconds(661))
    expect(mowerMaintenanceWindows(hours(12), options, 'orders')).toEqual([[hours(13), hours(14)]])
    expect(mowerMaintenanceWindows(hours(12), options, 'swaps')).toEqual([[hours(13), hours(14.5)]])
  })

  it('does not guess a full support-swap window from the legacy order interval', () => {
    const task = swap(13.5)
    scheduleMowerTasks([task], hours(12), { alpha: true, maintenance: [hours(13), hours(14)] })
    expect(task.timeMicros).toBe(hours(13.5))
    expect(task.advanceSupportSwap).toBe(false)
  })

  it('processes later swap windows first so advancing into an earlier maintenance is resolved in one pass', () => {
    const task = swap(13), start = hours(13) - seconds(900)
    scheduleMowerTasks([task], hours(12), { ...daily, maintenance: [start, hours(13)], maintenanceEndMicros: hours(13) })
    expect(task.timeMicros).toBe(start - seconds(661))
  })

  it('does not move swaps exactly at a normal maintenance end or outside the reset side of its instant', () => {
    const tasks = [swap(13 - 10 / 60), swap(13 + 1 / 3600)]
    advanceMowerMaintenanceSwaps(tasks, hours(12), daily, () => seconds(60))
    expect(tasks.map(task => task.timeMicros)).toEqual([hours(13 - 10 / 60), hours(13 + 1 / 3600)])
    const atEnd = swap(14)
    advanceMowerMaintenanceSwaps([atEnd], hours(12), { maintenance: [hours(13), hours(13.5)], maintenanceEndMicros: hours(14) }, () => seconds(60))
    expect(atEnd.timeMicros).toBe(hours(14))
  })

  it('clamps advanced swaps to now instead of scheduling operations in the past', () => {
    const task = swap(13), now = hours(13) - seconds(15)
    scheduleMowerTasks([task], now, daily)
    expect(task.timeMicros).toBe(now)
    expect(task.advanceSupportSwap).toBe(true)
  })

  it('skips started maintenance for swaps while overdue orders retain the source window adjustment', () => {
    const options: Options = { maintenance: [hours(13), hours(14)], maintenanceEndMicros: hours(14.5) }
    const a = order(13.5), b = swap(13.5)
    advanceMowerMaintenanceOrders([a], hours(15), options)
    advanceMowerMaintenanceSwaps([b], hours(15), options, () => seconds(60))
    expect(a.timeMicros).toBe(hours(13) - seconds(601))
    expect(b.timeMicros).toBe(hours(13.5))
    expect(b.advanceSupportSwap).toBe(false)
  })

  it.each([[true, true], [false, true], [true, false], [false, false]])('respects independent run-order=%s and mastery=%s switches', (adjustForRunOrders, enableMastery) => {
    const a = order(13), b = swap(13)
    scheduleMowerTasks([a, b], hours(12), { ...daily, adjustForRunOrders, enableMastery })
    expect(a.timeMicros).toBe(adjustForRunOrders ? hours(13) - seconds(601) : hours(13))
    expect(b.timeMicros).toBe(enableMastery ? hours(13) - seconds(661) : hours(13))
  })

  it('does not apply the new daily or full-end rules to the default historical scheduler', () => {
    const a = order(13), b = swap(13.5)
    scheduleMowerTasks([a], hours(12), { ...daily, alpha: false })
    scheduleMowerTasks([b], hours(12), { alpha: false, maintenance: [hours(13), hours(14)], maintenanceEndMicros: hours(14.5) })
    expect(a.timeMicros).toBe(hours(13))
    expect(b.timeMicros).toBe(hours(13.5))
  })
})
