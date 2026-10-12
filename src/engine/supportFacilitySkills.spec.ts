import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../domain/defaults'
import { OPERATOR_MAP, type OperatorRecord } from '../domain/operators'
import { selectUnlockedSkills } from '../domain/operatorInventory'
import { evaluateHomeboundByproduct, evaluateNewContactAndClueSkills, evaluateRecycleEfficiency } from './supportFacilitySkills'

const homebound = 'char_4232_hbound', toledo = 'char_393_toledo', clem = 'char_4231_clemnt'
function configAtStage(id: string, phase: number) {
  const config = createDefaultConfig(), operator = OPERATOR_MAP.get(id)!
  config.operatorRecords = { [id]: { ...operator, skills: selectUnlockedSkills(operator, phase, 1) } }
  return config
}
describe('v078 support facility effects', () => {
  it.each([[0, 20], [1, 20], [2, 30]])('Toledo E%s provides office bonus %s', (stage, bonus) => {
    const config = configAtStage(toledo, stage)
    config.facilityOperatorIds.office = [toledo]
    expect(evaluateNewContactAndClueSkills(config).contactBonus).toBe(bonus)
    config.facilityOperatorIds.office = []
    config.facilityOperatorIds.reception = [toledo]
    expect(evaluateNewContactAndClueSkills(config).contactBonus).toBe(0)
  })
  it('Clemensha sums independent clue slots only with an active meeting coworker', () => {
    const config = configAtStage(clem, 2)
    config.facilityOperatorIds.reception = [clem]
    expect(evaluateNewContactAndClueSkills(config).clueBonus).toBe(20)
    config.facilityOperatorIds.reception.push('char_009_12fce')
    expect(evaluateNewContactAndClueSkills(config).clueBonus).toBe(35)
    config.operatorMorale.char_009_12fce = 0
    expect(evaluateNewContactAndClueSkills(config).clueBonus).toBe(20)
    config.operatorMorale[clem] = 0
    expect(evaluateNewContactAndClueSkills(config).clueBonus).toBe(0)
  })
  it.each(['31094', '30165'])('Homebound increases %s byproduct from 10 to 19 percent', itemId => {
    const config = configAtStage(homebound, 2)
    config.facilityOperatorIds.workshop = [homebound]
    expect(evaluateHomeboundByproduct(config, itemId).probability).toBeCloseTo(.19)
    expect(evaluateHomeboundByproduct(config, '30034').probability).toBeCloseTo(.1)
  })
  it('keeps crafting stage, target item and facility scope independent', () => {
    const config = configAtStage(homebound, 0)
    config.facilityOperatorIds.workshop = [homebound]
    expect(evaluateHomeboundByproduct(config, '31094').bonusPercent).toBe(0)
    config.operatorRecords = undefined
    config.facilityOperatorIds.workshop = []
    config.facilityOperatorIds.recycle = [homebound]
    expect(evaluateHomeboundByproduct(config, '31094').bonusPercent).toBe(0)
  })
  it.each([[1, 5, 100], [2, 10, 100], [3, 10, 120]])('unmanned recycle level %s has capacity %s and efficiency %s', (level, capacity, efficiency) => {
    const config = createDefaultConfig()
    config.facilities.recycle = level as 1 | 2 | 3
    const result = evaluateRecycleEfficiency(config)
    expect(result.capacity).toBe(capacity)
    expect(result.efficiencyPercent).toBeCloseTo(efficiency)
    expect(result.hoursPerMaterial).toBeCloseTo(48 / (efficiency / 100))
  })
  it.each([[0, 141], [2, 151]])('Homebound E%s adds exactly one unlocked recycling skill', (stage, efficiency) => {
    const config = configAtStage(homebound, stage)
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = [homebound]
    expect(evaluateRecycleEfficiency(config).efficiencyPercent).toBeCloseTo(efficiency)
    config.operatorMorale[homebound] = 0
    expect(evaluateRecycleEfficiency(config).efficiencyPercent).toBeCloseTo(120)
  })
  it('adds two staff bonuses and the optional level-three boost, without multiplying them', () => {
    const config = configAtStage(homebound, 2)
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = [homebound, 'char_123_fang']
    expect(evaluateRecycleEfficiency(config).efficiencyPercent).toBeCloseTo(152)
    expect(evaluateRecycleEfficiency(config, { boosted: true }).efficiencyPercent).toBeCloseTo(202)
    config.facilities.recycle = 1
    expect(() => evaluateRecycleEfficiency(config)).toThrow('capacity')
    config.facilityOperatorIds.recycle = []
    expect(() => evaluateRecycleEfficiency(config, { boosted: true })).toThrow('level three')
  })

  it('keeps physical capacity validation when a second recycling occupant is exhausted', () => {
    const config = configAtStage(homebound, 2)
    config.facilities.recycle = 1
    config.facilityOperatorIds.recycle = [homebound, 'char_123_fang']
    config.operatorMorale.char_123_fang = 0
    expect(() => evaluateRecycleEfficiency(config)).toThrow('capacity')
  })

  it('uses runtime assignment, explicit zero state and positive mood independently for recycling bonuses', () => {
    const config = configAtStage(homebound, 2)
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = [homebound]
    expect(evaluateRecycleEfficiency(config, { activeIds: new Set() }).efficiencyPercent).toBe(120)
    expect(evaluateRecycleEfficiency(config, { activeIds: new Set([homebound]) }).efficiencyPercent).toBe(151)
    config.zeroMoraleOperatorIds = [homebound]
    config.workaholicOperatorIds = [homebound]
    expect(evaluateRecycleEfficiency(config, { activeIds: new Set([homebound]) }).efficiencyPercent).toBe(120)
  })

  it('does not apply unrelated manufacture skills to the new recycling facility', () => {
    const config = createDefaultConfig()
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = ['char_123_fang']
    expect(evaluateRecycleEfficiency(config).efficiencyPercent).toBe(121)
  })

  it('disables every new workplace effect in an unbuilt or explicitly exhausted facility', () => {
    const config = configAtStage(homebound, 2)
    config.facilityOperatorIds.workshop = [homebound]
    config.zeroMoraleOperatorIds = [homebound]
    expect(evaluateHomeboundByproduct(config, '31094').probability).toBeCloseTo(.1)
    config.zeroMoraleOperatorIds = []
    config.facilities.workshop = 0
    expect(evaluateHomeboundByproduct(config, '31094').probability).toBeCloseTo(.1)

    config.facilityOperatorIds.office = [toledo]
    config.facilityOperatorIds.reception = [clem, 'char_009_12fce']
    config.facilities.office = 0
    config.facilities.reception = 0
    expect(evaluateNewContactAndClueSkills(config)).toEqual({ contactBonus: 0, clueBonus: 0 })
    config.facilities.office = 3
    config.facilities.reception = 3
    config.zeroMoraleOperatorIds = [toledo, clem]
    expect(evaluateNewContactAndClueSkills(config)).toEqual({ contactBonus: 0, clueBonus: 0 })
  })

  it('reports unknown or conditional recycling skills instead of reducing them to a percentage', () => {
    const config = configAtStage(homebound, 2)
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = [homebound]
    const operator = config.operatorRecords![homebound]!
    const skill = operator.skills.find(skill => skill.roomType === 'RECYCLE')!
    const withSkill = (buffId: string, description: string): OperatorRecord => ({
      ...operator, skills: [{ ...skill, buffId, description }],
    })
    config.operatorRecords = { [homebound]: withSkill('recycle_future[000]', '进驻回收站时，材料转化效率+40%') }
    expect(() => evaluateRecycleEfficiency(config)).toThrow('Unquantified recycle skill')
    config.operatorRecords = { [homebound]: withSkill(skill.buffId, `${skill.description}；同站存在特定干员时生效`) }
    expect(() => evaluateRecycleEfficiency(config)).toThrow('Unquantified recycle skill')
    config.operatorRecords = undefined
    config.facilityOperatorIds.recycle = ['unknown_operator']
    expect(() => evaluateRecycleEfficiency(config)).toThrow('Unknown recycle operator')
  })

  it.each([
    [toledo, 'HIRE', 'contact'], [clem, 'MEETING', 'clue'], [homebound, 'WORKSHOP', 'workshop'],
  ])('reports an unimplemented %s skill instead of pretending it is quantified', (operatorId, roomType, category) => {
    const config = configAtStage(operatorId!, 2)
    const operator = config.operatorRecords![operatorId!]!
    config.operatorRecords = { [operatorId!]: { ...operator, skills: [
      { ...operator.skills.find(skill => skill.roomType === roomType)!, buffId: 'future_support[000]' },
    ] } }
    config.facilityOperatorIds.office = [toledo]
    config.facilityOperatorIds.reception = [clem]
    config.facilityOperatorIds.workshop = [homebound]
    const evaluate = category === 'workshop'
      ? () => evaluateHomeboundByproduct(config, '31094') : () => evaluateNewContactAndClueSkills(config)
    expect(evaluate).toThrow(`Unquantified ${category} skill`)
  })
})
