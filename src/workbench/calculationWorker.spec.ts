import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScheduleSimulationProgress } from '../simulator/scheduleSimulation'
import type { CalculationWorkerMessage } from './calculationWorker'
import { createCalculationResultReceiver } from './calculationResultTransport'

const { bridge, timeline } = vi.hoisted(() => ({ bridge: vi.fn(), timeline: vi.fn() }))
vi.mock('./calculationBridge', () => ({ runCalculationBridge: bridge }))
vi.mock('./timeline/timelineModel', () => ({ buildTimelineData: timeline }))
const worker = { onmessage: null as ((event: MessageEvent) => void | Promise<void>) | null, postMessage: vi.fn() }
beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
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

it('returns a complete large report through bounded messages when one large clone is rejected', async () => {
  const result = { success: true, simulationReport: { segments: Array.from({ length: 96 }, (_, index) => ({ index, detail: '报告片段'.repeat(4096) })) } }
  bridge.mockReturnValue(result)
  const timelineData = { events: Array.from({ length: 48 }, (_, index) => ({ index, description: '时间线'.repeat(4096) })) }
  timeline.mockReturnValue(timelineData)
  const accepted: CalculationWorkerMessage[] = []
  worker.postMessage.mockImplementation((message: { type: string; sequence?: number }) => {
    if (new TextEncoder().encode(JSON.stringify(message)).length > 512 * 1024) throw new DOMException('Data cannot be cloned, out of memory.', 'DataCloneError')
    accepted.push(structuredClone(message) as CalculationWorkerMessage)
    if (message.type === 'result-chunk') queueMicrotask(() => worker.onmessage!({ data: { type: 'result-ack', sequence: message.sequence } } as MessageEvent))
  })
  await worker.onmessage!({ data: { workspace: {}, options: {} } } as MessageEvent)
  expect(accepted.some(message => message.type === 'error')).toBe(false)
  expect(accepted.filter(message => message.type === 'result-chunk').length).toBeGreaterThan(1)
  expect(accepted[accepted.length - 1]?.type).toBe('result-end')
  const receiver = createCalculationResultReceiver()
  const transferred = accepted.filter(message => message.type !== 'progress' && message.type !== 'error')
  let completed
  for (const message of transferred) completed = receiver.accept(message).complete ?? completed
  expect(completed).toEqual({ result, timelineData })
})

it('reports a failed chunk send without announcing completion', async () => {
  bridge.mockReturnValue({ success: true, simulationReport: { segments: [{ detail: '报告'.repeat(200000) }] } })
  timeline.mockReturnValue(null)
  worker.postMessage.mockImplementation((message: CalculationWorkerMessage) => {
    if (message.type === 'result-chunk') throw new DOMException('chunk send failed', 'DataCloneError')
  })
  await worker.onmessage!({ data: { workspace: {}, options: {} } } as MessageEvent)
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'error', error: 'chunk send failed' })
  expect(worker.postMessage.mock.calls.some(([message]) => message.type === 'complete' || message.type === 'result-end')).toBe(false)
})
