// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkbenchCalculation } from './useWorkbenchCalculation'
import { createWorkbenchSession } from '../session'
import { useRosterWorkbenchStore } from '../store'
import type { CalculationWorkerMessage } from '../calculationWorker'
import type { SimulationActivity } from '../../simulator/simulationActivity'

const workers: TestWorker[] = []
class TestWorker {
  onmessage: ((event: MessageEvent<CalculationWorkerMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { workers.push(this) }
  progress(activity?: SimulationActivity) { this.onmessage?.({ data: { type: 'progress', progress: { label: '正在采样', fraction: .99, activity } } } as MessageEvent<CalculationWorkerMessage>) }
}
let wrapper: VueWrapper
let api: ReturnType<typeof useWorkbenchCalculation>
let session: ReturnType<typeof createWorkbenchSession>
let store: ReturnType<typeof useRosterWorkbenchStore>
const start = () => api.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '', useOperatorInventory: false })
const slow: SimulationActivity = { status: 'slow', message: 'slow', capturedHours: 5, windowSeconds: 15, advancedHours: 0, iterations: 10, operators: [], recentEvents: [] }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  localStorage.clear()
  workers.length = 0
  vi.stubGlobal('Worker', TestWorker)
  setActivePinia(createPinia())
  store = useRosterWorkbenchStore()
  session = createWorkbenchSession()
  wrapper = mount(defineComponent({ setup() {
    api = useWorkbenchCalculation(store, session, computed(() => ({ isValid: true, criticalErrors: [], warnings: [], issues: [], power: { generation: 0, consumption: 0, margin: 0, sufficient: true } })))
    return () => h('div')
  } }))
})
afterEach(() => { wrapper.unmount(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('detects missing initial progress after 15 seconds without terminating the worker', () => {
  start()
  vi.advanceTimersByTime(14_999)
  expect(api.calculationSilence.value).toBeNull()
  vi.advanceTimersByTime(1)
  expect(api.calculationSilence.value).toEqual({ seconds: 15, lastProgressSeconds: null })
  expect(api.calculationTiming.value).toContain('暂无法估算')
  expect(workers[0]!.terminate).not.toHaveBeenCalled()
  expect(session.isCalculating.value).toBe(true)
})

it('retains last progress time, suppresses ETA for slow and silent work, and recovers on a new message', () => {
  start()
  vi.advanceTimersByTime(2000)
  workers[0]!.progress(slow)
  expect(api.calculationTiming.value).toContain('暂无法估算')
  expect(api.calculationTiming.value).not.toContain('即将完成')
  vi.advanceTimersByTime(15000)
  expect(api.calculationSilence.value).toMatchObject({ seconds: 15, lastProgressSeconds: 2 })
  expect(api.calculationProgress.value?.activity).toEqual(slow)
  workers[0]!.progress({ ...slow, status: 'running' })
  expect(api.calculationSilence.value).toBeNull()
  expect(api.calculationTiming.value).toContain('即将完成')
  vi.advanceTimersByTime(14000)
  expect(api.calculationSilence.value).toBeNull()
})

it('clears silence on cancellation and excludes progress and errors from an old worker', () => {
  start()
  vi.advanceTimersByTime(15000)
  api.handleAbortCalculation()
  expect(api.calculationSilence.value).toBeNull()
  expect(api.calculationProgress.value).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  start()
  workers[0]!.progress(slow)
  workers[0]!.onerror?.({ message: 'obsolete' } as ErrorEvent)
  expect(api.calculationProgress.value?.activity).toBeUndefined()
  expect(session.calculationError.value).toBeNull()
  vi.advanceTimersByTime(15000)
  expect(api.calculationSilence.value?.lastProgressSeconds).toBeNull()
  expect(session.isCalculating.value).toBe(true)
})

it('retains the last observation during a silent report summary without marking responsive summary as slow', () => {
  start()
  vi.advanceTimersByTime(2000)
  workers[0]!.progress(slow)
  vi.advanceTimersByTime(1000)
  workers[0]!.onmessage?.({ data: { type: 'progress', progress: { label: '正在汇总产出报告…', fraction: .99 } } } as MessageEvent<CalculationWorkerMessage>)
  expect(api.calculationProgress.value?.activity).toBeUndefined()
  expect(api.calculationTiming.value).toContain('即将完成')
  vi.advanceTimersByTime(15000)
  expect(api.calculationSilence.value).toEqual({ seconds: 15, lastProgressSeconds: 3, observation: { activity: slow, receivedSeconds: 2 } })
  expect(api.calculationTiming.value).toContain('暂无法估算')
  api.handleAbortCalculation()
  start()
  vi.advanceTimersByTime(15000)
  expect(api.calculationSilence.value?.observation).toBeUndefined()
})

it.each(['error', 'messageerror', 'reported-error', 'complete'] as const)('cleans timers and observations after %s and allows a new calculation', kind => {
  start()
  workers[0]!.progress(slow)
  vi.advanceTimersByTime(15000)
  if (kind === 'error') workers[0]!.onerror?.({ message: 'failed' } as ErrorEvent)
  else if (kind === 'messageerror') workers[0]!.onmessageerror?.()
  else if (kind === 'reported-error') workers[0]!.onmessage?.({ data: { type: 'error', error: 'failed' } } as MessageEvent<CalculationWorkerMessage>)
  else workers[0]!.onmessage?.({ data: { type: 'complete', result: { success: false, error: 'no result' }, timelineData: null } } as MessageEvent<CalculationWorkerMessage>)
  expect(session.isCalculating.value).toBe(false)
  expect(api.calculationSilence.value).toBeNull()
  expect(api.calculationProgress.value).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  start()
  expect(session.calculationError.value).toBeNull()
  expect(session.isCalculating.value).toBe(true)
  expect(api.calculationSilence.value).toBeNull()
})

it('discards observations when the roster changes or the component unmounts', () => {
  start()
  workers[0]!.progress(slow)
  vi.advanceTimersByTime(15000)
  store.workspace.name = 'changed'
  expect(api.calculationSilence.value).toBeNull()
  expect(session.isCalculating.value).toBe(false)
  start()
  wrapper.unmount()
  expect(workers[1]!.terminate).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
