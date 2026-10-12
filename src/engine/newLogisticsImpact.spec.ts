import { describe, expect, it } from 'vitest'
import { createDefaultConfig, createRoom } from '../domain/defaults'
import { OPERATORS } from '../domain/operators'
import { buildRiicGlobalContext } from './globalContext'
import { currentMoraleRates } from './morale'
import { evaluateOperators } from './operatorRules'
import { evaluateRecycleEfficiency } from './supportFacilitySkills'

const id = (name: string) => OPERATORS.find(operator => operator.name === name)!.charId

describe('recycling impacts on existing logistics mechanisms', () => {
  it('adds facility levels to Minimalist robots, even without recycling staff', () => {
    const config = createDefaultConfig()
    config.rooms = [createRoom('B101', 'manufacture')]
    config.rooms[0]!.operatorIds = [id('至简')]
    config.facilities = { central: 5, reception: 3, office: 3, workshop: 1, training: 0, dormitories: [] }

    expect(buildRiicGlobalContext(config).engineeringRobots).toBe(15)
    const before = evaluateOperators(config.rooms[0]!, config).efficiencyPercent
    config.facilities.recycle = 1
    expect(buildRiicGlobalContext(config).engineeringRobots).toBe(16)
    expect(evaluateOperators(config.rooms[0]!, config).efficiencyPercent - before).toBe(5)
    config.facilityOperatorIds.recycle = [id('旅骨')]
    expect(buildRiicGlobalContext(config).engineeringRobots).toBe(16)
    config.facilities.recycle = 3
    expect(buildRiicGlobalContext(config).engineeringRobots).toBe(18)
  })

  it('counts one occupied Sui recycling facility for Taraxa, regardless of number or mood', () => {
    const config = createDefaultConfig()
    const room = config.rooms[4]!
    room.operatorIds = [id('风絮')]
    const before = evaluateOperators(room, config).efficiencyPercent
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = [id('年'), id('夕')]
    expect(buildRiicGlobalContext(config).suiFacilities).toBe(1)
    expect(evaluateOperators(room, config).efficiencyPercent - before).toBe(4)
    config.zeroMoraleOperatorIds = [id('年'), id('夕')]
    expect(buildRiicGlobalContext(config).suiFacilities).toBe(1)
    expect(evaluateOperators(room, config).efficiencyPercent - before).toBe(4)
    config.facilityOperatorIds.recycle = []
    expect(evaluateOperators(room, config).efficiencyPercent).toBe(before)
  })

  it('counts one occupied elite recycling facility for Mantra, rather than each occupant', () => {
    const config = createDefaultConfig()
    const room = config.rooms[4]!
    room.operatorIds = [id('真言')]
    const before = evaluateOperators(room, config).efficiencyPercent
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = [id('电弧'), id('逻各斯')]
    expect(evaluateOperators(room, config).efficiencyPercent - before).toBe(2)
    config.zeroMoraleOperatorIds = [...config.facilityOperatorIds.recycle]
    expect(evaluateOperators(room, config).efficiencyPercent - before).toBe(2)
  })

  it('allows Muelsyse to count a Rhine member physically stationed in recycling, including at zero mood', () => {
    const config = createDefaultConfig()
    const room = config.rooms[6]!
    room.operatorIds = [id('缪尔赛思')]
    const before = evaluateOperators(room, config).efficiencyPercent
    config.facilities.recycle = 1
    config.facilityOperatorIds.recycle = [id('塞雷娅')]
    expect(evaluateOperators(room, config).efficiencyPercent - before).toBe(3)
    config.zeroMoraleOperatorIds = [id('塞雷娅')]
    expect(evaluateOperators(room, config).efficiencyPercent - before).toBe(3)
  })

  it('allows Hoederer to find Ines and W in the new workplace, but not in a dormitory or unbuilt facility', () => {
    const config = createDefaultConfig()
    const room = config.rooms[4]!
    room.operatorIds = [id('赫德雷')]
    const before = evaluateOperators(room, config).efficiencyPercent
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = [id('伊内丝'), id('W')]
    expect(evaluateOperators(room, config).efficiencyPercent - before).toBe(10)
    config.facilities.recycle = 0
    expect(evaluateOperators(room, config).efficiencyPercent).toBe(before)
    config.facilityOperatorIds.recycle = []
    config.facilityOperatorIds.dormitories[0] = [id('伊内丝'), id('W')]
    expect(evaluateOperators(room, config).efficiencyPercent).toBe(before)
  })

  it('distinguishes Chongyue working Sui resources from exhausted occupants and a runtime departure', () => {
    const config = createDefaultConfig()
    config.controlOperatorIds = [id('重岳')]
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = [id('年'), id('夕')]
    expect(buildRiicGlobalContext(config).worldlyFireworks).toBe(15)
    const active = new Set([id('重岳'), id('年')])
    expect(buildRiicGlobalContext(config, active).worldlyFireworks).toBe(10)
    expect(buildRiicGlobalContext(config, active).suiFacilities).toBe(2)
    config.operatorMorale[id('年')] = 0
    config.operatorMorale[id('夕')] = 0
    expect(buildRiicGlobalContext(config).worldlyFireworks).toBe(5)
    expect(buildRiicGlobalContext(config).suiFacilities).toBe(2)
  })

  it('uses current recycling mood supplied by the runtime instead of the initial snapshot', () => {
    const config = createDefaultConfig()
    config.controlOperatorIds = [id('重岳')]
    config.facilities.recycle = 1
    config.facilityOperatorIds.recycle = [id('年')]
    const active = new Set([id('重岳'), id('年')])
    expect(buildRiicGlobalContext(config, active, new Map([[id('年'), 0]])).worldlyFireworks).toBe(5)
    expect(buildRiicGlobalContext(config, active, new Map([[id('年'), 1]])).worldlyFireworks).toBe(10)
  })

  it('ignores stale occupants of an unbuilt recycling facility in global and morale rules', () => {
    const config = createDefaultConfig()
    config.controlOperatorIds = [id('重岳')]
    const before = buildRiicGlobalContext(config)
    config.facilityOperatorIds.recycle = [id('年')]
    expect(buildRiicGlobalContext(config)).toEqual(before)
    expect(currentMoraleRates(config).rates[id('年')]).toBeUndefined()
    expect(evaluateRecycleEfficiency(config).efficiencyPercent).toBe(0)
  })

  it('does not interpret new Iberian and Aegir operators as Rhine, Sui or elite members', () => {
    const config = createDefaultConfig()
    const room = config.rooms[6]!
    room.operatorIds = [id('缪尔赛思')]
    config.facilities.recycle = 1
    const before = evaluateOperators(room, config).efficiencyPercent
    config.facilityOperatorIds.recycle = [id('旅骨')]
    config.facilityOperatorIds.office = [id('德·托莱多')]
    config.facilityOperatorIds.reception = [id('克莱门莎')]
    expect(evaluateOperators(room, config).efficiencyPercent).toBe(before)
    expect(buildRiicGlobalContext(config).suiFacilities).toBe(0)
    expect(buildRiicGlobalContext(config).eliteFacilities).toBe(0)
  })

  it('keeps the omitted and explicitly unbuilt recycling configurations equivalent', () => {
    const config = createDefaultConfig()
    config.rooms[0]!.operatorIds = [id('至简')]
    const before = evaluateOperators(config.rooms[0]!, config)
    const context = buildRiicGlobalContext(config)
    config.facilities.recycle = 0
    config.facilityOperatorIds.recycle = []
    expect(buildRiicGlobalContext(config)).toEqual(context)
    expect(evaluateOperators(config.rooms[0]!, config)).toEqual(before)
  })
})
