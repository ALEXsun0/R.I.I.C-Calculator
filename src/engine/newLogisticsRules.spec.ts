import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../domain/defaults'
import { OPERATOR_MAP, type OperatorRecord } from '../domain/operators'
import { selectUnlockedSkills } from '../domain/operatorInventory'
import { currentMoraleRates } from './morale'
import { evaluateDormitoryRecovery } from './dormitoryRecovery'
import { evaluateNewContactAndClueSkills } from './supportFacilitySkills'

const clem = 'char_4231_clemnt'
const toledo = 'char_393_toledo'
function atStage(id: string, phase: number): OperatorRecord {
  const operator = OPERATOR_MAP.get(id)!
  return { ...operator, skills: selectUnlockedSkills(operator, phase, 1) }
}

describe('new logistics conditions and morale', () => {
  it.each([[0, false, 2], [2, false, 2], [2, true, 3]] as const)(
    'Clemensha E%s with coworker=%s consumes %s per hour', (phase, together, expected) => {
      const config = createDefaultConfig()
      config.controlOperatorIds = []
      config.facilityOperatorIds.reception = together ? [clem, 'char_009_12fce'] : [clem]
      config.operatorRecords = { [clem]: atStage(clem, phase) }
      expect(currentMoraleRates(config).rates[clem]).toBeCloseTo(expected)
    },
  )
  it('does not count an exhausted coworker or another facility as meeting cooperation', () => {
    const config = createDefaultConfig()
    config.controlOperatorIds = []
    config.facilityOperatorIds.reception = [clem, 'char_009_12fce']
    config.operatorMorale.char_009_12fce = 0
    expect(currentMoraleRates(config).rates[clem]).toBeCloseTo(2)
    config.facilityOperatorIds.reception = [clem]
    config.facilityOperatorIds.office = ['char_009_12fce']
    config.operatorMorale.char_009_12fce = 24
    expect(currentMoraleRates(config).rates[clem]).toBeCloseTo(2)
  })

  it('uses the same explicit zero-mood coworker gate for clue speed and morale consumption', () => {
    const config = createDefaultConfig()
    config.facilityOperatorIds.reception = [clem, 'char_009_12fce']
    config.zeroMoraleOperatorIds = ['char_009_12fce']
    expect(evaluateNewContactAndClueSkills(config).clueBonus).toBe(20)
    expect(currentMoraleRates(config).rates[clem]).toBeCloseTo(2)
    config.zeroMoraleOperatorIds = [clem]
    expect(evaluateNewContactAndClueSkills(config).clueBonus).toBe(0)
    expect(currentMoraleRates(config).rates[clem]).toBeUndefined()
  })

  it('keeps Clementia personal costs separate from her coworker and control-center reduction', () => {
    const config = createDefaultConfig()
    config.controlOperatorIds = ['char_002_amiya']
    config.facilityOperatorIds.reception = [clem, 'char_009_12fce']
    expect(currentMoraleRates(config).rates[clem]).toBeCloseTo(2.95)
    expect(currentMoraleRates(config).rates.char_009_12fce).toBeCloseTo(.95)
    config.facilityOperatorIds.reception = ['char_009_12fce']
    expect(currentMoraleRates(config).rates.char_009_12fce).toBeCloseTo(.95)
  })
  it.each([0, 2])('Toledo office morale reduction stays -0.25 at E%s', phase => {
    const config = createDefaultConfig()
    config.controlOperatorIds = []
    config.facilityOperatorIds.office = [toledo]
    config.operatorRecords = { [toledo]: atStage(toledo, phase) }
    expect(currentMoraleRates(config).rates[toledo]).toBeCloseTo(.75)
  })
  it.each([[0, 3, 4], [2, 0, 4.1], [2, 1, 4.1], [2, 2, 4.15], [2, 3, 4.2]] as const)(
    'Toledo E%s dorm recovery uses office level %s', (phase, office, expected) => {
      const config = createDefaultConfig()
      config.controlOperatorIds = []
      config.facilities.office = office
      config.facilities.dormitories = [5]
      config.facilityOperatorIds.dormitories = [[toledo, 'char_123_fang']]
      config.operatorRecords = { [toledo]: atStage(toledo, phase) }
      const result = evaluateDormitoryRecovery(config, 0, new Map([['char_123_fang', 10]]), 5000)
      expect(result.rates.get('char_123_fang')).toBeCloseTo(expected)
      expect(result.rates.get(toledo)).toBeCloseTo(expected)
      expect(result.unquantified).toEqual([])
    },
  )
  it('compares the combined Toledo dorm effect with competing all-room recovery', () => {
    const config = createDefaultConfig()
    config.controlOperatorIds = []
    config.facilities.office = 3
    config.facilities.dormitories = [5]
    config.facilityOperatorIds.dormitories = [[toledo, 'char_009_12fce', 'char_123_fang', 'char_008_franka']]
    const durin = [...OPERATOR_MAP.values()].find(operator => operator.name === '杜林')!
    config.facilityOperatorIds.dormitories[0]!.push(durin.charId)
    expect(evaluateDormitoryRecovery(config, 0, new Map([['char_123_fang', 10]]), 5000).rates.get('char_123_fang')).toBeCloseTo(4.25)
  })

  it('compares Toledo with Podenco all-room recovery before adding a separate single-target effect', () => {
    const config = createDefaultConfig()
    const podenco = [...OPERATOR_MAP.values()].find(operator => operator.name === '波登可')!
    config.facilities.office = 1
    config.facilities.dormitories = [5]
    config.facilityOperatorIds.dormitories = [[toledo, podenco.charId, 'char_123_fang']]
    const morale = new Map([['char_123_fang', 10]])
    const before = evaluateDormitoryRecovery(config, 0, morale, 5000)
    expect(before.rates.get('char_123_fang')).toBeCloseTo(4.8)
    expect(before.rates.get(toledo)).toBeCloseTo(4.15)
    config.facilities.office = 3
    const after = evaluateDormitoryRecovery(config, 0, morale, 5000)
    expect(after.rates.get('char_123_fang')).toBeCloseTo(4.85)
    expect(after.rates.get(toledo)).toBeCloseTo(4.2)
    expect(after.rates.get(podenco.charId)).toBeCloseTo(4.2)
    expect(after.unquantified).toEqual([])
  })

  it('retains resting Toledo recovery at zero mood, while Durin keeps her own negative modifier', () => {
    const config = createDefaultConfig()
    const durin = [...OPERATOR_MAP.values()].find(operator => operator.name === '杜林')!
    config.facilities.office = 3
    config.facilities.dormitories = [5]
    config.facilityOperatorIds.dormitories = [[toledo, durin.charId, 'char_123_fang']]
    config.zeroMoraleOperatorIds = [toledo]
    const result = evaluateDormitoryRecovery(config, 0, new Map([[toledo, 0], ['char_123_fang', 10]]), 5000)
    expect(result.rates.get(toledo)).toBeCloseTo(4.25)
    expect(result.rates.get('char_123_fang')).toBeCloseTo(4.25)
    expect(result.rates.get(durin.charId)).toBeCloseTo(4.15)
  })
})
