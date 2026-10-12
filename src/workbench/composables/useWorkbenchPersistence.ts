import { onMounted, watch } from 'vue'
import { EDITION } from '../../domain/edition'
import { parseOperatorInventory, type OwnedOperatorInput } from '../../domain/operatorInventory'
import { normalizeProductionWeights } from '../../domain/productionWeights'
import type { AppConfig, CalculationReport } from '../../domain/types'
import type { RosterWorkspace } from '../../domain/roster'
import { migrateAppConfigToWorkspace } from '../migrate'
import { createDefaultSimulationSettings } from '../settings'
import type { WorkbenchSession } from '../session'
import type { useRosterWorkbenchStore } from '../store'

/** Preserves existing storage keys, v7 migration and operator-library interchange. */
export function useWorkbenchPersistence(store: ReturnType<typeof useRosterWorkbenchStore>, session: WorkbenchSession) {
  const { simSettings, operatorInventory, calculationReport, replaceStatusMessage } = session
  const defaultSimSettings = createDefaultSimulationSettings()
  watch(simSettings, value => {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(SIM_SETTINGS_STORAGE_KEY, JSON.stringify(value)) } catch { /* storage unavailable */ }
    }
  }, { deep: true })
  // Persistence keys matching existing store/edition pattern
  const WORKSPACE_STORAGE_KEY = `arc-income-calculator-workspace-v8-${EDITION.storageNamespace}`
  const V7_STORAGE_KEY = `arc-income-calculator-config-v7-${EDITION.storageNamespace}`
  const REPORT_STORAGE_KEY = `arc-income-calculator-report-v1-${EDITION.storageNamespace}`
  const SIM_SETTINGS_STORAGE_KEY = `arc-income-calculator-sim-settings-v1-${EDITION.storageNamespace}`

  function initPersistence(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return

    try {
      const rawWs = localStorage.getItem(WORKSPACE_STORAGE_KEY)
      if (rawWs) {
        const parsed = JSON.parse(rawWs)
        if (parsed?.schemaVersion === 8 && parsed?.mainPlan?.facilities) {
          // A default name and empty seats also describe a user-selected preset.
          // Restore saved recipes exactly; new workspaces already use current defaults.
          store.loadWorkspace(parsed as RosterWorkspace)
        }
      } else {
        const rawV7 = localStorage.getItem(V7_STORAGE_KEY)
        if (rawV7) {
          const parsedV7 = JSON.parse(rawV7)
          if (parsedV7?.schemaVersion === 7 && Array.isArray(parsedV7?.rooms)) {
            const migratedWs = migrateAppConfigToWorkspace(parsedV7 as AppConfig)
            store.loadWorkspace(migratedWs)
          }
        }
      }

      const rawRep = localStorage.getItem(REPORT_STORAGE_KEY)
      if (rawRep) {
        const parsedRep = JSON.parse(rawRep)
        if (parsedRep?.power) {
          calculationReport.value = parsedRep as CalculationReport
        }
      }

      const rawSim = localStorage.getItem(SIM_SETTINGS_STORAGE_KEY)
      if (rawSim) {
        const parsedSim = JSON.parse(rawSim)
        if (parsedSim?.sampleDays) {
          let productionWeights = normalizeProductionWeights()
          try { productionWeights = normalizeProductionWeights(parsedSim.productionWeights) } catch { /* retain defaults for invalid saved coefficients */ }
          simSettings.value = { ...defaultSimSettings, ...parsedSim, productionWeights }
        }
      }

      const rawInv = localStorage.getItem('arcinc-operator-inventory-v1')
      if (rawInv) {
        const parsedInv = JSON.parse(rawInv)
        if (parsedInv?.text) {
          const compiled = parseOperatorInventory(parsedInv.text)
          if (compiled.valid) {
            operatorInventory.value = {
              enabled: parsedInv.enabled ?? true,
              valid: true,
              entries: compiled.entries,
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to restore persisted workbench state:', e)
    }
  }

  onMounted(() => {
    initPersistence()
  })

  // Persist workspace changes
  watch(
    () => store.workspace,
    (ws) => {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
      try {
        localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(ws))
      } catch {
        // ignore storage quota errors
      }
    },
    { deep: true },
  )

  // Persist calculation report
  watch(
    calculationReport,
    (rep) => {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
      try {
        if (rep) {
          localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(rep))
        } else {
          localStorage.removeItem(REPORT_STORAGE_KEY)
        }
      } catch {
        // ignore
      }
    },
    { deep: true },
  )

  // Sync plan name changes to mainPlan.name
  watch(
    () => store.workspace.name,
    (newName) => {
      if (newName && store.workspace.mainPlan) {
        store.workspace.mainPlan.name = newName
      }
    },
  )

  function handleInventoryChange(payload: { enabled: boolean; valid: boolean; entries: OwnedOperatorInput[] }): void {
    operatorInventory.value = payload
  }

  function handleInventoryImported(entries: OwnedOperatorInput[], csvText: string): void {
    operatorInventory.value = {
      enabled: true,
      valid: true,
      entries,
    }
    replaceStatusMessage.value = `成功导入干员库：共 ${entries.length} 名干员`
    try {
      localStorage.setItem('arcinc-operator-inventory-v1', JSON.stringify({ schemaVersion: 1, text: csvText, enabled: true }))
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('arcinc-inventory-synced', { detail: { text: csvText, enabled: true } }))
    }
  }

  return { handleInventoryChange, handleInventoryImported }
}
