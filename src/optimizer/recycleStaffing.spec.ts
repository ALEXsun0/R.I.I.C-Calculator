import { describe, expect, it } from 'vitest'
import { compileOperatorInventory } from '../domain/operatorInventory'
import { createDefaultWorkspace } from '../workbench/defaults'
import { validatePhysicalRoster } from './rosterDraft'
import { rankStaffingCandidates } from './staffingQuality'

const traveller = 'char_4232_hbound', fang = 'char_123_fang'
function recycleOnly(level: number) {
  const workspace = createDefaultWorkspace()
  for (const room of Object.values(workspace.mainPlan.facilities)) { room.level = 0; room.slots = [] }
  workspace.mainPlan.facilities.recycle.level = level
  workspace.mainPlan.facilities.recycle.slots = [{ occupant: { kind: 'empty' }, groupId: null, replacements: [] }]
  return workspace
}

describe('recycle planning uses actual capacity and unlocked skills', () => {
  it.each([0, 2])('ranks Homebound at E%s above neutral staff without valuing random materials as LMD', phase => {
    const inventory = compileOperatorInventory([
      { operator: traveller, elitePhase: phase, level: 1 },
      { operator: fang, elitePhase: 1, level: 1 },
    ])
    const workspace = recycleOnly(3), before = structuredClone(workspace)
    expect(rankStaffingCandidates(workspace, inventory, { roomId: 'recycle', slotIndex: 0 }, [fang, traveller], 'main', { allowNeutral: true })).toEqual([traveller, fang])
    expect(workspace).toEqual(before)
    expect(rankStaffingCandidates(workspace, inventory, { roomId: 'recycle', slotIndex: 0 }, [fang, traveller], 'backup')).toEqual([traveller])
  })
  it('rejects a second worker at level one but allows it at level two with zero power use', () => {
    const workspace = recycleOnly(1)
    workspace.mainPlan.facilities.recycle.slots = [traveller, fang].map(operatorId => ({ occupant: { kind: 'operator', operatorId }, groupId: null, replacements: [] }))
    expect(validatePhysicalRoster(workspace).some(issue => ['SLOT_OVERFLOW', 'SLOT_INDEX'].includes(issue.code))).toBe(true)
    workspace.mainPlan.facilities.recycle.level = 2
    expect(validatePhysicalRoster(workspace).some(issue => ['SLOT_OVERFLOW', 'SLOT_INDEX', 'POWER_DEFICIT'].includes(issue.code))).toBe(false)
  })
})
