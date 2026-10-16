import type { CalculationBridgeResult } from './calculationBridge'
import type { TimelineDataset } from './timeline/timelineModel'

export interface CalculationResultPayload {
  result: CalculationBridgeResult
  timelineData: TimelineDataset | null
}

type CalculationDataRecord =
  | { kind: 'value'; key: string | null; value: unknown }
  | { kind: 'open'; key: string | null; container: 'array' | 'object'; entries: number; length?: number }
  | { kind: 'string'; key: string | null; length: number }
  | { kind: 'text'; value: string }
  | { kind: 'close' }

export type CalculationResultMessage =
  | ({ type: 'complete' } & CalculationResultPayload)
  | { type: 'result-start'; version: 1; maxChunkBytes: number }
  | { type: 'result-chunk'; sequence: number; records: CalculationDataRecord[] }
  | { type: 'result-end'; chunks: number; records: number }

export interface CalculationResultAcknowledgement { type: 'result-ack'; sequence: number }

/** Conservative structural cost, not a measurement of browser structured-clone memory. */
export const CALCULATION_RESULT_CHUNK_BYTES = 512 * 1024
const ENVELOPE_BYTES = 256
const MIN_CHUNK_BYTES = 1024
const MAX_DEPTH = 128
const failure = (detail: string) => new Error(`产出计算报告传输失败：${detail}`)
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

/** Stop as soon as a subtree exceeds the budget; never stringify the complete report. */
function dataCost(value: unknown, budget: number, ancestors = new Set<object>(), depth = 0): number {
  if (typeof value === 'string') return 16 + value.length * 6
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return 16
  if (typeof value === 'bigint') return 16 + String(value).length * 2
  if (typeof value !== 'object') throw failure('报告包含不能传输的值')
  if (depth > MAX_DEPTH || ancestors.has(value)) throw failure('报告层级过深或包含循环引用')
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw failure('报告包含不支持的数据类型')
  ancestors.add(value)
  let cost = 32
  for (const key of Object.keys(value)) {
    cost += 16 + key.length * 6
    if (cost > budget) break
    cost += dataCost((value as Record<string, unknown>)[key], budget - cost, ancestors, depth + 1)
    if (cost > budget) break
  }
  ancestors.delete(value)
  return cost
}

function * recordsFor(value: unknown, key: string | null, budget: number, ancestors = new Set<object>()): Generator<CalculationDataRecord> {
  const valueRecord: CalculationDataRecord = { kind: 'value', key, value }
  if (dataCost(valueRecord, budget) <= budget) {
    yield valueRecord
    return
  }
  if (typeof value === 'string') {
    yield { kind: 'string', key, length: value.length }
    // Six bytes per UTF-16 code unit also covers escaped control characters and CJK.
    const units = Math.floor((budget - 256) / 6)
    for (let offset = 0; offset < value.length; offset += units) yield { kind: 'text', value: value.slice(offset, offset + units) }
    yield { kind: 'close' }
    return
  }
  if (value === null || typeof value !== 'object') throw failure('单个报告字段超过分块预算')
  if (ancestors.size >= MAX_DEPTH || ancestors.has(value)) throw failure('报告层级过深或包含循环引用')
  ancestors.add(value)
  const keys = Object.keys(value)
  yield { kind: 'open', key, container: Array.isArray(value) ? 'array' : 'object', entries: keys.length, ...(Array.isArray(value) ? { length: value.length } : {}) }
  for (const childKey of keys) yield * recordsFor((value as Record<string, unknown>)[childKey], childKey, budget, ancestors)
  yield { kind: 'close' }
  ancestors.delete(value)
}

/** One acknowledged chunk at a time bounds both clone staging and the message queue. */
export function createCalculationResultSender(send: (message: CalculationResultMessage) => void, options: { maxChunkBytes?: number } = {}) {
  const maxChunkBytes = options.maxChunkBytes ?? CALCULATION_RESULT_CHUNK_BYTES
  if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < MIN_CHUNK_BYTES || maxChunkBytes > CALCULATION_RESULT_CHUNK_BYTES) throw failure('分块预算无效')
  let used = false
  let failed: Error | undefined
  let pending: { sequence: number; resolve: () => void; reject: (error: Error) => void } | undefined

  function acknowledge(sequence: number): void {
    if (!pending || pending.sequence !== sequence) {
      failed = failure('报告确认序号不连续')
      pending?.reject(failed)
      pending = undefined
      throw failed
    }
    const accepted = pending
    pending = undefined
    accepted.resolve()
  }

  async function sendResult(payload: CalculationResultPayload): Promise<void> {
    if (used) throw failure('同一后台任务重复发送报告')
    used = true
    const complete: CalculationResultMessage = { type: 'complete', ...payload }
    if (dataCost(complete, maxChunkBytes - ENVELOPE_BYTES) <= maxChunkBytes - ENVELOPE_BYTES) {
      send(complete)
      return
    }
    send({ type: 'result-start', version: 1, maxChunkBytes })
    let chunks = 0
    let recordCount = 0
    let records: CalculationDataRecord[] = []
    let cost = ENVELOPE_BYTES
    const flush = async () => {
      if (failed) throw failed
      const acknowledgement = new Promise<void>((resolve, reject) => { pending = { sequence: chunks, resolve, reject } })
      try { send({ type: 'result-chunk', sequence: chunks, records }) }
      catch (error) { pending = undefined; throw error }
      await acknowledgement
      if (failed) throw failed
      chunks++
      recordCount += records.length
      records = []
      cost = ENVELOPE_BYTES
    }
    for (const record of recordsFor(payload, null, maxChunkBytes - ENVELOPE_BYTES)) {
      const size = dataCost(record, maxChunkBytes - ENVELOPE_BYTES)
      if (size > maxChunkBytes - ENVELOPE_BYTES) throw failure('单个报告字段超过分块预算')
      if (cost + size > maxChunkBytes) await flush()
      records.push(record)
      cost += size
    }
    if (records.length) await flush()
    send({ type: 'result-end', chunks, records: recordCount })
  }
  return { acknowledge, sendResult }
}

type ContainerFrame = { kind: 'container'; value: Record<string, unknown> | unknown[]; expected: number; received: number }
type TextFrame = { kind: 'text'; key: string | null; expected: number; received: number; parts: string[] }

/** Assemble into the final data tree, retaining no second report or complete JSON string. */
export function createCalculationResultReceiver() {
  let state: 'idle' | 'receiving' | 'complete' | 'failed' = 'idle'
  let maxChunkBytes = CALCULATION_RESULT_CHUNK_BYTES
  let chunks = 0
  let recordCount = 0
  let root: unknown
  let hasRoot = false
  const stack: (ContainerFrame | TextFrame)[] = []
  function assign(key: string | null, value: unknown): void {
    const parent = stack[stack.length - 1]
    if (!parent) {
      if (hasRoot || key !== null) throw failure('报告根节点重复或缺失')
      root = value
      hasRoot = true
      return
    }
    if (parent.kind !== 'container' || typeof key !== 'string' || parent.received >= parent.expected || own(parent.value, key)) throw failure('报告字段重复或层级错误')
    if (Array.isArray(parent.value) && /^(0|[1-9]\d*)$/.test(key) && Number(key) >= parent.value.length) throw failure('报告数组索引越界')
    // defineProperty preserves __proto__/constructor keys without invoking setters.
    Object.defineProperty(parent.value, key, { value, enumerable: true, writable: true, configurable: true })
    parent.received++
  }
  function consume(record: CalculationDataRecord): void {
    if (record.kind === 'value') assign(record.key, record.value)
    else if (record.kind === 'open') {
      if (stack.length >= MAX_DEPTH || !Number.isSafeInteger(record.entries) || record.entries < 0) throw failure('报告容器计数无效')
      if (record.container !== 'array' && record.container !== 'object') throw failure('报告容器类型无效')
      if (record.container === 'array' && (!Number.isSafeInteger(record.length) || record.length! < 0 || record.length! > 0xffffffff)) throw failure('报告数组长度无效')
      const value: Record<string, unknown> | unknown[] = record.container === 'array' ? new Array(record.length) : {}
      assign(record.key, value)
      stack.push({ kind: 'container', value, expected: record.entries, received: 0 })
    } else if (record.kind === 'string') {
      if (stack[stack.length - 1]?.kind === 'text' || stack.length >= MAX_DEPTH || !Number.isSafeInteger(record.length) || record.length < 0) throw failure('报告文本长度或层级无效')
      stack.push({ kind: 'text', key: record.key, expected: record.length, received: 0, parts: [] })
    } else if (record.kind === 'text') {
      const frame = stack[stack.length - 1]
      if (!frame || frame.kind !== 'text' || typeof record.value !== 'string' || frame.received + record.value.length > frame.expected) throw failure('报告文本分片越界')
      frame.parts.push(record.value)
      frame.received += record.value.length
    } else if (record.kind === 'close') {
      const frame = stack.pop()
      if (!frame || frame.received !== frame.expected) throw failure('报告容器或文本尚未完整')
      if (frame.kind === 'text') assign(frame.key, frame.parts.join(''))
    } else throw failure('报告记录类型无效')
  }
  function payload(value: unknown): CalculationResultPayload {
    if (!value || typeof value !== 'object' || !own(value, 'result') || !own(value, 'timelineData')) throw failure('报告结果缺失')
    const candidate = value as CalculationResultPayload
    if (!candidate.result || typeof candidate.result.success !== 'boolean') throw failure('报告结果无效')
    return candidate
  }
  function accept(message: CalculationResultMessage): { acknowledge?: number; complete?: CalculationResultPayload } {
    try {
      if (state === 'failed' || state === 'complete') throw failure('报告已结束')
      if (message.type === 'complete') {
        if (state !== 'idle') throw failure('分块报告被重复完成消息打断')
        // Existing small-result clients remain compatible; no large fast path is emitted.
        const complete = payload({ result: message.result, timelineData: message.timelineData ?? null })
        state = 'complete'
        return { complete }
      }
      if (message.type === 'result-start') {
        if (state !== 'idle' || message.version !== 1 || !Number.isSafeInteger(message.maxChunkBytes) || message.maxChunkBytes < MIN_CHUNK_BYTES || message.maxChunkBytes > CALCULATION_RESULT_CHUNK_BYTES) throw failure('报告传输头无效或重复')
        state = 'receiving'
        maxChunkBytes = message.maxChunkBytes
        return {}
      }
      if (state !== 'receiving') throw failure('尚未开始接收报告')
      if (message.type === 'result-chunk') {
        if (message.sequence !== chunks || !Array.isArray(message.records) || !message.records.length) throw failure('报告分块序号不连续或分块为空')
        let cost = ENVELOPE_BYTES
        for (const record of message.records) {
          cost += dataCost(record, maxChunkBytes - cost)
          if (cost > maxChunkBytes) throw failure('报告分块超过预算')
          consume(record)
        }
        recordCount += message.records.length
        return { acknowledge: chunks++ }
      }
      if (message.type !== 'result-end' || message.chunks !== chunks || message.records !== recordCount || !hasRoot || stack.length) throw failure('报告被截断或完成计数不一致')
      const complete = payload(root)
      root = undefined
      state = 'complete'
      return { complete }
    } catch (error) {
      state = 'failed'
      root = undefined
      stack.length = 0
      throw error
    }
  }
  return { accept }
}
