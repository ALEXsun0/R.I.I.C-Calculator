import { describe, expect, it } from 'vitest'
import { createDefaultWorkspace } from '../workbench/defaults'
import { compileRosterSchedule } from '../scheduler/compileRosterSchedule'
import { resolveOperatorCharId as id } from '../domain/operatorIdentifiers'
import { simulateSchedule, type ScheduleSimulationReport } from './scheduleSimulation'

function scenario(name?: string, initialMorale = 24) {
  const workspace = createDefaultWorkspace()
  for (const room of Object.values(workspace.mainPlan.facilities)) room.slots = []
  if (name) {
    workspace.mainPlan.facilities.meeting.slots = [{ occupant: { kind: 'operator', operatorId: name }, groupId: null, replacements: [] }]
    workspace.mainPlan.conf.workaholic = [name]
  }
  return compileRosterSchedule(workspace, { operatorMorale: name ? { [id(name)]: initialMorale } : {} })
}

describe.each(['mower-default', 'mower-alpha'] as const)('reception production in %s simulation', schedulingModel => {
  it('records serializable exchange production through the real scheduling and production entry', () => {
    const report = simulateSchedule(scenario('跃跃'), {
      schedulingModel, sampleHours: 24, maxStepHours: 1,
      consumptionOverrides: { [id('跃跃')]: 0 },
      production: { outputMode: 'potential', droneTarget: 'none', runOrderMode: 'ideal' },
    })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    expect(report.receptionClues).toEqual({ completed: 2, progress: expect.closeTo(.268), exchangeMode: 'always-on' })
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'MOWER_CLUE_OBSERVATION_MODEL', message: expect.stringContaining('调度观察中的线索交流固定关闭') }))
    expect(JSON.parse(JSON.stringify(report)).receptionClues).toEqual(report.receptionClues)
    const restored = JSON.parse(JSON.stringify(report.inputs))
    expect(simulateSchedule(restored.schedule, restored.options).receptionClues).toEqual(report.receptionClues)
  })

  it('integrates passive production after morale reaches zero inside the sampling interval', () => {
    const report = simulateSchedule(scenario('跃跃', .1), {
      schedulingModel, sampleHours: 1, maxStepHours: 1,
      consumptionOverrides: { [id('跃跃')]: 1 },
    })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    expect(report.receptionClues?.progress).toBeCloseTo((1.89 * .1 + 1.44 * .9) / 20, 8)
  })

  it('carries warmup progress while excluding warmup completions', () => {
    const report = simulateSchedule(scenario('塞雷娅'), {
      schedulingModel, warmupHours: 20, sampleHours: 20, maxStepHours: 1,
      consumptionOverrides: { [id('塞雷娅')]: 0 },
    })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    expect(report.receptionClues).toEqual({ completed: 2, progress: expect.closeTo(.24), exchangeMode: 'always-on' })
  })

  it.each([[0, .0865], [5, .091]])('uses %s initial hours for the Ines ramp', (initialHours, expected) => {
    const report = simulateSchedule(scenario('伊内丝'), {
      schedulingModel, sampleHours: 1, maxStepHours: 1,
      consumptionOverrides: { [id('伊内丝')]: 0 }, initialWorkHours: { [id('伊内丝')]: initialHours },
    })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    expect(report.receptionClues?.progress).toBeCloseTo(expected, 8)
  })

  it('preserves explicit low-level skill gates and the existing idle-only inventory fallback', () => {
    const options = { schedulingModel, sampleHours: 20, consumptionOverrides: { [id('跃跃')]: 0 } }
    const low = simulateSchedule(scenario('跃跃'), { ...options, operatorInventory: [{ operator: '跃跃', elitePhase: 0, level: 1 }] })
    expect(low.success, JSON.stringify(low.diagnostics)).toBe(true)
    expect(low.receptionClues?.progress).toBeCloseTo(.43)
    const idleOnly = simulateSchedule(scenario('跃跃'), { ...options, operatorInventory: [{ operator: '砾', elitePhase: 0, level: 1 }] })
    expect(idleOnly.success, JSON.stringify(idleOnly.diagnostics)).toBe(true)
    expect(idleOnly.receptionClues?.progress).toBeCloseTo(.89)
  })

  it('keeps empty-room scenarios successful and permits legacy reports without clue statistics', () => {
    const schedule = scenario()
    const report = simulateSchedule(schedule, { schedulingModel, sampleHours: 1 })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    expect(report.receptionClues).toEqual({ completed: 0, progress: 0, exchangeMode: 'always-on' })
    const legacy: ScheduleSimulationReport = structuredClone(report)
    delete legacy.receptionClues
    expect(legacy.success).toBe(true)
    expect(legacy.receptionClues).toBeUndefined()
  })
})
