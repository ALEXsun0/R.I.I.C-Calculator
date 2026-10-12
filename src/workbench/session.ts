import { ref, shallowRef } from 'vue'
import type { CalculationReport } from '../domain/types'
import type { OwnedOperatorInput } from '../domain/operatorInventory'
import type { ScheduleSimulationReport } from '../simulator/scheduleSimulation'
import type { TimelineDataset } from './timeline/timelineModel'
import { createDefaultSimulationSettings } from './settings'

/** Shared state of one mounted workbench; each task owns its worker and lifecycle. */
export function createWorkbenchSession() {
  return {
    activeTab: ref<'workbench' | 'backup-plans' | 'skills' | 'settings' | 'logs'>('workbench'),
    simSettings: ref(createDefaultSimulationSettings()),
    operatorInventory: ref<{ enabled: boolean; valid: boolean; entries: OwnedOperatorInput[] }>({ enabled: true, valid: false, entries: [] }),
    calculationReport: shallowRef<CalculationReport | null>(null),
    calculationError: ref<string | null>(null),
    calculationStatus: ref<string | null>(null),
    simulationReport: shallowRef<ScheduleSimulationReport | null>(null),
    timelineData: shallowRef<TimelineDataset | null>(null),
    isCalculating: ref(false),
    isGeneratingRoster: ref(false),
    replaceStatusMessage: ref<string | null>(null),
  }
}

export type WorkbenchSession = ReturnType<typeof createWorkbenchSession>
