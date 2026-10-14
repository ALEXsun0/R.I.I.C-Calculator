import { describe, expect, it } from 'vitest'
import { createDefaultWorkspace } from '../workbench/defaults'
import { compileRosterSchedule } from './compileRosterSchedule'
import { compiledScheduleToRuntimeConfig, createRosterRuntime } from './rosterRuntime'
import { createBackupPlanController } from './backupPlans'
import { getMowerSourceRuntime } from './mowerSourceRuntime'
import { MowerTask, MOWER_TASK_TYPES as T } from './mowerTaskQueue'

const maintenance = 'op_data.major_maintenance_remaining_hours() <= 0.5'
const overlay = (agent: string) => ({ room_1_1: { plans: [{ agent, group: '', replacement: agent === '龙舌兰' ? ['芬'] : ['龙舌兰', '香草'] }] } })
function setup(overrides: Record<string, unknown>[] = [], alpha = true) {
  const workspace = createDefaultWorkspace()
  for (const [room, primary, replacements] of [
    ['room_1_1', '芬', ['龙舌兰', '香草']], ['room_1_2', '阿罗玛', ['但书']],
  ] as const) {
    const facility = workspace.mainPlan.facilities[room]
    facility.type = 'trading'; facility.level = 1; facility.product = 'money'
    facility.slots = [{ occupant: { kind: 'operator', operatorId: primary }, groupId: null, replacements: [...replacements] }]
  }
  workspace.mainPlan.conf.workaholic = ['芬', '阿罗玛']
  workspace.compatibility.backupPlans = [{ trigger: maintenance, plan: overlay('龙舌兰'), conf: { workaholic: '龙舌兰' } }, ...overrides]
  const schedule = compileRosterSchedule(workspace, { majorMaintenanceStartHours: 1, idleOperators: [] })
  const config = compiledScheduleToRuntimeConfig(schedule); config.mowerAlpha = alpha
  const state = createRosterRuntime(config), controller = createBackupPlanController(schedule, state)
  return { workspace, state, controller }
}

describe('maintenance-primary ideal run-order pause', () => {
  it.each([false, true])('pauses every trade room on entry and restores effective candidates on exit, alpha=%s', alpha => {
    const { state, controller } = setup([], alpha)
    const original = structuredClone(state.config.runOrderPolicies)
    const source = getMowerSourceRuntime(state)
    const pending = new MowerTask({ time: .75, type: T.RUN_ORDER, metadata: 'room_1_2' })
    const refreshing = new MowerTask({ time: .75, type: T.REFRESH_TIME, metadata: 'room_1_1' })
    const unrelated = new MowerTask({ time: .8, type: T.SKILL_UPGRADE })
    source.queue.tasks.push(pending, refreshing, unrelated)
    state.time = .5; controller.evaluate('END')
    expect(controller.active).toEqual([true])
    expect(state.config.runOrderPolicies).toEqual([])
    expect(getMowerSourceRuntime(state).data.runOrderRooms).toEqual({})
    expect(source.queue.tasks).not.toContain(pending)
    expect(source.queue.tasks).not.toContain(refreshing)
    expect(source.queue.tasks).toContain(unrelated)
    state.time = 1; controller.evaluate('END')
    expect(controller.active).toEqual([false])
    expect(state.config.runOrderPolicies).toEqual(original)
    expect(Object.keys(getMowerSourceRuntime(state).data.runOrderRooms)).toEqual(['room_1_1', 'room_1_2'])
  })

  it('keeps a preceding maintenance identity through a later Current overlay', () => {
    const { state, controller } = setup([{ trigger: 'True', plan: overlay('Current') }])
    state.time = .5; controller.evaluate('END')
    expect(controller.active).toEqual([true, true])
    expect(state.config.runOrderPolicies).toEqual([])
  })

  it('clears the identity when a later ordinary overlay replaces that slot', () => {
    const { state, controller } = setup([{ trigger: 'True', plan: overlay('芬') }])
    state.time = .5; controller.evaluate('END')
    expect(controller.active).toEqual([true, true])
    expect(state.config.runOrderPolicies).toHaveLength(2)
    expect(Object.keys(getMowerSourceRuntime(state).data.runOrderRooms)).toHaveLength(2)
  })

  it('keeps paused real rooms unchanged when a return configuration is only previewed', () => {
    const { state, controller } = setup()
    state.time = .5; controller.evaluate('END')
    const source = getMowerSourceRuntime(state), paused = source.data
    expect(paused.runOrderRooms).toEqual({})
    const preview = state.mowerShiftModel!.swap(paused, [false])
    expect(Object.keys(preview.runOrderRooms)).toHaveLength(2)
    expect(state.config.runOrderPolicies).toEqual([])
    expect(source.data).toBe(paused)
    expect(paused.runOrderRooms).toEqual({})
  })

  it('leaves ordinary runner primaries and absent maintenance windows unchanged', () => {
    const { workspace } = setup()
    workspace.compatibility.backupPlans = [{ trigger: 'True', plan: overlay('龙舌兰'), conf: { workaholic: '龙舌兰' } }]
    const schedule = compileRosterSchedule(workspace), config = compiledScheduleToRuntimeConfig(schedule)
    config.mowerAlpha = true
    const state = createRosterRuntime(config), controller = createBackupPlanController(schedule, state)
    controller.evaluate('END')
    expect(state.config.runOrderPolicies).toHaveLength(1)
    expect(Object.keys(getMowerSourceRuntime(state).data.runOrderRooms)).toContain('room_1_2')
  })
})
