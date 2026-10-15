import { describe, expect, it } from 'vitest'
import { compileOperatorInventory, fullCatalogIdleInventory } from '../domain/operatorInventory'
import { createDefaultWorkspace } from '../workbench/defaults'
import { resolveOperatorCharId as id } from '../domain/operatorIdentifiers'
import { enumerateCombinationVariants } from './combinationEnumeration'
import { applyCombinationVariant } from './combinationModel'
import { allocateCombinationSkeleton } from './combinationAllocation'
import { buildCombinationPool, evaluateCombinationVariant } from './combinationEvaluation'
import { applySmartDormitoryPolicy } from '../scheduler/smartDormitoryPolicy'
import { productionTeamTheory } from './productionSingletons'
import type { MowerSlot, RosterWorkspace } from '../domain/roster'

const inventory = (names: string[]) => compileOperatorInventory(fullCatalogIdleInventory().filter(o => names.some(name => id(name) === o.operator)))

describe('complete core and optional enumeration', () => {
  it('enumerates only pure perception even when all former fireworks cores are owned', () => {
    const variants = enumerateCombinationVariants(createDefaultWorkspace(), inventory(['迷迭香', '絮雨', '黑键', '乌有', '夕', '令']))
    expect(variants.some(v => v.definitionId === 'perception_fireworks')).toBe(false)
    const pure = variants.filter(v => v.definitionId === 'pure_perception')
    expect(pure.length).toBeGreaterThan(0)
    expect(pure.every(v => v.coreOperatorIds.length === 2 && v.coreOperatorIds.includes(id('迷迭香')) && v.coreOperatorIds.includes(id('絮雨')))).toBe(true)
    expect(pure.some(v => v.optionalOperatorIds.includes(id('黑键')))).toBe(true)
    expect(pure.every(v => !v.placements.some(p => ['乌有', '夕', '令'].some(name => p.operatorId === id(name))))).toBe(true)
  })
  it.each([2, 3])('enumerates experience automation on %i built power stations', powerCount => {
    const base = createDefaultWorkspace()
    for (const room of Object.values(base.mainPlan.facilities)) {
      if (room.type === 'manufacture') room.product = 'exp'
    }
    if (powerCount === 2) { base.mainPlan.facilities.room_3_3.level = 0; base.mainPlan.facilities.room_3_3.slots = [] }
    const values = enumerateCombinationVariants(base, inventory(['温蒂', '森蚺', '承曦格雷伊', 'Lancet-2']))
      .filter(v => v.definitionId === 'automation')
    expect(values.length).toBeGreaterThan(0)
    expect(values.every(v => v.placements.filter(p => base.mainPlan.facilities[p.roomId].type === 'manufacture')
      .every(p => base.mainPlan.facilities[p.roomId].product === 'exp'))).toBe(true)
    expect(values.every(v => v.placements.find(p => p.operatorId === id('森蚺')) &&
      base.mainPlan.facilities[v.placements.find(p => p.operatorId === id('森蚺'))!.roomId].type === (powerCount === 2 ? 'central' : 'manufacture'))).toBe(true)
  })
  it('keeps zero, one and two metalcraft supporters without permutation duplicates', () => {
    const base = createDefaultWorkspace()
    const before = structuredClone(base)
    const variants = enumerateCombinationVariants(base, inventory(['苍苔', '砾', '斑点']))
      .filter(v => v.definitionId === 'cantabile_metalcraft' && v.placements.every(p => p.roomId === 'room_1_1'))
    expect(variants.map(v => v.optionalOperatorIds.length).sort()).toEqual([0, 1, 1, 2])
    expect(new Set(variants.map(v => v.id)).size).toBe(4)
    expect(base).toEqual(before)
  })

  it('adds currently unlocked standardization members for Mizuki', () => {
    const variants = enumerateCombinationVariants(createDefaultWorkspace(), inventory(['水月', '香草', '杰西卡']))
      .filter(v => v.definitionId === 'mizuki_standardization')
    expect(variants.some(v => v.optionalOperatorIds.includes(id('香草')) && v.optionalOperatorIds.includes(id('杰西卡')))).toBe(true)
  })

  it('builds Nasti presence plans without a three-person admission threshold', () => {
    const variants = enumerateCombinationVariants(createDefaultWorkspace(), inventory(['多萝西', '娜斯提', '伊芙利特']))
      .filter(v => v.definitionId === 'rhine_lab')
    expect(variants.some(v => v.optionalOperatorIds.includes(id('娜斯提')) && !v.optionalOperatorIds.includes(id('伊芙利特')))).toBe(true)
    const supported = variants.find(v => v.optionalOperatorIds.includes(id('娜斯提')) && v.optionalOperatorIds.includes(id('伊芙利特')))
    expect(supported).toBeDefined()
    expect(supported!.placements.some(p => p.operatorId === id('伊芙利特'))).toBe(true)
  })

  it('keeps Karlan optional members restricted to Cliffheart and Swire Alter', () => {
    const variants = enumerateCombinationVariants(createDefaultWorkspace(), inventory(['银灰', '孑', '灵知', '崖心', '琳琅诗怀雅', '雪雉', '古米', '月见夜']))
      .filter(v => v.definitionId === 'karlan')
    expect(variants.some(v => v.optionalOperatorIds.includes(id('崖心')))).toBe(true)
    expect(variants.every(v => v.optionalOperatorIds.every(ref => [id('崖心'), id('琳琅诗怀雅')].includes(ref)))).toBe(true)
  })
})


const emptyPresenceSlot = (): MowerSlot => ({ occupant: { kind: 'empty' }, groupId: null, replacements: [] })
function recyclingPresenceWorkspace() {
  const base = createDefaultWorkspace()
  for (const roomId of ['factory', 'train'] as const) {
    base.mainPlan.facilities[roomId].slots.forEach(slot => { slot.occupant = { kind: 'current' } })
  }
  base.mainPlan.facilities.recycle.level = 1
  base.mainPlan.facilities.recycle.slots = [emptyPresenceSlot()]
  return base
}
function rhineWithIfrit(base: RosterWorkspace) {
  return enumerateCombinationVariants(base, inventory(['多萝西', '娜斯提', '伊芙利特']))
    .filter(v => v.definitionId === 'rhine_lab' && v.optionalOperatorIds.includes(id('娜斯提')) && v.optionalOperatorIds.includes(id('伊芙利特')))
}

describe('actual combination presence in recycling station', () => {
  it.each(['factory', 'train', 'recycle'] as const)('prefers an available %s seat over free dorm beds', target => {
    const base = recyclingPresenceWorkspace()
    if (target !== 'recycle') base.mainPlan.facilities[target].slots[0] = emptyPresenceSlot()
    const before = structuredClone(base), variants = rhineWithIfrit(base)
    expect(variants.length).toBeGreaterThan(0)
    expect(variants.every(v => v.placements.find(p => p.operatorId === id('伊芙利特'))?.roomId === target)).toBe(true)
    expect(base).toEqual(before)
  })

  it.each(['unbuilt', 'occupied', 'current', 'replacement', 'over-capacity'] as const)(
    'retains %s recycling state and uses an actual dormitory presence seat', reason => {
      const base = recyclingPresenceWorkspace(), recycle = base.mainPlan.facilities.recycle
      if (reason === 'unbuilt') recycle.level = 0
      if (reason === 'occupied' || reason === 'over-capacity') recycle.slots[0]!.occupant = { kind: 'operator', operatorId: id('旅骨') }
      if (reason === 'current') recycle.slots[0]!.occupant = { kind: 'current' }
      if (reason === 'replacement') recycle.slots[0]!.replacements = [id('砾')]
      if (reason === 'over-capacity') recycle.slots.push(emptyPresenceSlot())
      const before = structuredClone(base), variants = rhineWithIfrit(base)
      expect(variants.length).toBeGreaterThan(0)
      for (const variant of variants) {
        const presence = variant.placements.find(p => p.operatorId === id('伊芙利特'))!
        expect(base.mainPlan.facilities[presence.roomId].type).toBe('dormitory')
        const applied = applyCombinationVariant(base, variant)!
        expect(applied.mainPlan.facilities[presence.roomId].slots[presence.slotIndex]!.occupant).toEqual({ kind: 'operator', operatorId: id('伊芙利特') })
        expect(applied.mainPlan.facilities.recycle).toEqual(before.mainPlan.facilities.recycle)
      }
      expect(base).toEqual(before)
    },
  )

  it('keeps low-stage Rhine support as a real recycling worker through allocation and dorm finishing', () => {
    const base = recyclingPresenceWorkspace()
    const owned = fullCatalogIdleInventory().filter(o => ['多萝西', '娜斯提', '伊芙利特'].some(name => id(name) === o.operator))
    Object.assign(owned.find(o => o.operator === id('伊芙利特'))!, { elitePhase: 0, level: 1 })
    const operators = compileOperatorInventory(owned)
    const variant = enumerateCombinationVariants(base, operators).find(v => v.definitionId === 'rhine_lab' &&
      v.optionalOperatorIds.includes(id('娜斯提')) && v.optionalOperatorIds.includes(id('伊芙利特')))!
    expect(variant).toBeDefined()
    expect(variant.placements.find(p => p.operatorId === id('伊芙利特'))?.roomId).toBe('recycle')
    const value = evaluateCombinationVariant(base, operators, variant)
    expect(value.status, value.diagnostics.join('；')).toBe('evaluated')
    const pool = { values: [value], diagnostics: [], enumeratedCount: 1 }
    const ws = allocateCombinationSkeleton(base, pool, 0).workspace
    const expected = productionTeamTheory(ws, operators, 'room_1_1')!
    const withoutSupport = structuredClone(ws)
    withoutSupport.mainPlan.facilities.recycle.slots[0]!.occupant = { kind: 'empty' }
    expect(expected - productionTeamTheory(withoutSupport, operators, 'room_1_1')!).toBe(3)
    expect(ws.mainPlan.facilities.recycle.slots[0]!.dormitoryResident).not.toBe(true)
    for (let i = 0; i < 2; i++) applySmartDormitoryPolicy(ws, { entries: owned })
    expect(ws.mainPlan.facilities.recycle.slots[0]!.occupant).toEqual({ kind: 'operator', operatorId: id('伊芙利特') })
    expect(productionTeamTheory(ws, operators, 'room_1_1')).toBe(expected)
    expect(base.mainPlan.facilities.recycle.slots).toEqual([emptyPresenceSlot()])
  })
})


describe('locked auxiliary seats in combination presence planning', () => {
  it('allocates supported Rhine presence to a dorm when the only available recycling seat is locked', () => {
    const base = recyclingPresenceWorkspace(), before = structuredClone(base)
    const operators = inventory(['多萝西', '娜斯提', '伊芙利特'])
    const locks = { lockedPositions: new Set(['recycle:0']) }
    const pool = buildCombinationPool(base, operators, locks.lockedPositions)
    const supported = pool.values.filter(value => value.status === 'evaluated' && value.variant.definitionId === 'rhine_lab' &&
      value.variant.optionalOperatorIds.includes(id('娜斯提')) && value.variant.optionalOperatorIds.includes(id('伊芙利特')))
    expect(supported.length).toBeGreaterThan(0)
    const allocation = allocateCombinationSkeleton(base, { ...pool, values: supported }, 0, locks)
    expect(allocation.variants.length).toBeGreaterThan(0)
    const presence = allocation.variants.flatMap(variant => variant.placements).find(p => p.operatorId === id('伊芙利特'))!
    expect(allocation.workspace.mainPlan.facilities[presence.roomId].type).toBe('dormitory')
    expect(allocation.workspace.mainPlan.facilities[presence.roomId].slots[presence.slotIndex]!.occupant).toEqual({ kind: 'operator', operatorId: id('伊芙利特') })
    expect(allocation.workspace.mainPlan.facilities.recycle).toEqual(before.mainPlan.facilities.recycle)
    expect(base).toEqual(before)
  })

  it.each([
    { positions: ['factory:0'], target: 'train', slotIndex: 0 },
    { positions: ['factory:0', 'train:0'], target: 'train', slotIndex: 1 },
    { positions: ['factory:0', 'train:0', 'train:1'], target: 'recycle', slotIndex: 0 },
  ] as const)('skips locked auxiliary seats $positions while retaining the auxiliary tier', ({ positions, target, slotIndex }) => {
    const base = createDefaultWorkspace()
    base.mainPlan.facilities.recycle.level = 1
    base.mainPlan.facilities.recycle.slots = [emptyPresenceSlot()]
    const operators = inventory(['多萝西', '娜斯提', '伊芙利特']), before = structuredClone(base)
    const locks = { lockedPositions: new Set<string>(positions) }
    const pool = buildCombinationPool(base, operators, locks.lockedPositions)
    const supported = pool.values.filter(value => value.status === 'evaluated' && value.variant.definitionId === 'rhine_lab' &&
      value.variant.optionalOperatorIds.includes(id('娜斯提')) && value.variant.optionalOperatorIds.includes(id('伊芙利特')))
    expect(supported.length).toBeGreaterThan(0)
    const allocation = allocateCombinationSkeleton(base, { ...pool, values: supported }, 0, locks)
    expect(allocation.variants.length).toBeGreaterThan(0)
    expect(allocation.variants.flatMap(variant => variant.placements).find(p => p.operatorId === id('伊芙利特')))
      .toMatchObject({ roomId: target, slotIndex })
    for (const position of positions) {
      const [roomId, index] = position.split(':')
      const room = Object.values(allocation.workspace.mainPlan.facilities).find(room => room.roomId === roomId)!
      const original = Object.values(before.mainPlan.facilities).find(room => room.roomId === roomId)!
      expect(room.slots[Number(index)]).toEqual(original.slots[Number(index)])
    }
    expect(base).toEqual(before)
  })
})


it('keeps the enumerated presence seat when an earlier training slot reserves a replacement', () => {
  const base = recyclingPresenceWorkspace()
  base.mainPlan.facilities.train.slots[0] = { ...emptyPresenceSlot(), replacements: [id('砾')], metadata: { note: 'reserved training relief' } }
  base.mainPlan.facilities.train.slots[1] = emptyPresenceSlot()
  const before = structuredClone(base), reservedTraining = JSON.stringify(base.mainPlan.facilities.train.slots[0])
  const operators = inventory(['多萝西', '娜斯提', '伊芙利特']), pool = buildCombinationPool(base, operators)
  const supported = pool.values.filter(value => value.status === 'evaluated' && value.variant.definitionId === 'rhine_lab' &&
    value.variant.optionalOperatorIds.includes(id('娜斯提')) && value.variant.optionalOperatorIds.includes(id('伊芙利特')))
  expect(supported.length).toBeGreaterThan(0)
  expect(supported.every(value => value.variant.placements.find(p => p.operatorId === id('伊芙利特'))?.roomId === 'train' &&
    value.variant.placements.find(p => p.operatorId === id('伊芙利特'))?.slotIndex === 1)).toBe(true)
  const allocation = allocateCombinationSkeleton(base, { ...pool, values: supported }, 0)
  expect(allocation.variants.length).toBeGreaterThan(0)
  expect(allocation.variants.flatMap(variant => variant.placements).find(p => p.operatorId === id('伊芙利特')))
    .toMatchObject({ roomId: 'train', slotIndex: 1 })
  expect(JSON.stringify(allocation.workspace.mainPlan.facilities.train.slots[0])).toBe(reservedTraining)
  expect(allocation.workspace.mainPlan.facilities.train.slots[1]!.occupant).toEqual({ kind: 'operator', operatorId: id('伊芙利特') })
  expect(base).toEqual(before)
})
