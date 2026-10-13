import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import { createDefaultWorkspace } from './defaults'
import { promoteMowerAlphaWorkspace } from './migrate'
import { exportMowerJson } from './compat/mowerJson'

describe('stored pre-alpha workspace promotion', () => {
  it('promotes opaque bindings, native conf lists and device recipes without resetting local editing data', () => {
    const workspace = createDefaultWorkspace()
    workspace.name = 'my workspace'
    const room = workspace.mainPlan.facilities.room_1_1
    room.level = 2
    room.product = undefined
    room.slots = [{ occupant: { kind: 'operator', operatorId: 'char_002_amiya' }, groupId: 'A', replacements: [], metadata: { group_bindings: [{ group: 'B', replacement: ['德克萨斯'], extra: 7 }], custom: true } }]
    Object.assign(workspace.mainPlan.conf, { free_blacklist: '阿米娅，未知干员' })
    workspace.compatibility.facilityMetadata = { room_1_1: { rawProduct: 'orirock_device', other: 1 } }
    promoteMowerAlphaWorkspace(workspace)
    expect(room.level).toBe(2)
    expect(room.product).toBe('fragment')
    expect(room.slots[0]!.groupBindings).toEqual([{ groupId: 'B', replacements: ['char_102_texas'], metadata: { extra: 7 } }])
    expect(room.slots[0]!.metadata).toEqual({ custom: true })
    expect(workspace.mainPlan.conf.free_blacklist).toEqual(['char_002_amiya', '未知干员'])
    expect(workspace.name).toBe('my workspace')
    expect(JSON.parse(exportMowerJson(workspace)).plan1.room_1_1.product).toBe('orirock_device')
    const before = structuredClone(workspace)
    promoteMowerAlphaWorkspace(workspace)
    expect(workspace).toEqual(before)
  })

  it('migrates old settings and retires rescue backups while preserving source recovery copies', () => {
    const workspace = createDefaultWorkspace()
    workspace.compatibility.unrecognizedFields.advanced_settings = { dorm_order: 'dormitory_4', free_room: true }
    workspace.compatibility.backupPlans = [{ name: 'retired', trigger: 'op_data.rescue_needed()' }, { name: 'active', trigger_timing: 'END' }]
    promoteMowerAlphaWorkspace(workspace)
    expect(workspace.compatibility.backupPlans).toEqual([{ name: 'active' }])
    expect(workspace.compatibility.retiredBackupPlans).toHaveLength(1)
    expect(workspace.mainPlan.conf.dorm_order).toBe('dormitory_4,dormitory_1,dormitory_2,dormitory_3')
    expect(workspace.compatibility.unrecognizedFields.advanced_settings).toEqual({ free_room: true })
    const before = structuredClone(workspace)
    promoteMowerAlphaWorkspace(workspace)
    expect(workspace).toEqual(before)
  })

  it('accepts the reactive workspace used by the workbench store', () => {
    const workspace = reactive(createDefaultWorkspace())
    Object.assign(workspace.mainPlan.conf, { free_blacklist: '阿米娅' })
    expect(() => promoteMowerAlphaWorkspace(workspace)).not.toThrow()
    expect(workspace.mainPlan.conf.free_blacklist).toEqual(['char_002_amiya'])
  })

  it('retains malformed opaque bindings so a bad extension cannot prevent workspace recovery', () => {
    const workspace = createDefaultWorkspace()
    workspace.mainPlan.facilities.central.slots[0]!.metadata = { group_bindings: [{ replacement: 'not-array' }] }
    promoteMowerAlphaWorkspace(workspace)
    expect(workspace.mainPlan.facilities.central.slots[0]!.metadata?.group_bindings).toEqual([{ replacement: 'not-array' }])
    expect(workspace.compatibility.migrationWarnings).toHaveLength(1)
  })
})
