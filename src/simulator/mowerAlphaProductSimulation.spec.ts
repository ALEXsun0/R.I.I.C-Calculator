import { describe, expect, it } from 'vitest'
import { createDefaultWorkspace } from '../workbench/defaults'
import { compileRosterSchedule } from '../scheduler/compileRosterSchedule'
import { simulateSchedule } from './scheduleSimulation'

function scheduleForSwitch(trigger: string, source = 'fragment', target = 'exp3') {
  const workspace = createDefaultWorkspace()
  for (const room of Object.values(workspace.mainPlan.facilities)) { room.level = 0; room.slots = [] }
  const room = workspace.mainPlan.facilities.room_1_1
  room.level = 3; room.product = (source === 'orirock_device' ? 'fragment' : source) as typeof room.product
  if (source === 'orirock_device') workspace.compatibility.facilityMetadata = { room_1_1: { rawProduct: source } }
  room.slots = [{ occupant: { kind: 'operator', operatorId: 'char_123_fang' }, groupId: null, replacements: [] }]
  workspace.mainPlan.conf.workaholic = ['char_123_fang']
  workspace.compatibility.unrecognizedFields.advanced_settings = { product_switching: { enable: true, use_drones_when_leaving_orirock: false, waiting_seconds: 0 } }
  workspace.compatibility.backupPlans = [{ name: 'product', trigger, plan: { room_1_1: { product: target, plans: [] } } }]
  return compileRosterSchedule(workspace)
}

describe.each(['mower-default', 'mower-alpha'] as const)('backup product overlay through the complete %s simulation', schedulingModel => {
  it('finishes the old unit then counts the new product without retroactively relabeling output', () => {
    const schedule = scheduleForSwitch("op_data.operators['芬'].current_mood() < 23.5")
    const report = simulateSchedule(schedule, { schedulingModel, sampleHours: 8, consumptionOverrides: { char_123_fang: 1 }, production: { droneTarget: 'none', inventoryMode: 'unlimited' } })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    const production = report.production!
    const change = production.events.find(event => event.type === 'product-switched')!
    expect(change).toMatchObject({ roomId: 'room_1_1', fromProduct: 'orirock', toProduct: 'exp3' })
    const activated = report.events.find(event => event.type === 'backup-plan' && event.active)!
    expect(change.time).toBeGreaterThan(activated.time)
    expect(change.time - activated.time).toBeLessThan(1)
    expect(production.materialsConsumed.orirock).toBe(8)
    expect(production.ledger.balances.fragment).toBe(4)
    expect(production.sample.completed.exp).toBe(1000)
    expect(production.sample.completed.gold).toBe(0)
    expect(production.manufacturing[0]!.completedItems).toBe(5)
  })

  it('uses the initially configured recipe even when a backup is already active at the first tick', () => {
    const report = simulateSchedule(scheduleForSwitch('True'), { schedulingModel, sampleHours: 4, production: { droneTarget: 'none' } })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    expect(report.production!.events.find(event => event.type === 'product-switched')).toMatchObject({ fromProduct: 'orirock', toProduct: 'exp3' })
    expect(report.production!.materialsConsumed.orirock).toBe(2)
    expect(report.production!.sample.completed.exp).toBe(1000)
  })

  it.each([
    ['orirock_device', 'orirock'],
    ['fragment', 'orirock_device'],
  ])('switches the raw fragment recipe from %s to %s', (source, target) => {
    const report = simulateSchedule(scheduleForSwitch("op_data.operators['芬'].current_mood() < 23.5", source, target), {
      schedulingModel, sampleHours: 5, consumptionOverrides: { char_123_fang: 1 },
      production: { droneTarget: 'none', inventoryMode: 'unlimited' },
    })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    expect(report.production!.events.find(event => event.type === 'product-switched')).toMatchObject({
      fromProduct: source === 'fragment' ? 'orirock' : source, toProduct: target,
    })
    expect(report.production!.materialsConsumed.orirock).toBeGreaterThan(0)
    expect(report.production!.materialsConsumed.device).toBeGreaterThan(0)
  })

})

describe('alpha shift-preview product activation', () => {
  it('projects a backup product activated by the planned rest state', () => {
    const workspace = createDefaultWorkspace()
    for (const room of Object.values(workspace.mainPlan.facilities)) { room.level = 0; room.slots = [] }
    const room = workspace.mainPlan.facilities.room_1_1
    room.level = 3; room.product = 'gold'
    room.slots = [{ occupant: { kind: 'operator', operatorId: 'char_123_fang' }, groupId: 'A', replacements: ['char_240_wyvern'] }]
    const dorm = workspace.mainPlan.facilities.dormitory_1
    dorm.level = 1; dorm.slots = Array.from({ length: 5 }, () => ({ occupant: { kind: 'free' as const }, groupId: null, replacements: [] }))
    workspace.compatibility.unrecognizedFields.advanced_settings = { product_switching: { enable: true, waiting_seconds: 0 } }
    workspace.compatibility.backupPlans = [{ name: 'rest-product', trigger: "op_data.operators['芬'].is_resting()", plan: { room_1_1: { product: 'exp3', plans: [] } } }]
    const schedule = compileRosterSchedule(workspace, { initialMorale: 12 })
    const report = simulateSchedule(schedule, { schedulingModel: 'mower-alpha', sampleHours: 4, recoveryOverrides: { char_123_fang: 1 }, production: { droneTarget: 'none', inventoryMode: 'unlimited' } })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    expect(report.events.some(event => event.type === 'backup-plan' && event.active)).toBe(true)
    expect(report.production!.events.find(event => event.type === 'product-switched')).toMatchObject({ fromProduct: 'gold', toProduct: 'exp3' })
  })
})
