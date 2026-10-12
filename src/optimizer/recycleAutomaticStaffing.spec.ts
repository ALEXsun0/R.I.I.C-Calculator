import { describe, expect, it } from 'vitest'
import { compileOperatorInventory, type OwnedOperatorInput } from '../domain/operatorInventory'
import { resolveOperatorCharId as id } from '../domain/operatorIdentifiers'
import type { MowerSlot } from '../domain/roster'
import { createDefaultWorkspace } from '../workbench/defaults'
import { generateMolecularCandidates } from './molecularSynthesis'
import { assignBackups, validatePhysicalRoster } from './rosterDraft'

const entries: OwnedOperatorInput[] = [
  { operator: '旅骨', elitePhase: 2, level: 1 },
  { operator: '砾', elitePhase: 2, level: 1 },
  { operator: '杜林', elitePhase: 0, level: 30 },
  { operator: 'Lancet-2', elitePhase: 0, level: 30 },
]
const operatorSlot = (name: string): MowerSlot => ({
  occupant: { kind: 'operator', operatorId: id(name) }, groupId: null, replacements: [],
})

/** A powered facility and four real Free beds isolate staffing from recovery failures. */
function scenario(staffed = true, built = true) {
  const workspace = createDefaultWorkspace()
  for (const room of Object.values(workspace.mainPlan.facilities)) { room.level = 0; room.slots = [] }
  workspace.mainPlan.facilities.room_3_3.level = 3
  workspace.mainPlan.facilities.room_3_3.slots = [operatorSlot('Lancet-2')]
  workspace.mainPlan.conf.workaholic = [id('Lancet-2')]
  workspace.mainPlan.facilities.dormitory_1.level = 5
  workspace.mainPlan.facilities.dormitory_1.slots = [
    operatorSlot('杜林'),
    ...Array.from({ length: 4 }, (): MowerSlot => ({ occupant: { kind: 'free' }, groupId: null, replacements: [] })),
  ]
  workspace.mainPlan.facilities.recycle.level = built ? 1 : 0
  workspace.mainPlan.facilities.recycle.slots = built
    ? [staffed ? operatorSlot('旅骨') : { occupant: { kind: 'empty' }, groupId: null, replacements: [] }]
    : []
  return workspace
}

const added = [{ roomId: 'recycle' as const, slotIndex: 0, operatorId: id('旅骨') }]

describe('automatic recycling staffing with ordinary relief', () => {
  it('gives Homebound an ordinary Gravel backup without requiring a second recycling skill owner', () => {
    const workspace = scenario()
    expect(validatePhysicalRoster(workspace)).toEqual([])
    const inventory = compileOperatorInventory(entries)
    expect(inventory.valid).toBe(true)
    const resources = assignBackups(workspace, inventory, added)
    expect(resources.freeBeds).toBe(4)
    expect(resources.missingReplacementIds).toEqual([])
    expect(workspace.mainPlan.facilities.recycle.slots[0]!.replacements).toEqual([id('砾')])
  })

  it('excludes a locked neutral backup while using another unoccupied legal operator', () => {
    const workspace = scenario()
    const inventory = compileOperatorInventory([...entries, { operator: '芬', elitePhase: 1, level: 1 }])
    const resources = assignBackups(workspace, inventory, added, { excludedOperatorIds: [id('砾')] })
    expect(resources.missingReplacementIds).toEqual([])
    expect(workspace.mainPlan.facilities.recycle.slots[0]!.replacements).toEqual([id('芬')])
  })

  it('does not reuse an operator already occupying another facility as the recycling backup', () => {
    const workspace = scenario()
    workspace.mainPlan.facilities.dormitory_1.slots[1] = operatorSlot('砾')
    const inventory = compileOperatorInventory([...entries, { operator: '芬', elitePhase: 1, level: 1 }])
    const resources = assignBackups(workspace, inventory, added)
    expect(resources.missingReplacementIds).toEqual([])
    expect(workspace.mainPlan.facilities.recycle.slots[0]!.replacements).toEqual([id('芬')])
    expect(workspace.mainPlan.facilities.dormitory_1.slots[1]!.occupant).toEqual({ kind: 'operator', operatorId: id('砾') })
  })

  it('fills a built recycling station through the real molecular generator without changing the input', () => {
    const workspace = scenario(false), before = structuredClone(workspace)
    expect(validatePhysicalRoster(workspace)).toEqual([])
    const inventory = compileOperatorInventory(entries)
    const candidates = generateMolecularCandidates(workspace, entries, inventory, {
      branchCount: 1, lockedPositions: new Set(['room_3_3:0', 'dormitory_1:0']),
    })
    expect(candidates.length).toBeGreaterThan(0)
    expect(workspace).toEqual(before)
    const candidate = candidates[0]!.workspace
    expect(validatePhysicalRoster(candidate)).toEqual([])
    expect(candidate.mainPlan.facilities.recycle.level).toBe(1)
    expect(candidate.mainPlan.facilities.recycle.slots[0]!.occupant).toEqual({ kind: 'operator', operatorId: id('旅骨') })
    expect(candidate.mainPlan.facilities.recycle.slots[0]!.replacements).toEqual([id('砾')])
    expect(candidate.mainPlan.facilities.room_3_3.slots[0]!.occupant).toEqual(before.mainPlan.facilities.room_3_3.slots[0]!.occupant)
    expect(candidate.mainPlan.facilities.dormitory_1.slots[0]!.occupant).toEqual(before.mainPlan.facilities.dormitory_1.slots[0]!.occupant)
  })

  it('does not build a recycling station while generating an existing layout', () => {
    const workspace = scenario(false, false)
    const inventory = compileOperatorInventory(entries)
    const candidates = generateMolecularCandidates(workspace, entries, inventory, {
      branchCount: 1, lockedPositions: new Set(['room_3_3:0', 'dormitory_1:0']),
    })
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      expect(candidate.workspace.mainPlan.facilities.recycle.level).toBe(0)
      expect(candidate.workspace.mainPlan.facilities.recycle.slots).toEqual([])
    }
  })
})
