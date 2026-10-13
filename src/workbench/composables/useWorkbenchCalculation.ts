import { mowerAdvancedAssumptions } from '../../scheduler/mowerAdvancedSettings'
import { computed, onBeforeUnmount, ref, toRaw, watch, type ComputedRef } from 'vue'
import { parseOperatorInventory, type OwnedOperatorInput } from '../../domain/operatorInventory'
import { normalizeProductionWeights } from '../../domain/productionWeights'
import type { CalculationWorkerMessage, CalculationProgress } from '../calculationWorker'
import type { CalculationConfig } from '../settings'
import type { WorkbenchSession } from '../session'
import type { useRosterWorkbenchStore } from '../store'
import type { ValidationResult } from '../validate'

/** Owns independent income calculation, cancellation and stale worker messages. */
export function useWorkbenchCalculation(store: ReturnType<typeof useRosterWorkbenchStore>, session: WorkbenchSession, validationResult: ComputedRef<ValidationResult>) {
  const { simSettings, operatorInventory, isCalculating, isGeneratingRoster, calculationReport, calculationError, calculationStatus, simulationReport, timelineData } = session
  const calculationConfigOpen = ref(false)
  const calculationProgress = ref<CalculationProgress | null>(null)
  const calculationElapsed = ref(0)
  let calculationWorker: Worker | null = null
  let calculationTimer: ReturnType<typeof setInterval> | undefined
  const calculationTiming = computed(() => {
    const seconds = Math.floor(calculationElapsed.value)
    const elapsed = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
    const fraction = calculationProgress.value?.fraction ?? 0
    if (fraction >= .99) return `已用 ${elapsed} · 即将完成`
    if (seconds < 3 || fraction < .01) return `已用 ${elapsed} · 剩余时间估算中`
    const remaining = Math.max(1, Math.ceil(seconds * (1 - fraction) / fraction))
    return `已用 ${elapsed} · 约剩余 ${remaining < 60 ? `${remaining} 秒` : `${Math.ceil(remaining / 60)} 分钟`}`
  })

  function stopCalculation(): void {
    const worker = calculationWorker
    calculationWorker = null
    worker?.terminate()
    clearInterval(calculationTimer)
    calculationTimer = undefined
    isCalculating.value = false
    calculationProgress.value = null
  }
  function handleAbortCalculation(): void {
    stopCalculation()
    calculationStatus.value = '已中止产出计算，可重新开始。'
  }
  watch(() => store.workspace, () => {
    if (isCalculating.value) {
      stopCalculation()
      calculationStatus.value = '排班已变更，本次产出计算已中止，请重新计算。'
    }
  }, { deep: true, flush: 'sync' })
  onBeforeUnmount(stopCalculation)

  function handleCalculate(): void {
    if (isCalculating.value || isGeneratingRoster.value) return
    calculationError.value = null
    if (!validationResult.value.isValid) {
      calculationError.value = '排班存在阻断错误，请根据下方诊断信息修复后再计算。'
      return
    }
    calculationConfigOpen.value = true
  }

  function handleConfirmCalculation(config: CalculationConfig): void {
    calculationConfigOpen.value = false
    if (isCalculating.value || isGeneratingRoster.value) return
    simSettings.value = { ...simSettings.value, ...config }
    executeCalculation()
  }

  function executeCalculation(): void {
    if (isCalculating.value) return
    calculationError.value = null
    calculationStatus.value = null
    if (!validationResult.value.isValid) {
      calculationError.value = '排班存在阻断错误，请根据下方诊断信息修复后再计算。'
      return
    }
    calculationReport.value = null
    simulationReport.value = null
    timelineData.value = null
    isCalculating.value = true
    calculationElapsed.value = 0
    calculationProgress.value = { label: '正在准备计算…', fraction: 0 }
    const started = performance.now()
    calculationTimer = setInterval(() => { calculationElapsed.value = (performance.now() - started) / 1000 }, 1000)
    try {
      let inventoryEntries: OwnedOperatorInput[] | undefined
      if (simSettings.value.useOperatorInventory !== false) {
        let inventory = operatorInventory.value
        const saved = localStorage.getItem('arcinc-operator-inventory-v1')
        if (saved) {
          const parsed = JSON.parse(saved)
          const compiled = parseOperatorInventory(parsed.text ?? '')
          inventory = { enabled: parsed.enabled ?? true, valid: compiled.valid, entries: compiled.entries }
        }
        if (inventory.enabled) {
          if (!inventory.valid) throw new Error('当前干员库配置无效，请修正或取消使用干员库配置。')
          inventoryEntries = JSON.parse(JSON.stringify(toRaw(inventory.entries)))
        }
      }
      if (simSettings.value.jayeElite0 && inventoryEntries) {
        const jIdx = inventoryEntries.findIndex(e => e.operator === '孑' || e.operator === 'char_272_strong')
        if (jIdx >= 0) {
          inventoryEntries[jIdx] = { ...inventoryEntries[jIdx]!, elitePhase: 0, level: 1 }
        }
      }

      const options = {
        engine: 'simulation' as const,
        jayeElite0: simSettings.value.jayeElite0 ?? false,
        simulationAssumptions: {
          fiammettaFool: simSettings.value.fiammettaFool ?? true,
          fiammettaThreshold: simSettings.value.fiammettaThreshold ?? .9,
          restingThreshold: simSettings.value.restingThreshold ?? .65,
          rescueThreshold: simSettings.value.rescueThreshold ?? .75,
          freeRoom: simSettings.value.freeRoom ?? false,
          ...mowerAdvancedAssumptions(store.workspace),
        },
        simulationOptions: {
          productionWeights: normalizeProductionWeights(simSettings.value.productionWeights),
          warmupHours: simSettings.value.warmupDays * 24,
          sampleHours: simSettings.value.sampleDays * 24,
          maxStepHours: simSettings.value.step,
          warmupModel: 'hourly' as const,
          recordSegments: true,
          jayeElite0: simSettings.value.jayeElite0 ?? false,
          operatorInventory: inventoryEntries,
          production: {
            outputMode: 'potential' as const,
            runOrderMode: 'ideal' as const,
            seed: simSettings.value.seed < 0
              ? (typeof process !== 'undefined' && Boolean(process.env?.VITEST) ? 42 : Math.floor(Math.random() * 0xffffffff))
              : simSettings.value.seed,
            droneTarget: simSettings.value.droneTarget,
            droneRoomId: simSettings.value.droneRoomId || undefined,
            droneTradingRoomId: simSettings.value.droneTradingRoomId || undefined,
          },
        },
      }

      const worker = new Worker(new URL('../calculationWorker.ts', import.meta.url), { type: 'module' })
      calculationWorker = worker
      worker.onmessage = (event: MessageEvent<CalculationWorkerMessage>) => {
        if (calculationWorker !== worker) return
        const message = event.data
        if (message.type === 'progress') {
          calculationProgress.value = message.progress
        } else if (message.type === 'complete') {
          const result = message.result
          simulationReport.value = result.simulationReport ?? null
          timelineData.value = message.timelineData
          if (result.success && result.report) calculationReport.value = result.report
          else calculationError.value = result.error ?? '收益计算未成功完成'
          stopCalculation()
        } else if (message.type === 'error') {
          calculationError.value = message.error
          stopCalculation()
        }
      }
      const fail = (message: string) => {
        if (calculationWorker !== worker) return
        calculationError.value = message
        stopCalculation()
      }
      worker.onerror = event => fail(`产出计算失败：${event.message || '后台任务执行失败'}`)
      worker.onmessageerror = () => fail('产出计算报告传输失败，请重试。')
      worker.postMessage(JSON.parse(JSON.stringify({ workspace: toRaw(store.workspace), options })))
    } catch (error) {
      calculationError.value = `无法启动后台计算：${error instanceof Error ? error.message : String(error)}`
      stopCalculation()
    }
  }

  return { calculationConfigOpen, calculationProgress, calculationTiming, handleCalculate, handleConfirmCalculation, handleAbortCalculation }
}
