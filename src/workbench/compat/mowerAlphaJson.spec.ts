import { describe, expect, it } from 'vitest'
import { exportMowerJson, importMowerJson } from './mowerJson'
import { containsRetiredRescueCondition, migrateMowerAlphaDocument } from './mowerAlphaMigration'

const load = (fields: Record<string, unknown>) => importMowerJson(JSON.stringify({ default: 'plan1', plan1: {}, ...fields }))
const save = (fields: Record<string, unknown>) => JSON.parse(exportMowerJson(load(fields)))

describe('Mower alpha ab0a4e5 document compatibility', () => {
  it('resolves every additional conf operator list and emits native name strings', () => {
    const conf = Object.fromEntries(['resting_priority_replacement', 'free_room_exclusions', 'resting_standby', 'free_blacklist'].map(key => [key, '阿米娅，未知干员']))
    const workspace = load({ conf })
    for (const key of Object.keys(conf)) expect(workspace.mainPlan.conf[key]).toEqual(['char_002_amiya', '未知干员'])
    const exported = JSON.parse(exportMowerJson(workspace))
    for (const key of Object.keys(conf)) expect(exported.conf[key]).toBe('阿米娅,未知干员')
  })

  it('makes extra group bindings editable with IDs and preserves binding extensions', () => {
    const workspace = load({ plan1: { central: { plans: [{ agent: '阿米娅', group: 'first', replacement: ['德克萨斯'], group_bindings: [{ group: 'second', replacement: ['能天使', '未知干员'], color: 'custom' }, { group: '', replacement: [] }], custom: 7 }] } } })
    const slot = workspace.mainPlan.facilities.central.slots[0]!
    expect(slot.groupBindings).toEqual([{ groupId: 'second', replacements: ['char_103_angel', '未知干员'], metadata: { color: 'custom' } }, { groupId: null, replacements: [] }])
    slot.groupBindings![0]!.replacements = ['char_102_texas']
    const exported = JSON.parse(exportMowerJson(workspace))
    expect(exported.plan1.central.plans[0]).toMatchObject({ custom: 7, group_bindings: [{ group: 'second', replacement: ['德克萨斯'], color: 'custom' }, { group: '', replacement: [] }] })
  })

  it('keeps backup additions, removals, group columns and explicit empty order overrides', () => {
    const backups = [{ name: 'alpha', trigger: { left: 'True' }, plan: { recycle: { plans: [{ agent: '阿米娅', group_bindings: [{ group: 'B', replacement: ['能天使'] }] }] } }, task: { recycle: ['阿米娅', 'Current'] }, conf: { rest_in_full: '能天使', removed_operators: { rest_in_full: '阿米娅', refresh_trading: '但书@room_1_1' }, dorm_order: '', dorm_order_override: true, future_policy: 7 }, future_backup: true }]
    expect(save({ backup_plans: backups }).backup_plans).toEqual(backups)
  })

  it('migrates retired advanced settings while preserving other and unknown settings', () => {
    const exported = save({ advanced_settings: { dorm_order: 'dormitory_3_2,dormitory_2_low,dormitory_3_3', reload_room: 'room_1_1', experimental_dorm_logic: true, refresh_backup_plan_after_mood: true, workshop_low_priority_rest: true, free_room: true, product_switching: { custom: true }, future_setting: 3 } })
    expect(exported.conf.dorm_order).toBe('dormitory_3,dormitory_2_low,dormitory_1,dormitory_2,dormitory_4')
    expect(exported.advanced_settings).toEqual({ free_room: true, product_switching: { custom: true }, future_setting: 3 })
  })

  it('prefers current main dorm order and migrates legacy backup default and custom overrides', () => {
    const exported = save({ conf: { dorm_order: 'dormitory_2' }, advanced_settings: { dorm_order: 'dormitory_3' }, backup_plans: [{ conf: { dorm_order: 'dormitory_1,dormitory_2,dormitory_3,dormitory_4' } }, { conf: { dorm_order: 'dormitory_4_2' } }, { conf: { dorm_order: 'dormitory_4', dorm_order_override: false } }] })
    expect(exported.conf.dorm_order).toBe('dormitory_2,dormitory_1,dormitory_3,dormitory_4')
    expect(exported.backup_plans.map((p: { conf: unknown }) => p.conf)).toEqual([{ dorm_order: '', dorm_order_override: false }, { dorm_order: 'dormitory_4,dormitory_1,dormitory_2,dormitory_3', dorm_order_override: true }, { dorm_order: '', dorm_order_override: false }])
  })

  it('retires actual rescue calls but keeps quoted mentions and preserves retired originals locally', () => {
    const retired = { name: 'retired', trigger: { left: { left: 'op_data . rescue_needed ( )', operator: '==', right: 'True' }, operator: 'and', right: 'True' }, conf: { removed_operators: { rest_in_full: '阿米娅' } } }
    const literal = { name: 'literal', trigger: { left: '"op_data.rescue_needed()"', operator: '==', right: '"example"' } }
    const workspace = load({ backup_plans: [retired, literal, { name: 'normal', trigger: { left: 'True' }, trigger_timing: 'BEGINNING', exit_trigger_timing: 'END', future: 1 }] })
    expect(workspace.compatibility.backupPlans).toEqual([literal, { name: 'normal', trigger: { left: 'True' }, future: 1 }])
    expect(workspace.compatibility.retiredBackupPlans).toEqual([retired])
    expect(workspace.compatibility.migrationWarnings?.length).toBeGreaterThan(0)
    expect(JSON.parse(exportMowerJson(workspace)).backup_plans).toEqual(workspace.compatibility.backupPlans)
  })

  it('does not retire string literals, comments, attribute references or malformed calls', () => {
    for (const expression of ['"op_data.rescue_needed()"', "'op_data.rescue_needed()'", 'False # op_data.rescue_needed()', 'op_data.rescue_needed', 'other.op_data.rescue_needed()', 'op_data.rescue_needed(', "'op_data.rescue_needed()"])
      expect(containsRetiredRescueCondition(expression), expression).toBe(false)
    expect(containsRetiredRescueCondition('False or (op_data.rescue_needed())')).toBe(true)
  })

  it('leaves original source objects untouched during retirement', () => {
    const input = { backup_plans: [{ trigger: 'op_data.rescue_needed()', trigger_timing: 'END' }], advanced_settings: { reload_room: 'room_1_1' } }
    const original = structuredClone(input)
    migrateMowerAlphaDocument(input)
    expect(input).toEqual(original)
  })

  it('keeps the device fragment recipe distinct on export', () => {
    const workspace = load({ plan1: { room_1_1: { name: '制造站', plans: [], product: 'orirock_device' } } })
    expect(workspace.mainPlan.facilities.room_1_1.product).toBe('fragment')
    expect(workspace.compatibility.facilityMetadata?.room_1_1?.rawProduct).toBe('orirock_device')
    const exported = JSON.parse(exportMowerJson(workspace))
    expect(exported.plan1.room_1_1.product).toBe('orirock_device')
  })
})
