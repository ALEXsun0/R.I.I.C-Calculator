import { describe, expect, it } from 'vitest'
import { createRecycleTimeline } from './recycleTimeline'

describe('recycle production and storage', () => {
  it('converts one material per 48 base hours and pauses at capacity', () => {
    const timeline = createRecycleTimeline(1)
    timeline.advance(48 * 7, 100)
    expect(timeline.report()).toMatchObject({ completedItems: 5, pendingItems: 5, remainingBaseHours: 48, blockedHours: 96 })
    expect(timeline.nextEventHours(100)).toBe(Infinity)
    expect(timeline.collect()).toBe(5)
    timeline.advance(24, 100)
    expect(timeline.report()).toMatchObject({ completedItems: 5, pendingItems: 0, collectedItems: 5, remainingBaseHours: 24 })
  })
  it('continues an existing conversion when staffing efficiency changes', () => {
    const timeline = createRecycleTimeline(3)
    timeline.advance(24, 100)
    timeline.advance(24 / 1.52, 152)
    expect(timeline.report().completedItems).toBe(1)
    expect(timeline.report().remainingBaseHours).toBeCloseTo(48)
  })
  it('separates warmup production and remains invariant under time subdivision', () => {
    const once = createRecycleTimeline(3), split = createRecycleTimeline(3)
    once.advance(48 / 1.51, 151)
    split.advance(48 / 1.51, 151)
    once.markObservation(); split.markObservation()
    once.advance(240, 151)
    for (let i = 0; i < 960; i++) split.advance(.25, 151)
    expect(split.report().completedItems).toBe(once.report().completedItems)
    expect(split.report().sampleCompletedItems).toBe(once.report().sampleCompletedItems)
    expect(split.report().remainingBaseHours).toBeCloseTo(once.report().remainingBaseHours, 8)
  })
})
