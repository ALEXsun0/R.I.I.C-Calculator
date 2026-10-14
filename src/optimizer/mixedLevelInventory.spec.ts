import { it, expect } from 'vitest'
import entries from './fixtures/mixed-level-inventory.json'
import { compileOperatorInventory } from '../domain/operatorInventory'
import { createDefaultWorkspace } from '../workbench/defaults'
import { generateMolecularCandidates, evaluateMolecularCandidates } from './molecularSynthesis'
import { validatePhysicalRoster } from './rosterDraft'

it('validates mixed actual levels through 24h warmup and 72h dynamic roster simulation', async ({annotate}) => {
  await annotate('实际练度完整模拟回归')
  const base=createDefaultWorkspace(),before=structuredClone(base),originalEntries=structuredClone(entries)
  const inventory=compileOperatorInventory(entries)
  expect(inventory.valid, JSON.stringify(inventory.diagnostics)).toBe(true)
  // Verify actual-level branch admission through the real 24h + 72h simulation.
  // Full main/relief ordering and replacement are covered by smartRoster specs.
  const candidates=generateMolecularCandidates(base,entries,inventory,{branchCount:1,seed:42})
  const evaluated=evaluateMolecularCandidates(candidates,entries,{warmupHours:24,sampleHours:72,seed:42})
  const completed=evaluated.filter(candidate=>candidate.simScore!==null)
  expect(completed, JSON.stringify(evaluated.map(candidate=>({score:candidate.simScore,diagnostics:candidate.diagnostics})))).toHaveLength(1)
  const result=completed[0]!
  expect(result.simScore).toBeGreaterThan(0)
  expect(validatePhysicalRoster(result.workspace)).toEqual([])
  expect(base).toEqual(before)
  expect(entries).toEqual(originalEntries)
},300000)
