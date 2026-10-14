import { describe, expect, it } from 'vitest'
import { resolveOperatorCharId as id } from '../domain/operatorIdentifiers'
import { createDefaultWorkspace } from '../workbench/defaults'
import { compileRosterSchedule } from '../scheduler/compileRosterSchedule'
import { simulateSchedule } from './scheduleSimulation'

const hunters = ['斯卡蒂', '乌尔比安', '安哲拉', '幽灵鲨']

function scenario(hunterMorale: number, providerMorale: number) {
  const workspace = createDefaultWorkspace()
  for (const [roomId, names] of [
    ['room_1_1', hunters.slice(0, 2)],
    ['room_1_2', hunters.slice(2)],
    ['central', ['歌蕾蒂娅']],
  ] as const) {
    workspace.mainPlan.facilities[roomId].slots = names.map(name => ({
      occupant: { kind: 'operator' as const, operatorId: name }, groupId: null, replacements: [],
    }))
  }
  workspace.mainPlan.conf.workaholic = [...hunters, '歌蕾蒂娅']
  const schedule = compileRosterSchedule(workspace, {
    idleOperators: [],
    operatorMorale: Object.fromEntries([
      ...hunters.map(name => [id(name), hunterMorale] as const),
      [id('歌蕾蒂娅'), providerMorale],
    ]),
  })
  schedule.rooms = schedule.rooms.filter(room => ['room_1_1', 'room_1_2', 'central'].includes(room.roomId))
  schedule.restPools = []
  return schedule
}

describe('dynamic Abyssal manufacturing through exhaustion', () => {
  it.each(['mower-default', 'mower-alpha'] as const)('retains +80%% per room across recipient fatigue under %s', schedulingModel => {
    const report = simulateSchedule(scenario(1, 24), {
      schedulingModel, sampleHours: 2, maxStepHours: .25, recordSegments: true,
      consumptionOverrides: Object.fromEntries([...hunters.map(name => [id(name), 1]), [id('歌蕾蒂娅'), 0]]),
      production: { outputMode: 'potential', droneTarget: 'none' },
    })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    for (const roomId of ['room_1_1', 'room_1_2']) {
      const room = report.rooms.find(item => item.roomId === roomId)!
      expect(room.averageEfficiencyPercent).toBeCloseTo(181, 6)
      expect(report.segments.filter(segment => segment.start < 1).every(segment => segment.efficiencyPercent[roomId] === 182)).toBe(true)
      const fatigued = report.segments.filter(segment => segment.start >= 1)
      expect(fatigued.length).toBeGreaterThan(0)
      expect(fatigued.every(segment => segment.efficiencyPercent[roomId] === 180)).toBe(true)
      const production = report.production!.manufacturing.find(item => item.roomId === roomId)!
      expect(production.completedItems).toBe(3)
      expect(production.remainingBaseMinutes).toBeCloseTo(70.8, 6)
    }
    for (const name of hunters) {
      const operator = report.operators.find(item => item.operatorId === id(name))!
      // The report separates productive duty from exhausted physical occupancy.
      expect(operator.workHours).toBeCloseTo(1, 6)
      expect(operator.exhaustedHours).toBeCloseTo(1, 6)
      expect(operator.workHours + operator.exhaustedHours).toBeCloseTo(2, 6)
      expect(operator.finalMorale).toBe(0)
    }
  })

  it('stops the grant when the provider itself exhausts while recipients remain on duty', () => {
    const report = simulateSchedule(scenario(0, 1), {
      sampleHours: 2, maxStepHours: .25, recordSegments: true,
      consumptionOverrides: Object.fromEntries([...hunters.map(name => [id(name), 0]), [id('歌蕾蒂娅'), 1]]),
      production: { outputMode: 'potential', droneTarget: 'none' },
    })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    for (const roomId of ['room_1_1', 'room_1_2']) {
      expect(report.rooms.find(item => item.roomId === roomId)!.averageEfficiencyPercent).toBeCloseTo(140, 6)
      expect(report.segments.filter(segment => segment.start < 1).every(segment => segment.efficiencyPercent[roomId] === 180)).toBe(true)
      const fatiguedProvider = report.segments.filter(segment => segment.start >= 1)
      expect(fatiguedProvider.length).toBeGreaterThan(0)
      expect(fatiguedProvider.every(segment => segment.efficiencyPercent[roomId] === 100)).toBe(true)
    }
    const provider = report.operators.find(item => item.operatorId === id('歌蕾蒂娅'))!
    expect(provider.exhaustedHours).toBeCloseTo(1, 6)
    expect(provider.finalMorale).toBe(0)
  })
})
