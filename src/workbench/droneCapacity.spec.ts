import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createDefaultConfig } from '../domain/defaults'
import { createDefaultWorkspace } from './defaults'
import { compileMainPlanToAppConfig } from './adapter'
import { useRosterWorkbenchStore } from './store'
import { migrateAppConfigToWorkspace } from './migrate'
import { exportMowerJson, importMowerJson } from './compat/mowerJson'
import { evaluateOperators } from '../engine/operatorRules'

describe('local drone storage capacity', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('defaults new calculations and native Mower imports to 250', () => {
    expect(createDefaultConfig().efficiencyResources.droneCapacity).toBe(250)
    const workspace = importMowerJson('{"default":"plan1","plan1":{}}')
    expect(compileMainPlanToAppConfig(workspace.mainPlan, workspace, createDefaultConfig()).efficiencyResources.droneCapacity).toBe(250)
  })

  it('uses the saved local choice ahead of legacy preserved resources without editing native export', () => {
    const legacy = createDefaultConfig()
    legacy.efficiencyResources.droneCapacity = 235
    const workspace = migrateAppConfigToWorkspace(legacy)
    const original = JSON.parse(exportMowerJson(workspace))
    const store = useRosterWorkbenchStore()
    store.loadWorkspace(workspace)
    store.setDroneCapacity(240)
    const saved = JSON.parse(JSON.stringify(store.workspace))
    store.loadWorkspace(saved)
    const compiled = compileMainPlanToAppConfig(store.workspace.mainPlan, store.workspace, createDefaultConfig())
    expect(compiled.efficiencyResources.droneCapacity).toBe(240)
    expect(JSON.parse(exportMowerJson(store.workspace))).toEqual(original)
    expect(legacy.efficiencyResources.droneCapacity).toBe(235)
  })

  it('retains existing explicit capacity when a workspace has no local override', () => {
    const existing = createDefaultConfig()
    existing.efficiencyResources.droneCapacity = 280
    const workspace = createDefaultWorkspace()
    expect(compileMainPlanToAppConfig(workspace.mainPlan, workspace, existing).efficiencyResources.droneCapacity).toBe(280)
    const migrated = migrateAppConfigToWorkspace(existing)
    expect(compileMainPlanToAppConfig(migrated.mainPlan, migrated, createDefaultConfig()).efficiencyResources.droneCapacity).toBe(280)
  })

  it('rejects invalid edits without changing the stored plan', () => {
    const store = useRosterWorkbenchStore()
    for (const capacity of [-1, 249.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const before = JSON.stringify(store.workspace)
      expect(() => store.setDroneCapacity(capacity)).toThrow(/无人机上限/)
      expect(JSON.stringify(store.workspace)).toBe(before)
    }
    store.setDroneCapacity(0)
    expect(store.workspace.droneCapacity).toBe(0)
  })

  it('feeds Greyy the Lightningbearer through the real calculation adapter and retains his 25% skill cap', () => {
    const workspace = createDefaultWorkspace()
    const power = workspace.mainPlan.facilities.room_1_3
    power.slots[0]!.occupant = { kind: 'operator', operatorId: 'char_1027_greyy2' }
    for (const [capacity, bonus] of [[235, 23], [240, 24], [250, 25], [300, 25]] as const) {
      workspace.droneCapacity = capacity
      const config = compileMainPlanToAppConfig(workspace.mainPlan, workspace, createDefaultConfig())
      const room = config.rooms.find(item => item.id === 'B103')!
      expect(evaluateOperators(room, config).skillBonus).toBe(bonus)
      config.zeroMoraleOperatorIds = ['char_1027_greyy2']
      expect(evaluateOperators(room, config).skillBonus).toBe(0)
    }
  })
})
