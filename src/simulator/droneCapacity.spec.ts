import { describe, expect, it } from 'vitest'
import { createDefaultWorkspace } from '../workbench/defaults'
import { compileRosterSchedule } from '../scheduler/compileRosterSchedule'
import { simulateSchedule } from './scheduleSimulation'
import { projectScheduleState } from './scheduleSimulation'
import { createRosterRuntime } from '../scheduler/rosterRuntime'
import { compiledScheduleToRuntimeConfig } from '../scheduler/scheduleAdapter'
import { evaluateOperators } from '../engine/operatorRules'
import { createDroneState } from './droneTimeline'

describe('configured storage in the production timeline', () => {
  it('defaults stock capacity to 250', () => {
    expect(createDroneState(0).capacity).toBe(250)
  })

  it.each([235, 250, 300])('retains the selected %i storage capacity when simulating production', capacity => {
    const workspace = createDefaultWorkspace()
    workspace.droneCapacity = capacity
    const report = simulateSchedule(compileRosterSchedule(workspace), {
      sampleHours: 32,
      production: { outputMode: 'potential', droneTarget: 'none' },
    })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    const drones = report.production!.drones
    expect(drones.capacity).toBe(capacity)
    expect(drones.generated).toBeCloseTo(320, 7)
    expect(drones.stock).toBeCloseTo(capacity, 7)
    expect(drones.overflow).toBeCloseTo(320 - capacity, 7)
    expect(drones.initial + drones.generated - drones.overflow - drones.consumed).toBeCloseTo(drones.stock, 7)
  })

  it('passes the selected capacity into dynamic Greyy efficiency rather than using the default', () => {
    const workspace = createDefaultWorkspace()
    workspace.droneCapacity = 240
    workspace.mainPlan.facilities.room_1_3.slots[0]!.occupant = { kind: 'operator', operatorId: 'char_1027_greyy2' }
    const schedule = compileRosterSchedule(workspace)
    const state = createRosterRuntime(compiledScheduleToRuntimeConfig(schedule))
    const config = projectScheduleState(schedule, state)
    expect(config.efficiencyResources.droneCapacity).toBe(240)
    const power = config.rooms.find(room => room.id === 'room_1_3')!
    expect(evaluateOperators(power, config).skillBonus).toBe(24)
  })

  it('uses one capacity for both an explicit efficiency override and drone stock', () => {
    const workspace = createDefaultWorkspace()
    workspace.droneCapacity = 240
    workspace.mainPlan.facilities.room_1_3.slots[0]!.occupant = { kind: 'operator', operatorId: 'char_1027_greyy2' }
    workspace.mainPlan.conf.workaholic = ['char_1027_greyy2']
    const schedule = compileRosterSchedule(workspace)
    const before = structuredClone(schedule)
    const options = { sampleHours: 1, efficiencyResources: { droneCapacity: 300 }, production: { droneTarget: 'none' as const } }
    const originalOptions = structuredClone(options)
    const report = simulateSchedule(schedule, options)
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    expect(report.production!.drones.capacity).toBe(300)
    expect(report.production!.drones.generated).toBeCloseTo(13, 7)
    expect(report.inputs.schedule.sourceWorkspace.droneCapacity).toBe(300)
    expect(schedule).toEqual(before)
    expect(options).toEqual(originalOptions)
  })

  it('rejects invalid capacity overlays before starting a simulation', () => {
    const schedule = compileRosterSchedule(createDefaultWorkspace())
    for (const droneCapacity of [-1, 249.5, NaN, Infinity]) {
      expect(() => simulateSchedule(schedule, { efficiencyResources: { droneCapacity } })).toThrow(/无人机上限/)
    }
  })
})
