import { OPERATOR_MAP } from '../domain/operators'
import type { OperatorInventory } from '../domain/operatorInventory'
import type { EfficiencyResources } from '../domain/types'
import type { CompiledSchedule } from '../scheduler/types'
import { validateScheduleInventory } from '../scheduler/inventoryValidation'
export { validateScheduleInventory, type ScheduleInventoryDiagnostic } from '../scheduler/inventoryValidation'
import { selectCombinationCandidates, type CandidateAvailability } from './combinationCandidates'

export interface CandidateAdmission {
  candidate: CandidateAvailability
  status: 'invalid-inventory' | 'missing-operators' | 'skills-locked' | 'needs-context'
  /** Catalog evidence uses full maximum snapshots, not minimum room-specific requirements. */
  lockedSkills: {operatorName:string;buffId:string;skillName:string;unlockPhase:number;unlockLevel:number}[]
}
export function admitCombinationCandidates(inventory: OperatorInventory): CandidateAdmission[] {
  const owned = new Map(inventory.operators.map(o => [o.charId,o]))
  const selection = selectCombinationCandidates([...owned.keys()])
  return [...selection.available,...selection.unavailable].map(candidate => {
    const lockedSkills = candidate.evidence.buffIdsByOperator.flatMap(entry => {
      const operator = owned.get(entry.operator.charId)
      return operator ? entry.buffIds.filter(id=>!operator.skills.some(s=>s.buffId===id)).map(buffId=>{
        const skill=OPERATOR_MAP.get(operator.charId)!.skills.find(s=>s.buffId===buffId)!
        return {operatorName:operator.name,buffId,skillName:skill.name,unlockPhase:skill.unlockPhase,unlockLevel:skill.unlockLevel}
      }) : []
    })
    return {candidate,lockedSkills,status:!inventory.valid?'invalid-inventory':!candidate.isFullyOwned?'missing-operators':lockedSkills.length?'skills-locked':'needs-context'}
  })
}

/** Static catalog projections still require their maximum-skill template evidence. */
export function validateCatalogScheduleInventory(schedule: CompiledSchedule, inventory: OperatorInventory, resources?: Partial<EfficiencyResources>) {
  const admission = validateScheduleInventory(schedule, inventory, resources)
  for (const operator of inventory.operators) {
    if (admission.participantIds.includes(operator.charId) && !operator.matchesMaximumSkills) {
      admission.diagnostics.push({ code: 'INVENTORY_SKILL_STAGE_UNSUPPORTED', operatorName: operator.name,
        message: operator.name + '：静态组合模板仅支持最高技能快照；实际练度请使用动态模拟' })
    }
  }
  return { ...admission, valid: admission.valid && admission.diagnostics.length === 0 }
}
