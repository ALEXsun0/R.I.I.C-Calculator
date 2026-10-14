import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScheduleSimulationProgress } from '../simulator/scheduleSimulation'
import type { CalculationWorkerMessage } from './calculationWorker'

const { bridge, timeline } = vi.hoisted(() => ({ bridge: vi.fn(), timeline: vi.fn() }))
vi.mock('./calculationBridge', () => ({ runCalculationBridge: bridge }))
vi.mock('./timeline/timelineModel', () => ({ buildTimelineData: timeline }))
const worker = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: vi.fn() }
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('self', worker)
  await import('./calculationWorker')
})
afterEach(() => vi.unstubAllGlobals())

it('forwards activity unchanged with phase progress and completes normally', () => {
  const activity = { status: 'slow' as const, message: '观察', capturedHours: 73, windowSeconds: 15, advancedHours: .01, iterations: 5, operators: [], recentEvents: [] }
  bridge.mockImplementation((_workspace: unknown, _options: unknown, progress: (value: ScheduleSimulationProgress) => void) => {
    progress({ phase: 'sampling', elapsedHours: 73, warmupHours: 72, totalHours: 240, activity })
    return { success: true }
  })
  worker.onmessage!({ data: { workspace: {}, options: {} } } as MessageEvent)
  const messages = worker.postMessage.mock.calls.map(([message]) => message as CalculationWorkerMessage)
  expect(messages[1]).toEqual({ type: 'progress', progress: { label: '正在采样 1.0 / 168.0 小时', fraction: 73 / 240, activity } })
  expect(messages[messages.length - 1]).toEqual({ type: 'complete', result: { success: true }, timelineData: null })
})

it('reports an error after observed progress without pretending calculation completed', () => {
  bridge.mockImplementation((_workspace: unknown, _options: unknown, progress: (value: ScheduleSimulationProgress) => void) => {
    progress({ phase: 'warmup', elapsedHours: 1, warmupHours: 72, totalHours: 240 })
    throw new Error('simulation failed')
  })
  worker.onmessage!({ data: { workspace: {}, options: {} } } as MessageEvent)
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'error', error: 'simulation failed' })
  expect(worker.postMessage.mock.calls.some(([message]) => message.type === 'complete')).toBe(false)
})
