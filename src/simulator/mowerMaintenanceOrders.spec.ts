import { describe, expect, it } from 'vitest'
import { createDefaultWorkspace } from '../workbench/defaults'
import { compileRosterSchedule } from '../scheduler/compileRosterSchedule'
import { simulateSchedule } from './scheduleSimulation'

function schedule(maintenance: boolean) {
  const workspace = createDefaultWorkspace()
  for (const [room, primary, replacements] of [
    ['room_1_1', '芬', ['龙舌兰', '香草']], ['room_1_2', '阿罗玛', ['但书']],
  ] as const) {
    const facility = workspace.mainPlan.facilities[room]
    facility.type = 'trading'; facility.level = 1; facility.product = 'money'
    facility.slots = [{ occupant: { kind: 'operator', operatorId: primary }, groupId: null, replacements: [...replacements] }]
  }
  workspace.mainPlan.conf.workaholic = ['芬', '阿罗玛']
  if (maintenance) workspace.compatibility.backupPlans = [{
    trigger: 'op_data.major_maintenance_remaining_hours() <= 2',
    plan: { room_1_1: { plans: [{ agent: '龙舌兰', group: '', replacement: ['芬'] }] } },
    conf: { workaholic: '龙舌兰' },
  }]
  return compileRosterSchedule(workspace, { majorMaintenanceStartHours: 5, idleOperators: [] })
}

describe('maintenance pause in the production simulation', () => {
  it('keeps prior captured rewards, pauses future ideal conversions globally and resumes after exit', () => {
    const compiled = schedule(true), original = structuredClone(compiled)
    const report = simulateSchedule(compiled, { sampleHours: 8.5, recordSegments: true,
      production: { runOrderMode: 'ideal', droneTarget: 'none', inventoryMode: 'finite', initialResources: { gold: 0 }, collectionIntervalHours: 0 },
    })
    expect(report.success, JSON.stringify(report.diagnostics)).toBe(true)
    const events = report.production!.events
    const activation = report.events.find(event => event.type === 'backup-plan' && event.active)!.time
    const exit = report.events.find(event => event.type === 'backup-plan' && !event.active)!.time
    expect(activation).toBeGreaterThanOrEqual(3); expect(activation).toBeLessThan(5)
    expect(exit).toBeGreaterThanOrEqual(5); expect(exit).toBeLessThan(7)
    const orders = events.filter(event => event.type === 'order-completed' && event.roomId === 'room_1_2')
    expect(orders.filter(event => event.time < activation).every(event => event.order!.kind === 'proviso')).toBe(true)
    expect(orders.some(event => event.time < activation)).toBe(true)
    expect(orders.filter(event => event.time >= activation && event.time < exit).every(event => event.order!.kind === 'gold')).toBe(true)
    expect(orders.some(event => event.time >= activation && event.time < exit)).toBe(true)
    expect(orders.filter(event => event.time >= exit).every(event => event.order!.kind === 'proviso')).toBe(true)
    expect(orders.some(event => event.time >= exit)).toBe(true)
    expect(events.some(event => event.type === 'run-order-ideal' && event.time >= activation && event.time < exit)).toBe(false)
    const pending = report.production!.trading.find(room => room.roomId === 'room_1_2')!.pendingOrders
    expect(pending.map(order => order.kind)).toEqual(orders.map(event => event.order!.kind))
    expect(report.production!.ledger.inflows.lmd ?? 0).toBe(0)
    expect(report.production!.drones.consumed).toBe(0)
    expect(compiled).toEqual(original)
  }, 30000)

  it('retains ideal conversions for the unchanged non-maintenance scenario', () => {
    const report = simulateSchedule(schedule(false), { sampleHours: 8.5,
      production: { runOrderMode: 'ideal', droneTarget: 'none', inventoryMode: 'finite', initialResources: { gold: 0 } },
    })
    expect(report.success).toBe(true)
    const orders = report.production!.events.filter(event => event.type === 'order-completed' && event.roomId === 'room_1_2')
    expect(orders).toHaveLength(3)
    expect(orders.every(event => event.order!.kind === 'proviso')).toBe(true)
  }, 30000)
})
