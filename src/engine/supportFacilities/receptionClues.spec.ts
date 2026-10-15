import { expect, it } from 'vitest'
import { createDefaultConfig } from '../../domain/defaults'
import { OPERATORS } from '../../domain/operators'
import { fullCatalogIdleInventory, compileOperatorInventory } from '../../domain/operatorInventory'
import { inventoryOperatorRecords } from '../../domain/operatorContext'
import { receptionClueEfficiency } from './receptionClues'

const phases = new Map(
  compileOperatorInventory(fullCatalogIdleInventory()).operators.map((o) => [
    o.charId,
    o.elitePhase
  ])
)
function reception(...ids: string[]) {
  const config = createDefaultConfig()
  config.facilityOperatorIds.reception = ids
  return config
}
it('applies room, ambience, rarity, promotion and awake bonuses independently', () => {
  const config = reception('char_202_demkni')
  // 111% room + 15% ambience + 5% rarity + 16% promotion + 5% awake + 10% skill.
  expect(receptionClueEfficiency(config, phases)).toBeCloseTo(1.62)
  config.operatorMorale.char_202_demkni = 0
  expect(receptionClueEfficiency(config, phases)).toBeCloseTo(1.47)
  config.facilities.reception = 1
  config.facilities.dormitories = [1, 1, 0, 0]
  expect(receptionClueEfficiency(config, phases)).toBeCloseTo(1.33)
  expect(receptionClueEfficiency(reception(), phases)).toBe(0)
  config.facilities.reception = 0
  expect(receptionClueEfficiency(config, phases)).toBe(0)
})
it('uses supplied promotion and skills instead of maximum assumptions', () => {
  const owned = compileOperatorInventory([{ operator: '塞雷娅', elitePhase: 0, level: 1 }])
  const config = reception('char_202_demkni')
  config.operatorRecords = inventoryOperatorRecords(owned)
  expect(receptionClueEfficiency(config, new Map([['char_202_demkni', 0]]))).toBeCloseTo(1.46)
})
it('handles all pinned reception skills without counting clue-type effects as speed', () => {
  for (const operator of OPERATORS) {
    for (const slot of operator.skillSlots ?? []) {
      for (const skill of slot.filter((skill) => skill.roomType === 'MEETING')) {
        const config = reception(operator.charId)
        config.operatorRecords = { [operator.charId]: { ...operator, skills: [skill] } }
        expect(receptionClueEfficiency(config, phases), skill.buffId).toBeGreaterThan(1)
      }
    }
  }
  expect(receptionClueEfficiency(reception('char_4220_kormr'), phases)).toBeCloseTo(1.61)
})
it('counts always-active exchange speed only for unlocked, working operators', () => {
  for (const [name, id, phase, level, expected] of [
    ['跃跃', 'char_4100_caper', 0, 1, 1.43],
    ['跃跃', 'char_4100_caper', 1, 1, 1.81],
    ['跃跃', 'char_4100_caper', 2, 1, 1.89],
    ['响石', 'char_4214_cairn', 1, 1, 1.43],
    ['响石', 'char_4214_cairn', 2, 1, 1.81],
    ['虎狼丸', 'char_4220_kormr', 0, 1, 1.31],
    ['虎狼丸', 'char_4220_kormr', 0, 30, 1.61]
  ] as const) {
    const owned = compileOperatorInventory([{ operator: name, elitePhase: phase, level }])
    const config = reception(id)
    config.operatorRecords = inventoryOperatorRecords(owned)
    expect(
      receptionClueEfficiency(config, new Map([[id, phase]])),
      `${name} E${phase} L${level}`
    ).toBeCloseTo(expected)
  }
  const config = reception('char_4100_caper')
  config.operatorMorale.char_4100_caper = 0
  expect(receptionClueEfficiency(config, phases)).toBeCloseTo(1.44)
})
it('gates single-operator skills on awake coworkers and cooperative bonuses on providers', () => {
  const config = reception('char_1015_aglna2', 'char_202_demkni')
  expect(receptionClueEfficiency(config, phases)).toBeCloseTo(1.88)
  config.operatorMorale.char_202_demkni = 0
  expect(receptionClueEfficiency(config, phases)).toBeCloseTo(2.23)
  const pair = reception('char_4231_clemnt', 'char_202_demkni')
  expect(receptionClueEfficiency(pair, phases)).toBeCloseTo(2.23)
  pair.operatorMorale.char_202_demkni = 0
  expect(receptionClueEfficiency(pair, phases)).toBeCloseTo(1.93)
})

it('fails visibly for missing promotion and unknown speed clauses', () => {
  expect(() => receptionClueEfficiency(reception('char_202_demkni'), new Map())).toThrow('缺少会客室干员练度')
  const config = reception('char_202_demkni')
  const operator = OPERATORS.find(o => o.charId === 'char_202_demkni')!
  config.operatorRecords = { [operator.charId]: { ...operator, skills: [{
    ...operator.skills[0]!, roomType: 'MEETING', buffId: 'unknown',
    description: '进驻会客室时，线索搜集速度提升10%，未知条件额外提升50%',
  }] } }
  expect(() => receptionClueEfficiency(config, phases)).toThrow('尚未支持的会客室技能')
})

it('gates reception synergies on awake coworkers and uses actual identity', () => {
  const byName = (name: string) => OPERATORS.find(o => o.name === name)!.charId
  for (const [provider, peer, additional] of [
    ['忍冬', '铃兰', .3], ['凛视', '提丰', .15],
    ['提丰', '远山', .05], ['寻澜', '雷蛇', .2],
  ] as const) {
    const config = reception(byName(provider), byName(peer))
    const peerRecord = OPERATORS.find(o => o.name === peer)!
    config.operatorRecords = { [peerRecord.charId]: { ...peerRecord, skills: [] } }
    const normal = receptionClueEfficiency(config, phases)
    config.operatorMorale[byName(peer)] = 0
    expect(normal - receptionClueEfficiency(config, phases), provider).toBeCloseTo(additional + .05)
  }
})
