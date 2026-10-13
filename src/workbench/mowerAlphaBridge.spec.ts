import {afterEach, describe, expect, it, vi} from 'vitest'
import {createDefaultWorkspace} from './defaults'
import {exportMowerJson, importMowerJson} from './compat/mowerJson'
import {runScheduleSimulationBridge} from './scheduleSimulationBridge'
import {resolveOperatorCharId as id} from '../domain/operatorIdentifiers'
import * as runtime from '../scheduler/rosterRuntime'
import {getMowerSourceRuntime} from '../scheduler/mowerSourceRuntime'

function workspace() {
  const ws = createDefaultWorkspace()
  ws.mainPlan.facilities.room_1_1.slots = [{occupant: {kind: 'operator', operatorId: id('芬')}, groupId: null, replacements: [id('香草')]}]
  ws.mainPlan.facilities.dormitory_1.slots = Array.from({length: 5}, () => ({occupant: {kind: 'free' as const}, groupId: null, replacements: []}))
  return ws
}

afterEach(() => vi.restoreAllMocks())
describe('workbench bridge consumes current Mower alpha contracts', () => {
  it('activates and exits a backup through the default bridge without resetting physical occupancy', () => {
    const ws = workspace(), before = structuredClone(ws)
    ws.mainPlan.conf.resting_priority = [id('芬')]
    ws.compatibility.backupPlans = [{name: 'mood interval', trigger: "op_data.operators['芬'].current_mood() > 23.999", conf: {removed_operators: {resting_priority: '芬'}}}]
    const createRuntime = runtime.createRosterRuntime
    const create = vi.spyOn(runtime, 'createRosterRuntime').mockImplementation(config => {
      const state = createRuntime(config)
      // Seed the observed 1/hour depletion; a fresh Mower session learns it after a later room read.
      const operator = getMowerSourceRuntime(state).data.operators[id('芬')]!
      operator.depletionRate = 1
      operator.timeStampMicros = 0
      return state
    })
    const result = runScheduleSimulationBridge(ws, {sampleHours: .01, recordSegments: true}, {idleOperators: []})
    expect(result.error).toBeUndefined()
    expect(result.report?.success).toBe(true)
    expect(result.report?.assumptions.schedulingModel).toBe('mower-alpha')
    expect(result.report?.events.filter(event => event.type === 'backup-plan').map(event => event.active)).toEqual([true, false])
    const state = create.mock.results[0]!.value as runtime.RuntimeState
    expect(state.config.mowerSourceRules?.lowPriority).toEqual([id('芬')])
    expect(state.occupants.room_1_1_0).toBe(id('芬'))
    expect(result.report?.segments.every(segment => segment.occupants.room_1_1_0 === id('芬'))).toBe(true)
    expect(ws.mainPlan.facilities).toEqual(before.mainPlan.facilities)
  })

  it('imports all shared group bindings into the live scheduling data', () => {
    const ws = workspace()
    ws.mainPlan.facilities.room_1_1.slots[0]!.groupId = 'first'
    ws.mainPlan.facilities.room_1_1.slots[0]!.groupBindings = [{groupId: 'second', replacements: [id('翎羽')]}]
    ws.mainPlan.facilities.room_1_2.slots = [{occupant: {kind: 'operator', operatorId: id('砾')}, groupId: 'first', replacements: [id('安德切尔')]}]
    ws.mainPlan.facilities.room_2_1.slots = [{occupant: {kind: 'operator', operatorId: id('玫兰莎')}, groupId: 'second', replacements: [id('克洛丝')]}]
    ws.mainPlan.facilities.dormitory_1.slots[0] = {occupant: {kind: 'operator', operatorId: id('杜林')}, groupId: null, replacements: []}
    ws.mainPlan.facilities.dormitory_1.slots[1] = {occupant: {kind: 'operator', operatorId: id('Lancet-2')}, groupId: null, replacements: []}
    const imported = importMowerJson(exportMowerJson(ws))
    const create = vi.spyOn(runtime, 'createRosterRuntime')
    const result = runScheduleSimulationBridge(imported, {sampleHours: .001}, {idleOperators: []})
    expect(result.error).toBeUndefined()
    expect(result.report?.success).toBe(true)
    const state = create.mock.results[0]!.value as runtime.RuntimeState
    const data = getMowerSourceRuntime(state).data
    expect(data.operators[id('芬')]?.groupBindings).toEqual([{group: 'first', replacement: [id('香草')]}, {group: 'second', replacement: [id('翎羽')]}])
    expect(data.operators[id('翎羽')]).toBeDefined()
  })

  it('passes advanced group thresholds and recovery exclusions through to the live runtime', () => {
    const ws = workspace()
    ws.compatibility.unrecognizedFields.advanced_settings = {group_mood_gap_threshold_minutes: 17, group_mood_gap_max_extra_wait_hours: 2, free_room: true, resting_threshold: .4}
    ws.mainPlan.conf.resting_priority_replacement = [id('香草')]
    ws.mainPlan.conf.free_room_exclusions = [id('芬')]
    const create = vi.spyOn(runtime, 'createRosterRuntime')
    const result = runScheduleSimulationBridge(ws, {sampleHours: .001}, {idleOperators: []})
    expect(result.error).toBeUndefined()
    expect(result.report?.success).toBe(true)
    const state = create.mock.results[0]!.value as runtime.RuntimeState
    expect(state.config.mowerPolicy).toMatchObject({groupMoodGapThresholdMinutes: 17, groupMoodGapMaxExtraWaitHours: 2, freeRoom: true, restingThreshold: .4})
    expect(state.config.mowerSourceRules).toMatchObject({priorityReplacement: [id('香草')], freeRoomExclusions: [id('芬')]})
  })
})
