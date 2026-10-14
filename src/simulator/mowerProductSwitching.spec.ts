import { describe, expect, it } from 'vitest'
import { evaluateOperators } from '../engine/operatorRules'
import { createDefaultWorkspace } from '../workbench/defaults'
import { compileRosterSchedule } from '../scheduler/compileRosterSchedule'
import { compiledScheduleToRuntimeConfig } from '../scheduler/scheduleAdapter'
import { createRosterRuntime } from '../scheduler/rosterRuntime'
import { projectScheduleState } from './scheduleSimulation'
import { createProductionTimeline, type ProductionFrame, type ProductionOptions } from './productionTimeline'

function fixture(settings: Record<string, unknown> = {}, product = 'gold', initialDrones = 0, trade = false, production: ProductionOptions = {}) {
  const workspace = createDefaultWorkspace()
  workspace.compatibility.unrecognizedFields.advanced_settings = { product_switching: { enable: true, ...settings } }
  const schedule = compileRosterSchedule(workspace)
  schedule.rooms = schedule.rooms.filter(room => room.roomId === (trade ? 'room_3_1' : 'room_1_1'))
  schedule.rooms[0]!.product = product as typeof schedule.rooms[0]['product']
  const state = createRosterRuntime(compiledScheduleToRuntimeConfig(schedule))
  const config = projectScheduleState(schedule, state), roomId = schedule.rooms[0]!.roomId
  const frame: ProductionFrame = { time: 0, config, active: new Set<string>(), morale: new Map<string, number>(), evaluations: { [roomId]: evaluateOperators(config.rooms[0]!, config) }, desiredProducts: {} }
  const diagnostics: string[] = []
  const timeline = createProductionTimeline(schedule, state, { droneTarget: 'none', ...production, initialResources: { drone: initialDrones, ...production.initialResources } }, 0, code => diagnostics.push(code), true)
  const settle = () => { frame.time = state.time; timeline.settle(() => frame) }
  const advance = (hours: number) => { timeline.advance(hours, frame); state.time += hours; settle() }
  settle()
  return { timeline, frame, state, roomId, settle, advance, diagnostics }
}

describe('alpha product switching on the production clock', () => {
  it('shares stock between switching and later acceleration in the same room using the actual recipe', () => {
    const f = fixture({ grandet_mode: false, waiting_seconds: 0 }, 'gold', 100, false, { droneTarget: 'gold', droneRoomId: 'room_1_1' })
    f.frame.desiredProducts = { [f.roomId]: 'exp3' }; f.settle()
    expect(f.timeline.actualProducts()[f.roomId]).toBe('exp3')
    expect(f.timeline.report().drones.consumed).toBe(24)
    expect(f.timeline.report().sample.completed).toMatchObject({ gold: 1, exp: 0 })
    // Drone work is independent of the room's natural production efficiency.
    f.frame.evaluations[f.roomId]!.efficiencyPercent = 300
    f.timeline.nativeSpendManufacturingDrones(f.roomId, 60)
    f.settle()
    const report = f.timeline.report()
    expect(report.sample.completed).toMatchObject({ gold: 1, exp: 1000 })
    expect(report.drones).toMatchObject({ consumed: 84, stock: 16 })
    expect(report.ledger.outflows.drone).toBe(84)
    expect(report.ledger.balances.drone).toBe(16)
    expect(report.events.filter(event => event.roomId && ['product-switch-drone', 'native-manufacture-drone'].includes(event.type))).toMatchObject([
      { type: 'product-switch-drone', roomId: f.roomId, amount: 24 },
      { type: 'native-manufacture-drone', roomId: f.roomId, amount: 60 },
    ])
  })

  it('finishes one existing manufacturing unit before switching and preserves product accounting', () => {
    const f = fixture({ grandet_mode: true, use_drones_when_leaving_orirock: false, waiting_seconds: 0 }, 'fragment')
    f.advance(.5)
    f.frame.desiredProducts = { [f.roomId]: 'exp3' }; f.settle()
    expect(f.timeline.actualProducts()[f.roomId]).toBe('orirock')
    f.advance(.5)
    expect(f.timeline.actualProducts()[f.roomId]).toBe('exp3')
    expect(f.timeline.report().ledger.balances.fragment).toBe(1)
    f.advance(3)
    expect(f.timeline.report().sample.completed.exp).toBe(1000)
    expect(f.timeline.report().sample.completed.gold).toBe(0)
    expect(f.timeline.report().manufacturing[0]!.completedItems).toBe(2)
  })

  it('respects the drone loss allowance and debits each switch drone exactly once', () => {
    const f = fixture({ drone_loss_seconds: 30, waiting_seconds: 0 }, 'gold', 30)
    f.advance((72 - 5.5) / 60)
    f.frame.desiredProducts = { [f.roomId]: 'exp3' }; f.settle(); f.settle()
    expect(f.timeline.actualProducts()[f.roomId]).toBe('exp3')
    expect(f.timeline.report().drones.consumed).toBe(2)
    expect(f.timeline.report().ledger.outflows.drone).toBe(2)
    expect(f.timeline.report().sample.completed.gold).toBe(1)
    expect(f.timeline.report().events.find(event => event.type === 'product-switch-drone-loss')?.amount).toBeCloseTo(.5)
  })

  it('honors a per-switch drone cap once, then waits for the remaining work', () => {
    const f = fixture({ max_drones_per_switch: 1, waiting_seconds: 0 }, 'gold', 30)
    f.advance(1)
    f.frame.desiredProducts = { [f.roomId]: 'exp3' }; f.settle(); f.settle()
    expect(f.timeline.report().drones.consumed).toBe(1)
    expect(f.timeline.actualProducts()[f.roomId]).toBe('gold')
    f.advance(9 / 60)
    expect(f.timeline.actualProducts()[f.roomId]).toBe('exp3')
  })

  it('explicit direct switching discards unfinished work without inventing completed output', () => {
    const f = fixture({ direct_when_drones_insufficient: true }, 'gold')
    f.advance(.1)
    f.frame.desiredProducts = { [f.roomId]: 'exp3' }; f.settle()
    expect(f.timeline.actualProducts()[f.roomId]).toBe('exp3')
    expect(f.timeline.report().sample.completed.gold).toBe(0)
    expect(f.timeline.report().events.some(event => event.type === 'product-switch-cancelled-work')).toBe(true)
  })

  it('charges the device fragment recipe from finite stock and blocks the next unpaid unit', () => {
    const f = fixture({ grandet_mode: false }, 'gold', 100, false, { inventoryMode: 'finite', initialResources: { lmd: 1000, device: 1 } })
    f.advance(.1)
    f.frame.desiredProducts = { [f.roomId]: 'orirock_device' }; f.settle()
    expect(f.timeline.actualProducts()[f.roomId]).toBe('orirock_device')
    expect(f.timeline.report().materialsConsumed).toMatchObject({ lmd: 1000, device: 1 })
    expect(f.timeline.report().materialsConsumed.orirock).toBeUndefined()
    f.advance(1)
    expect(f.timeline.report().manufacturing[0]!.pendingItems).toBe(1)
    f.advance(.5)
    expect(f.timeline.report().manufacturing[0]!.blockedMaterialHours).toBeCloseTo(.5)
    expect(f.timeline.report().sample.completed.gold).toBe(1)
    expect(f.timeline.report().ledger.balances.device).toBe(0)
    expect(f.timeline.report().ledger.balances.lmd).toBe(0)
  })

  it('waits the configured confirmation buffer without starting another paid old unit', () => {
    const f = fixture({ grandet_mode: true, waiting_seconds: 2 }, 'gold', 100)
    f.frame.desiredProducts = { [f.roomId]: 'exp3' }; f.settle()
    expect(f.timeline.actualProducts()[f.roomId]).toBe('gold')
    expect(f.timeline.report().drones.consumed).toBe(24)
    f.advance(2 / 3600)
    expect(f.timeline.actualProducts()[f.roomId]).toBe('exp3')
    expect(f.timeline.report().sample.completed.gold).toBe(1)
  })

  it('leaves existing trade orders intact and applies a new strategy only to subsequent orders', () => {
    const f = fixture({}, 'money', 0, true)
    const oldRemaining = f.timeline.report().trading[0]!.remainingBaseMinutes!
    f.frame.desiredProducts = { [f.roomId]: 'orundum' }; f.settle()
    expect(f.timeline.actualProducts()[f.roomId]).toBe('orundum')
    expect(f.timeline.report().trading[0]!.remainingBaseMinutes).toBe(oldRemaining)
    f.advance(oldRemaining / 60)
    expect(f.timeline.report().events.find(event => event.type === 'order-completed')?.order?.lmdReward).toBeGreaterThan(0)
    const nextRemaining = f.timeline.report().trading[0]!.remainingBaseMinutes!
    f.advance(nextRemaining / 60)
    expect(f.timeline.report().events.filter(event => event.type === 'order-completed')[1]?.order?.orundumReward).toBeGreaterThan(0)
  })

  it('keeps the initial product when automatic switching is disabled', () => {
    const f = fixture({ enable: false }, 'gold', 100)
    f.frame.desiredProducts = { [f.roomId]: 'exp3' }; f.settle()
    expect(f.timeline.actualProducts()[f.roomId]).toBe('gold')
    expect(f.timeline.report().drones.consumed).toBe(0)
  })
})
