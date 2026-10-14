import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../domain/defaults'
import { resolveOperatorCharId as id } from '../domain/operatorIdentifiers'
import { compileOperatorInventory } from '../domain/operatorInventory'
import { inventoryOperatorRecords } from '../domain/operatorContext'
import { OPERATOR_MAP } from '../domain/operators'
import { evaluateOperators, formatStructuredContributions } from './operatorRules'
import { buildRiicGlobalContext } from './globalContext'

const hunters = ['斯卡蒂', '乌尔比安', '安哲拉', '幽灵鲨']

function scenario() {
  const config = createDefaultConfig()
  config.controlOperatorIds = [id('歌蕾蒂娅')]
  config.rooms[0]!.operatorIds = hunters.slice(0, 2).map(id)
  config.rooms[1]!.operatorIds = hunters.slice(2).map(id)
  return config
}

function grant(result: ReturnType<typeof evaluateOperators>, name: string) {
  return result.operatorContributions.find(op => op.operatorId === id(name))!
}

describe('Gladiia manufacturing presence and fatigue boundaries', () => {
  it.each([
    { exhausted: [] },
    { exhausted: ['斯卡蒂'] },
    { exhausted: ['斯卡蒂', '乌尔比安'] },
    { exhausted: ['安哲拉', '幽灵鲨'] },
    { exhausted: hunters },
  ])('retains the 40%% grant per hunter with exhausted occupants $exhausted', ({ exhausted }) => {
    const config = scenario()
    config.zeroMoraleOperatorIds = exhausted.map(id)
    for (const room of config.rooms.slice(0, 2)) {
      const result = evaluateOperators(room, config)
      const expectedStaff = room.operatorIds.filter(opId => !config.zeroMoraleOperatorIds.includes(opId)).length
      expect(result.staffBonus).toBe(expectedStaff)
      expect(result.skillBonus).toBe(80)
      expect(result.efficiencyPercent).toBe(180 + expectedStaff)
      for (const opId of room.operatorIds) {
        const contribution = result.operatorContributions.find(op => op.operatorId === opId)!
        expect(contribution.staffBonus).toBe(config.zeroMoraleOperatorIds.includes(opId) ? 0 : 1)
        expect(contribution.skillBonus).toBe(40)
        expect(contribution.items).toContainEqual(expect.objectContaining({ name: '歌蕾蒂娅·集群狩猎', value: 40 }))
      }
    }
  })

  it.each([false, true])('grants 40%% to each of four different manufacturing rooms, fatigued=%s', fatigued => {
    const config = scenario()
    hunters.forEach((name, index) => { config.rooms[index]!.operatorIds = [id(name)] })
    config.zeroMoraleOperatorIds = fatigued ? hunters.map(id) : []
    for (const room of config.rooms.slice(0, 4)) {
      const result = evaluateOperators(room, config)
      expect(result.skillBonus).toBe(40)
      expect(result.efficiencyPercent).toBe(fatigued ? 140 : 141)
    }
  })

  it('keeps the grant in the dynamic active-set path and structured contribution output', () => {
    const config = scenario()
    const active = new Set([id('歌蕾蒂娅'), id('乌尔比安')])
    const morale = new Map(hunters.map(name => [id(name), name === '乌尔比安' ? 10 : 0]))
    const context = buildRiicGlobalContext(config, active, morale)
    const result = evaluateOperators(config.rooms[0]!, config, active, morale, context)
    expect(result.efficiencyPercent).toBe(181)
    expect(grant(result, '斯卡蒂').totalBonus).toBe(40)
    expect(formatStructuredContributions(result)).toContain('[斯卡蒂] +40% (歌蕾蒂娅·集群狩猎+40%)')
    expect(result.operatorContributions.reduce((total, op) => total + op.totalBonus, 0)).toBe(81)
  })

  it.each([0, 1, 2])('applies the unlocked E%s multiplier and single-room cap to three fatigued hunters', elitePhase => {
    const config = scenario()
    config.operatorRecords = inventoryOperatorRecords(compileOperatorInventory([
      { operator: '歌蕾蒂娅', elitePhase, level: 1 },
    ]))
    config.rooms[0]!.operatorIds = hunters.slice(0, 3).map(id)
    config.rooms[1]!.operatorIds = [id('幽灵鲨')]
    config.zeroMoraleOperatorIds = hunters.map(id)
    const result = evaluateOperators(config.rooms[0]!, config)
    const cap = elitePhase === 2 ? 90 : 45
    expect(result.skillBonus).toBe(cap)
    expect(result.efficiencyPercent).toBe(100 + cap)
    for (const name of hunters.slice(0, 3)) {
      expect(grant(result, name).skillBonus).toBe(cap / 3)
      expect(grant(result, name).items).toContainEqual(expect.objectContaining({
        detail: `制造站内共 4 名深海猎人，单站最高${cap}%`,
      }))
    }
    expect(result.unquantifiedSkills).toEqual([])
  })

  it.each([0, 1, 2])('caps an active three-hunter room at the E%s limit', elitePhase => {
    const config = scenario()
    config.operatorRecords = inventoryOperatorRecords(compileOperatorInventory([
      { operator: '歌蕾蒂娅', elitePhase, level: 1 },
    ]))
    config.rooms[0]!.operatorIds = hunters.slice(0, 3).map(id)
    config.rooms[1]!.operatorIds = [id('幽灵鲨')]
    const result = evaluateOperators(config.rooms[0]!, config)
    expect(result.skillBonus).toBe(elitePhase === 2 ? 90 : 45)
    expect(result.staffBonus).toBe(3)
  })

  it.each(['off-duty', 'exhausted', 'inactive-set', 'skill-missing'] as const)('requires an active provider with the unlocked skill: %s', providerState => {
    const config = scenario()
    config.zeroMoraleOperatorIds = hunters.map(id)
    if (providerState === 'off-duty') config.controlOperatorIds = []
    if (providerState === 'exhausted') config.zeroMoraleOperatorIds.push(id('歌蕾蒂娅'))
    if (providerState === 'skill-missing') {
      const gladiia = OPERATOR_MAP.get(id('歌蕾蒂娅'))!
      config.operatorRecords = { [gladiia.charId]: { ...gladiia, skills: [] } }
    }
    const active = providerState === 'inactive-set' ? new Set<string>() : undefined
    const result = evaluateOperators(config.rooms[0]!, config, active)
    expect(result.skillBonus).toBe(0)
    expect(result.efficiencyPercent).toBe(100)
    expect(grant(result, '斯卡蒂').skillBonus).toBe(0)
  })

  it('counts manufacturing occupants only and excludes the unnamed alter', () => {
    const config = scenario()
    config.rooms[1]!.operatorIds = [id('归溟幽灵鲨')]
    config.facilityOperatorIds.dormitories = [[id('安哲拉')], [], [], []]
    config.rooms[4]!.operatorIds = [id('幽灵鲨')]
    config.zeroMoraleOperatorIds = hunters.map(id)
    const result = evaluateOperators(config.rooms[0]!, config)
    expect(result.skillBonus).toBe(40)
    expect(grant(result, '斯卡蒂').skillBonus).toBe(20)
    const alterRoom = evaluateOperators(config.rooms[1]!, config)
    expect(grant(alterRoom, '归溟幽灵鲨').items.some(item => item.name === '歌蕾蒂娅·集群狩猎')).toBe(false)
    expect(alterRoom.skillBonus).toBe(0)
  })

  it('keeps exhausted hunters in the global count for active recipients', () => {
    const config = scenario()
    config.zeroMoraleOperatorIds = ['安哲拉', '幽灵鲨'].map(id)
    expect(evaluateOperators(config.rooms[0]!, config).efficiencyPercent).toBe(182)
  })

  it.each([false, true])('honors automation clearing and its own fatigue boundary, fatigued automation=%s', fatigued => {
    const config = scenario()
    config.rooms[0]!.operatorIds.push(id('温蒂'))
    config.zeroMoraleOperatorIds = hunters.map(id)
    if (fatigued) config.zeroMoraleOperatorIds.push(id('温蒂'))
    const result = evaluateOperators(config.rooms[0]!, config)
    expect(grant(result, '斯卡蒂').skillBonus).toBe(fatigued ? 40 : 0)
    expect(result.skillBonus).toBe(fatigued ? 80 : 45)
    expect(result.efficiencyPercent).toBe(fatigued ? 180 : 146)
  })

  it.each([false, true])('excludes Gladiia grants from Waai Fu copying, fatigued hunters=%s', fatigued => {
    const config = scenario()
    config.rooms[0]!.operatorIds.push(id('槐琥'))
    config.zeroMoraleOperatorIds = fatigued ? hunters.map(id) : []
    const result = evaluateOperators(config.rooms[0]!, config)
    expect(result.skillBonus).toBe(80)
    expect(grant(result, '槐琥').skillBonus).toBe(0)
    expect(result.efficiencyPercent).toBe(fatigued ? 181 : 183)
  })

  it('does not reenable exhausted personal skills while retaining the externally provided grant', () => {
    const config = scenario()
    const skadi = OPERATOR_MAP.get(id('斯卡蒂'))!
    const personal = { ...skadi.skills[0]!, buffId: 'test_abyssal_personal', name: '测试制造技能', roomType: 'MANUFACTURE', description: '进驻制造站时，生产力+25%' }
    config.operatorRecords = { [skadi.charId]: { ...skadi, skills: [personal] } }
    expect(evaluateOperators(config.rooms[0]!, config).efficiencyPercent).toBe(207)
    config.zeroMoraleOperatorIds = [skadi.charId]
    const result = evaluateOperators(config.rooms[0]!, config)
    expect(result.efficiencyPercent).toBe(181)
    expect(grant(result, '斯卡蒂').skillBonus).toBe(40)
    expect(grant(result, '斯卡蒂').items.some(item => item.name.includes('测试制造技能'))).toBe(false)
  })

  it('keeps other exhausted faction beneficiaries disabled', () => {
    const config = createDefaultConfig()
    config.controlOperatorIds = [id('涤火杰西卡')]
    config.rooms[0]!.operatorIds = [id('杰西卡')]
    config.zeroMoraleOperatorIds = [id('杰西卡')]
    const result = evaluateOperators(config.rooms[0]!, config)
    expect(result.skillBonus).toBe(0)
    expect(result.efficiencyPercent).toBe(100)
    expect(grant(result, '杰西卡').totalBonus).toBe(0)
  })
})
