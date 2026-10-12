import { describe, it, expect } from 'vitest'
import { createDefaultWorkspace } from './defaults'
import { MOWER_OUTPUT_ROOM_IDS } from '../domain/roster'

describe('createDefaultWorkspace', () => {
  it('creates schema-v8 workspace with 22 valid rooms, an unbuilt recycling station and clean envelope', () => {
    const ws = createDefaultWorkspace()
    expect(ws.schemaVersion).toBe(8)
    expect(ws.name).toBe('默认排班')
    expect(ws.mainPlan.id).toBe('plan1')
    expect(Object.keys(ws.mainPlan.facilities)).toHaveLength(22)
    expect(Object.keys(ws.mainPlan.facilities).filter(id => id !== 'recycle')).toEqual([
      ...MOWER_OUTPUT_ROOM_IDS,
      'central', 'dormitory_1', 'dormitory_2', 'dormitory_3', 'dormitory_4',
      'meeting', 'factory', 'contact', 'train',
      'gaming_1', 'gaming_2', 'gaming_3',
    ])
    expect(ws.mainPlan.facilities.recycle).toEqual({ roomId: 'recycle', type: 'recycle', level: 0, slots: [] })
    expect(MOWER_OUTPUT_ROOM_IDS.every((id) => ws.mainPlan.facilities[id] !== undefined)).toBe(true)
    expect(ws.mainPlan.conf.ling_xi).toBe(1)
    expect(ws.mainPlan.conf.exhaust_require).toEqual([])
    expect(ws.mainPlan.conf.rest_in_full).toEqual([])
    expect(ws.mainPlan.conf.resting_priority).toEqual([])
    expect(ws.mainPlan.conf.workaholic).toEqual([])
    expect(ws.mainPlan.conf.refresh_trading).toEqual([])
    expect(ws.mainPlan.conf.refresh_drained).toEqual([])
    expect(ws.mainPlan.conf.ope_resting_priority).toEqual([])
    expect(ws.compatibility.backupPlans).toEqual([])
    expect(ws.compatibility.defaultPlanKey).toBe('plan1')
  })

  it('asserts all 7 Mower main policy list defaults are empty arrays', () => {
    const ws = createDefaultWorkspace()
    const { conf } = ws.mainPlan
    expect(conf.exhaust_require).toEqual([])
    expect(conf.rest_in_full).toEqual([])
    expect(conf.resting_priority).toEqual([])
    expect(conf.workaholic).toEqual([])
    expect(conf.refresh_trading).toEqual([])
    expect(conf.refresh_drained).toEqual([])
    expect(conf.ope_resting_priority).toEqual([])
  })

  it('initializes default 243 manufacture rooms with 2 gold and 2 exp', () => {
    const ws = createDefaultWorkspace()
    expect(ws.mainPlan.facilities.room_1_1.product).toBe('gold')
    expect(ws.mainPlan.facilities.room_1_2.product).toBe('gold')
    expect(ws.mainPlan.facilities.room_2_1.product).toBe('exp')
    expect(ws.mainPlan.facilities.room_2_2.product).toBe('exp')
  })
})
