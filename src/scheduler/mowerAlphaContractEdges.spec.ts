import { describe, expect, it } from 'vitest'
import { createDefaultWorkspace } from '../workbench/defaults'
import { compileRosterSchedule } from './compileRosterSchedule'
import { compiledScheduleToRuntimeConfig } from './scheduleAdapter'
import { createRosterRuntime } from './rosterRuntime'
import { getMowerSourceRuntime } from './mowerSourceRuntime'
import { MowerOperatorState } from './mowerOperatorState'
import { MowerDormState, MowerSchedulingData } from './mowerSchedulingData'
import { MowerTaskQueue, toMowerMicros } from './mowerTaskQueue'
import { planMowerAlphaMetadata } from './mowerAlphaMetadata'
import { alphaFindDormSlot } from './mowerAlphaDorm'
import { createBackupPlanController } from './backupPlans'

function unrelatedReturnDeadline(followerMorale: number) {
  const data = new MowerSchedulingData({ alpha: true, nowMicros: 0,
    plan: { room_1_1: ['A', 'B'], room_1_2: ['F'], room_1_3: ['C'], dormitory_1: ['K1', 'K2', 'Free', 'Free', 'Free'] },
    operators: {}, dorms: [2, 3, 4].map(index => new MowerDormState(['dormitory_1', index])),
  })
  for (const [name, room, index, group] of [['A', 'room_1_1', 0, 'a'], ['B', 'room_1_1', 1, 'b'], ['F', 'room_1_2', 0, 'a']] as const) {
    data.operators[name] = new MowerOperatorState({ name, room, index, group, operatorType: 'high', restingPriority: 'high', currentRoom: room, currentIndex: index, mood: name === 'F' ? followerMorale : 24, timeStampMicros: 0,
      ...(name === 'F' ? { replacement: ['X'], groupBindings: [{ group: 'a', replacement: ['X'] }, { group: 'b', replacement: ['X'] }] } : {}),
    })
  }
  data.operators.C = new MowerOperatorState({ name: 'C', group: 'c', room: 'room_1_3', index: 0, currentRoom: 'dormitory_1', currentIndex: 2, operatorType: 'high', restingPriority: 'high', mood: 12, timeStampMicros: 0 })
  data.dorms[0]!.name = 'C'; data.dorms[0]!.timeMicros = toMowerMicros(4)
  const queue = new MowerTaskQueue(); planMowerAlphaMetadata(data, queue, [])
  return queue.tasks.find(task => task.plan.room_1_3?.[0] === 'C')?.time
}

function twoDormWorkspace() {
  const workspace = createDefaultWorkspace()
  for (const facility of Object.values(workspace.mainPlan.facilities)) facility.slots = []
  for (const room of ['dormitory_1', 'dormitory_2'] as const) workspace.mainPlan.facilities[room].slots = [
    { occupant: { kind: 'free' }, groupId: null, replacements: [] },
    { occupant: { kind: 'free' }, groupId: null, replacements: [] },
  ]
  return workspace
}

describe('Mower alpha contract edges', () => {
  it.each([24, 0])('keeps an unrelated group return deadline when a working follower has morale %s', morale => {
    // Fixed native scheduler_task.py excludes multi_group from minimum-rest forecasts.
    expect(unrelatedReturnDeadline(morale)).toBeCloseTo(4 - 8 / 60, 8)
  })

  it('lets imported advanced values survive undefined caller options', () => {
    const workspace = createDefaultWorkspace()
    workspace.compatibility.unrecognizedFields.advanced_settings = { drone_count_limit: 120, drone_interval: 1, rescue_threshold: 0.5 }
    const before = structuredClone(workspace)
    const schedule = compileRosterSchedule(workspace, { droneCountLimit: undefined, droneIntervalHours: undefined, rescueThreshold: undefined })
    expect(schedule.assumptions).toMatchObject({ droneCountLimit: 120, droneIntervalHours: 1, rescueThreshold: 0.5 })
    expect(schedule.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    expect(compiledScheduleToRuntimeConfig(schedule)).toMatchObject({ mowerDroneCountLimit: 120, mowerServices: { droneIntervalHours: 1 }, mowerPolicy: { rescueThreshold: 0.5 } })
    expect(workspace).toEqual(before)
  })

  it('keeps defined zero options above imported advanced values', () => {
    const workspace = createDefaultWorkspace()
    workspace.compatibility.unrecognizedFields.advanced_settings = { drone_count_limit: 120, drone_interval: 1, rescue_threshold: 0.5 }
    expect(compileRosterSchedule(workspace, { droneCountLimit: 0, droneIntervalHours: 0, rescueThreshold: 0 }).assumptions).toMatchObject({ droneCountLimit: 0, droneIntervalHours: 0, rescueThreshold: 0 })
  })

  it('folds explicit legacy bed priority into the alpha room order without changing native JSON', () => {
    const workspace = twoDormWorkspace()
    workspace.mainPlan.conf.dorm_order = 'dormitory_1,dormitory_2'
    const before = structuredClone(workspace)
    const schedule = compileRosterSchedule(workspace, { dormOrder: 'dormitory_2_1,dormitory_2_0,dormitory_1_1,dormitory_1_0' })
    expect(schedule.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    const config = compiledScheduleToRuntimeConfig(schedule); config.mowerAlpha = true
    expect(config.mowerDormOrder).toEqual(['dormitory_2', 'dormitory_1', 'dormitory_3', 'dormitory_4'])
    const data = getMowerSourceRuntime(createRosterRuntime(config)).data
    data.operators.Request = new MowerOperatorState({ name: 'Request', operatorType: 'high', restingPriority: 'high', mood: 12, timeStampMicros: 0 })
    const candidate = alphaFindDormSlot(data, 'Request', new Set())
    expect(candidate).toBeDefined()
    expect(data.dorms[candidate!]!.position).toEqual(['dormitory_2', 0])
    expect(workspace).toEqual(before)
    expect(schedule.sourceWorkspace).toEqual(before)
  })

  it('retains native room and explicit low priority when no legacy caller order is present', () => {
    const workspace = twoDormWorkspace()
    workspace.mainPlan.conf.dorm_order = 'dormitory_2_low,dormitory_1,dormitory_2'
    const config = compiledScheduleToRuntimeConfig(compileRosterSchedule(workspace)); config.mowerAlpha = true
    expect(config.mowerDormOrder).toEqual(['dormitory_2_low', 'dormitory_1', 'dormitory_2', 'dormitory_3', 'dormitory_4'])
    const data = getMowerSourceRuntime(createRosterRuntime(config)).data
    data.operators.Request = new MowerOperatorState({ name: 'Request', operatorType: 'high', restingPriority: 'high', mood: 12, timeStampMicros: 0 })
    const candidate = alphaFindDormSlot(data, 'Request', new Set())
    expect(data.dorms[candidate!]!.position).toEqual(['dormitory_2', 1])
  })

  it('keeps an explicit legacy room priority across a native backup activation and restoration', () => {
    const workspace = twoDormWorkspace()
    workspace.mainPlan.conf.dorm_order = 'dormitory_1,dormitory_2'
    workspace.compatibility.backupPlans = [{ trigger: 'True', conf: { dorm_order: 'dormitory_1_low,dormitory_1,dormitory_2', dorm_order_override: true } }]
    const before = structuredClone(workspace)
    const schedule = compileRosterSchedule(workspace, { dormOrder: 'dormitory_2_1,dormitory_2_0,dormitory_1_1,dormitory_1_0' })
    const config = compiledScheduleToRuntimeConfig(schedule); config.mowerAlpha = true
    const state = createRosterRuntime(config), controller = createBackupPlanController(schedule, state)
    controller.evaluate('END')
    expect(controller.active).toEqual([true])
    expect(state.config.mowerDormOrder).toEqual(['dormitory_2', 'dormitory_1', 'dormitory_3', 'dormitory_4'])
    const data = getMowerSourceRuntime(state).data
    data.operators.Request = new MowerOperatorState({ name: 'Request', operatorType: 'high', restingPriority: 'high', mood: 12, timeStampMicros: 0 })
    expect(data.dorms[alphaFindDormSlot(data, 'Request', new Set())!]!.position).toEqual(['dormitory_2', 0])
    state.mowerShiftModel!.activate([false])
    expect(state.config.mowerDormOrder).toEqual(['dormitory_2', 'dormitory_1', 'dormitory_3', 'dormitory_4'])
    expect(workspace).toEqual(before)
  })

  it('allows native backup room and low priority changes when the caller supplies no legacy order', () => {
    const workspace = twoDormWorkspace()
    workspace.mainPlan.conf.dorm_order = 'dormitory_1,dormitory_2'
    workspace.compatibility.backupPlans = [{ trigger: 'True', conf: { dorm_order: 'dormitory_2_low,dormitory_2,dormitory_1', dorm_order_override: true } }]
    const schedule = compileRosterSchedule(workspace), config = compiledScheduleToRuntimeConfig(schedule); config.mowerAlpha = true
    const state = createRosterRuntime(config), controller = createBackupPlanController(schedule, state)
    controller.evaluate('END')
    expect(controller.active).toEqual([true])
    expect(state.config.mowerDormOrder).toEqual(['dormitory_2_low', 'dormitory_2', 'dormitory_1', 'dormitory_3', 'dormitory_4'])
    const data = getMowerSourceRuntime(state).data
    data.operators.Request = new MowerOperatorState({ name: 'Request', operatorType: 'high', restingPriority: 'high', mood: 12, timeStampMicros: 0 })
    expect(data.dorms[alphaFindDormSlot(data, 'Request', new Set())!]!.position).toEqual(['dormitory_2', 1])
    state.mowerShiftModel!.activate([false])
    expect(state.config.mowerDormOrder).toEqual(['dormitory_1', 'dormitory_2', 'dormitory_3', 'dormitory_4'])
  })
})
