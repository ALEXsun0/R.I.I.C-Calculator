import { describe, expect, it } from 'vitest'
import { createDefaultConfig, createRoom } from '../domain/defaults'
import type { AppConfig } from '../domain/types'
import { currentMoraleRates } from './morale'

// v078 cc.c.room2 enumerates POWER, MANUFACTURE, TRADING, HIRE and MEETING.
// cc.c.room1 enumerates only POWER, HIRE and MEETING. Neither includes RECYCLE.
const targets = ['manufacture', 'trading', 'power', 'office', 'reception', 'recycle'] as const
type Target = typeof targets[number]
const worker = 'char_123_fang'

function fixture(target: Target, controlOperatorIds: string[], coworkers: string[] = []): AppConfig {
  const config = createDefaultConfig()
  config.rooms = []
  config.controlOperatorIds = [...controlOperatorIds]
  const occupants = [worker, ...coworkers]
  if (target === 'office' || target === 'reception' || target === 'recycle') {
    config.facilityOperatorIds[target] = occupants
    if (target === 'recycle') config.facilities.recycle = 3
  } else {
    const room = createRoom('scope-target', target)
    room.operatorIds = occupants
    config.rooms = [room]
  }
  return config
}

const providers = [
  {
    name: '玛恩纳公事公办及红的扩展',
    controls: ['char_4064_mlynar', 'char_144_red'],
    expected: { manufacture: .8, trading: .8, power: .7, office: .7, reception: .7, recycle: .9 },
  },
  {
    name: '重岳孤光共照',
    controls: ['char_2024_chyue'],
    expected: { manufacture: .9, trading: .9, power: .9, office: .9, reception: .9, recycle: .95 },
  },
  {
    name: '维什戴尔巴别塔之帜',
    controls: ['char_1035_wisdel'],
    expected: { manufacture: .85, trading: .85, power: .85, office: .85, reception: .85, recycle: .95 },
  },
]

describe.each(providers)('current control morale scope: $name', ({ controls, expected }) => {
  it.each(targets)('uses the explicit facility scope for %s', target => {
    const config = fixture(target, controls)
    const before = structuredClone(config)
    const result = currentMoraleRates(config)
    expect(result.rates[worker]).toBeCloseTo(expected[target], 12)
    expect(result.unquantified).toEqual([])
    expect(config).toEqual(before)
  })
})

describe('ordinary base morale reductions remain independent of special control scope', () => {
  it.each([
    { controls: [], expected: 1 },
    { controls: ['char_144_red', 'char_4134_cetsyr', 'char_002_amiya'], expected: .85 },
  ])('retains the ordinary recycle rate $expected with $controls', ({ controls, expected }) => {
    expect(currentMoraleRates(fixture('recycle', controls)).rates[worker]).toBeCloseTo(expected, 12)
  })

  it.each(['manufacture', 'trading'] as const)('retains the three-person staffing reduction in %s', target => {
    const config = fixture(target, ['char_144_red'], ['char_502_nblade', 'char_500_noirc'])
    expect(currentMoraleRates(config).rates[worker]).toBeCloseTo(.85, 12)
  })
})
