import { describe, expect, it } from 'vitest'
import { createDefaultWorkspace } from '../workbench/defaults'
import { compileRosterSchedule } from './compileRosterSchedule'
import { compiledScheduleToRuntimeConfig } from './scheduleAdapter'

describe('alpha exported scheduling settings', () => {
  it('applies imported settings through compilation to runtime without mutating the document', () => {
    const ws = createDefaultWorkspace()
    ws.compatibility.unrecognizedFields.advanced_settings = {
      resting_threshold: .5, free_room: true, group_mood_gap_threshold_minutes: 75,
      group_mood_gap_max_extra_wait_hours: 2, drone_count_limit: 30,
      fia_fool: false, fia_threshold: .8,
    }
    const before = structuredClone(ws)
    const schedule = compileRosterSchedule(ws)
    const config = compiledScheduleToRuntimeConfig(schedule)
    expect(config.mowerPolicy).toMatchObject({ restingThreshold: .5, freeRoom: true, groupMoodGapThresholdMinutes: 75, groupMoodGapMaxExtraWaitHours: 2 })
    expect(config.mowerDroneCountLimit).toBe(30)
    expect(ws).toEqual(before)
  })
  it('lets explicit simulator assumptions override imported values', () => {
    const ws = createDefaultWorkspace()
    ws.compatibility.unrecognizedFields.advanced_settings = { resting_threshold: .5 }
    expect(compileRosterSchedule(ws, { restingThreshold: .8 }).assumptions.restingThreshold).toBe(.8)
  })
  it.each([0, 1441, 1.5, '60', null])('rejects invalid recovery gap %s', value => {
    const ws = createDefaultWorkspace()
    ws.compatibility.unrecognizedFields.advanced_settings = { group_mood_gap_threshold_minutes: value }
    expect(compileRosterSchedule(ws).diagnostics.some(d => d.path === 'assumptions.groupMoodGapThresholdMinutes' && d.severity === 'error')).toBe(true)
  })
  it('uses the alpha sixty minute default regardless of power-plant count', () => {
    expect(compileRosterSchedule(createDefaultWorkspace()).assumptions.groupMoodGapThresholdMinutes).toBe(60)
  })
})
