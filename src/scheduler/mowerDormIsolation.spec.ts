import nativeOracle from './fixtures/mower-dorm-isolation-20261013.json'
import {projectScheduleState} from '../simulator/scheduleSimulation'
import {buildRiicGlobalContext} from '../engine/globalContext'
import {evaluateOperators} from '../engine/operatorRules'
import {evaluateDormitoryRecovery} from '../engine/dormitoryRecovery'
import {mowerDormRoommates, mowerDormIsolationCost, planMowerDormIsolation} from './mowerDormIsolation'
import {projectMowerArrangements} from './mowerObservations'
import {mowerAlphaFillPlan} from './mowerAlphaCandidates'
import {prepareMowerShiftCycle, type MowerShiftModel} from './mowerShiftCycle'
import {MowerTask, MowerTaskQueue, MOWER_TASK_TYPES as T} from './mowerTaskQueue'
import {createBackupPlanController} from './backupPlans'
import {describe, expect, it} from 'vitest'
import {MowerSchedulingData, MowerDormState} from './mowerSchedulingData'
import {MowerOperatorState} from './mowerOperatorState'
import {alphaFindDormSlot} from './mowerAlphaDorm'
import {mowerAssignDormGroup} from './mowerDormAssignment'
import {createDefaultWorkspace} from '../workbench/defaults'
import {compileRosterSchedule} from './compileRosterSchedule'
import {compiledScheduleToRuntimeConfig} from './scheduleAdapter'
import {createRosterRuntime} from './rosterRuntime'
import {getMowerSourceRuntime} from './mowerSourceRuntime'
import {resolveOperatorCharId as id} from '../domain/operatorIdentifiers'

function fixture() {
  const operators: Record<string, MowerOperatorState> = {}
  for (const name of ['A', 'B', 'C', 'D']) operators[name] = new MowerOperatorState({name, mood: 10, timeStampMicros: 0})
  const data = new MowerSchedulingData({alpha: true, nowMicros: 0, operators,
    plan: {dormitory_1: ['Free', 'Free', 'Free'], dormitory_2: ['Free', 'Free', 'Free']},
    dorms: [1, 2].flatMap(room => [0, 1, 2].map(index => new MowerDormState([`dormitory_${room}`, index]))),
  })
  data.dormIsolation = [['A', 'B']]
  return data
}

describe('Mower alpha dormitory isolation', () => {
  it('prefers an equally available bed away from the same isolation group', () => {
    const data = fixture()
    Object.assign(data.operators.A!, {currentRoom: 'dormitory_1', currentIndex: 0})
    data.dorms[0]!.name = 'A'
    expect(alphaFindDormSlot(data, 'B', new Set())).toBe(4)
  })

  it('includes pending group admissions without committing partial reservations', () => {
    const data = fixture()
    const assigned = mowerAssignDormGroup(data, ['A', 'B'])!
    expect(new Set(assigned.map(bed => bed.position[0])).size).toBe(2)
    expect(data.operators.A!.currentRoom).toBe('')
    expect(data.operators.B!.currentRoom).toBe('')
  })

  it('passes the imported advanced isolation groups to the native runtime', () => {
    const workspace = createDefaultWorkspace()
    workspace.compatibility.unrecognizedFields.advanced_settings = {dorm_isolation: [['电弧', '逻各斯']]}
    const schedule = compileRosterSchedule(workspace)
    const config = compiledScheduleToRuntimeConfig(schedule)
    config.mowerAlpha = true
    const state = createRosterRuntime(config)
    expect(getMowerSourceRuntime(state).data.dormIsolation).toEqual([[id('电弧'), id('逻各斯')]])
    workspace.compatibility.backupPlans = [{trigger: 'False', conf: {workaholic: '芬'}}]
    const base = compileRosterSchedule(workspace), nextConfig = compiledScheduleToRuntimeConfig(base)
    nextConfig.mowerAlpha = true
    const nextState = createRosterRuntime(nextConfig)
    createBackupPlanController(base, nextState)
    nextState.mowerShiftModel!.activate([true])
    expect(getMowerSourceRuntime(nextState).data.dormIsolation).toEqual(config.mowerDormIsolation)
    nextState.mowerShiftModel!.activate([false])
    expect(getMowerSourceRuntime(nextState).data.dormIsolation).toEqual(config.mowerDormIsolation)
  })
  it('counts reservations but excludes an operator explicitly moving out of the dormitory', () => {
    const data = fixture()
    Object.assign(data.operators.A!, {currentRoom: 'dormitory_1', currentIndex: 0})
    data.dorms[1]!.name = 'C'
    expect(mowerDormRoommates(data, 'dormitory_1')).toEqual(['A', 'C'])
    expect(mowerDormIsolationCost(data, 'B', 'dormitory_1', 2)).toBe(1)
    expect(mowerDormIsolationCost(data, 'B', 'dormitory_1', 2, {room_1_1: ['A']})).toBe(0)
  })

  it('preserves recovery priority and admits same-group roommates when no equal option exists', () => {
    const data = fixture()
    Object.assign(data.operators.A!, {currentRoom: 'dormitory_1', currentIndex: 0})
    data.dorms[0]!.name = 'A'
    expect(alphaFindDormSlot(data, 'B', new Set([3, 4, 5]))).toBe(1)
    data.dormOrder = ['dormitory_1_low', 'dormitory_2']
    expect(alphaFindDormSlot(data, 'B', new Set())).toBe(1)
  })

  it('swaps equal-tier new arrivals while preserving established residents and first recovery beds', () => {
    const data = fixture()
    Object.assign(data.operators.A!, {currentRoom: 'dormitory_1', currentIndex: 0})
    data.dorms[0]!.name = 'A'
    const plan = {dormitory_1: ['Current', 'B', 'Current'], dormitory_2: ['Current', 'C', 'Current']}
    const before = JSON.stringify(data)
    const isolated = planMowerDormIsolation(data, plan)
    expect(isolated).toEqual({dormitory_1: ['Current', 'C', 'Current'], dormitory_2: ['Current', 'B', 'Current']})
    expect(plan.dormitory_1[1]).toBe('B')
    expect(JSON.stringify(data)).toBe(before)
    expect(planMowerDormIsolation(data, {dormitory_1: ['B', 'Current', 'Current'], dormitory_2: ['Current', 'C', 'Current']})).toEqual({dormitory_1: ['B', 'Current', 'Current'], dormitory_2: ['Current', 'C', 'Current']})
    Object.assign(data.operators.B!, {currentRoom: 'dormitory_1', currentIndex: 1})
    data.dorms[1]!.name = 'B'
    expect(planMowerDormIsolation(data, plan)).toEqual(plan)
  })

  it('preserves reserved slots and does not exchange unequal tiers or explicit-order recovery keys', () => {
    const data = fixture()
    Object.assign(data.operators.A!, {currentRoom: 'dormitory_1', currentIndex: 0})
    data.dorms[0]!.name = 'A'
    const plan = {dormitory_1: ['Current', 'B', 'Current'], dormitory_2: ['Current', 'C', 'Current']}
    expect(planMowerDormIsolation(data, plan, new Set(['dormitory_1\0' + 1]))).toEqual(plan)
    data.reservedProductBeds.set('dormitory_1\0' + 1, 'B')
    expect(planMowerDormIsolation(data, plan)).toEqual(plan)
    data.reservedProductBeds.clear()
    data.operators.B!.operatorType = 'high'
    data.operators.B!.restingPriority = 'high'
    expect(planMowerDormIsolation(data, plan)).toEqual(plan)
    data.operators.B!.operatorType = 'low'
    data.dormOrder = ['dormitory_1_low', 'dormitory_2_low']
    data.operators.C!.mood = 11
    expect(planMowerDormIsolation(data, plan)).toEqual(plan)
    data.operators.C!.mood = 10
    expect(planMowerDormIsolation(data, plan).dormitory_2?.[1]).toBe('B')
  })

  it('applies isolation to fill plans and protected shift preparation without changing live occupancy', () => {
    const data = fixture()
    Object.assign(data.operators.A!, {currentRoom: 'dormitory_1', currentIndex: 0})
    data.dorms[0]!.name = 'A'
    data.dorms[3]!.name = 'D'
    Object.assign(data.operators.D!, {currentRoom: 'dormitory_2', currentIndex: 0})
    const fill = mowerAlphaFillPlan(data, [])
    const projected = projectMowerArrangements(data, [fill])
    expect(projected.operators.B!.currentRoom).toBe('dormitory_2')
    const task = new MowerTask({type: T.FILL_DORM, plan: {dormitory_1: ['Current', 'B', 'Current'], dormitory_2: ['Current', 'C', 'Current']}})
    task.productShiftLocked = true
    const queue = new MowerTaskQueue(); queue.tasks = [task]
    const model: MowerShiftModel = {count: 0, evaluate: () => [], swap: data => data, transition: () => ({}), activate: () => {}}
    prepareMowerShiftCycle(data, task, queue, model)
    expect(task.plan.dormitory_2?.[1]).toBe('B')
    expect(data.operators.B!.currentRoom).toBe('')
  })

  it.each([null, '电弧,逻各斯', [['不存在']], [1]])('rejects malformed or unknown isolation groups %j', dorm_isolation => {
    const workspace = createDefaultWorkspace()
    workspace.compatibility.unrecognizedFields.advanced_settings = {dorm_isolation}
    expect(compileRosterSchedule(workspace).diagnostics.some(d => d.severity === 'error' && d.path === 'assumptions.dormIsolation')).toBe(true)
  })

  it('updates Mantra elite-facility income from the actual isolated dormitory arrangement', () => {
    const workspace = createDefaultWorkspace()
    const free = () => ({occupant: {kind: 'free' as const}, groupId: null, replacements: []})
    const primary = (name: string) => ({occupant: {kind: 'operator' as const, operatorId: id(name)}, groupId: null, replacements: []})
    workspace.mainPlan.facilities.room_3_1.slots[0] = primary('真言')
    workspace.mainPlan.facilities.dormitory_1.slots = Array.from({length: 5}, free)
    workspace.mainPlan.facilities.dormitory_2.slots = Array.from({length: 5}, free)
    workspace.mainPlan.facilities.dormitory_1.slots[0] = primary('电弧')
    workspace.mainPlan.facilities.dormitory_2.slots[0] = primary('杜林')
    workspace.compatibility.unrecognizedFields.advanced_settings = {dorm_isolation: [['电弧', '逻各斯']]}
    const schedule = compileRosterSchedule(workspace, {idleOperators: ['逻各斯', '芬'], initialMorale: 10})
    const config = compiledScheduleToRuntimeConfig(schedule); config.mowerAlpha = true
    const state = createRosterRuntime(config), data = getMowerSourceRuntime(state).data
    // The native adapter obtains these physical positions at the first room read.
    for (const [name, room, index] of [['电弧', 'dormitory_1', 0], ['杜林', 'dormitory_2', 0], ['真言', 'room_3_1', 0]] as const) Object.assign(data.operators[id(name)]!, {currentRoom: room, currentIndex: index})
    const plan = {dormitory_1: ['Current', 'Current', id('逻各斯'), 'Current', 'Current'], dormitory_2: ['Current', 'Current', id('芬'), 'Current', 'Current']}
    const isolated = planMowerDormIsolation(data, plan)
    expect(isolated.dormitory_2?.[2]).toBe(id('逻各斯'))
    const project = (arrangement: typeof plan) => {
      const next = projectMowerArrangements(data, [arrangement])
      const occupants = Object.fromEntries(Object.values(next.operators).filter(op => op.currentRoom).map(op => [`${op.currentRoom}_${op.currentIndex}`, op.name]))
      return projectScheduleState(schedule, {...state, occupants, bedOccupants: {}})
    }
    const before = project(plan), after = project(isolated as typeof plan)
    expect(buildRiicGlobalContext(after).eliteFacilities - buildRiicGlobalContext(before).eliteFacilities).toBe(1)
    const trade = (c: typeof after) => evaluateOperators(c.rooms.find(room => room.id === 'room_3_1')!, c).efficiencyPercent
    expect(trade(after) - trade(before)).toBe(2)
    const morale = new Map([[id('逻各斯'), 10]])
    const recovery = evaluateDormitoryRecovery(after, 1, morale, 0)
    expect(recovery.rates.get(id('逻各斯'))).toBeGreaterThan(0)
    expect(evaluateDormitoryRecovery(after, 0, morale, 0).rates.has(id('逻各斯'))).toBe(false)
  })

  it.each(nativeOracle.cases)('matches unchanged Python isolation: $name', test => {
    const data = fixture()
    Object.assign(data.operators.A!, {currentRoom: 'dormitory_1', currentIndex: 0})
    data.dorms[0]!.name = 'A'
    const options = test.options as {residentB?: boolean; priorityB?: boolean; explicitOrder?: boolean; moodC?: number; productReserved?: boolean; reserved?: [string, number][]}
    if (options.residentB) {Object.assign(data.operators.B!, {currentRoom: 'dormitory_1', currentIndex: 1}); data.dorms[1]!.name = 'B'}
    if (options.priorityB) {data.operators.B!.operatorType = 'high'; data.operators.B!.restingPriority = 'high'}
    if (options.explicitOrder) data.dormOrder = ['dormitory_1_low', 'dormitory_2_low']
    if (options.productReserved) data.reservedProductBeds.set('dormitory_1\0' + 1, 'B')
    data.operators.C!.mood = options.moodC ?? 10
    expect(planMowerDormIsolation(data, test.input, new Set(options.reserved?.map(([room, index]) => room + '\0' + index)))).toEqual(test.expected)
  })

})
