import { expect, it } from 'vitest'
import { CALCULATION_RESULT_CHUNK_BYTES, createCalculationResultReceiver, createCalculationResultSender, type CalculationResultMessage, type CalculationResultPayload } from './calculationResultTransport'

function report(extra: Record<string, unknown> = {}): CalculationResultPayload {
  return {
    result: { success: false, report: null, error: 'fixture only', validation: {
      isValid: true, criticalErrors: [], warnings: [], issues: [],
      power: { generation: 0, consumption: 0, margin: 0, sufficient: true },
      ...extra,
    } },
    timelineData: { totalHours: 744, warmupHours: 72, observedHours: 672, facilityTracks: [], operatorTracks: [], events: [] },
  }
}
const large = () => report({ segments: Array.from({ length: 20 }, (_, index) => ({ index, text: '完整报告中文\u0000😀'.repeat(90) })) })

async function capture(payload: CalculationResultPayload, maxChunkBytes = 4096) {
  const messages: CalculationResultMessage[] = []
  const sender = createCalculationResultSender(message => {
    messages.push(structuredClone(message))
    if (message.type === 'result-chunk') queueMicrotask(() => sender.acknowledge(message.sequence))
  }, { maxChunkBytes })
  await sender.sendResult(payload)
  return messages
}

it('keeps the complete message for genuinely small results', async () => {
  const payload = report()
  const messages = await capture(payload, CALCULATION_RESULT_CHUNK_BYTES)
  expect(messages).toEqual([{ type: 'complete', ...payload }])
  expect(createCalculationResultReceiver().accept(messages[0]!)).toEqual({ complete: payload })
})

it('round trips every field through bounded clones without retaining or stringifying a complete JSON document', async () => {
  const payload = large()
  const original = structuredClone(payload)
  const messages = await capture(payload)
  expect(messages[0]?.type).toBe('result-start')
  expect(messages[messages.length - 1]?.type).toBe('result-end')
  expect(messages.filter(message => message.type === 'result-chunk').length).toBeGreaterThan(10)
  const receiver = createCalculationResultReceiver()
  let completed: CalculationResultPayload | undefined
  for (const message of messages) {
    expect(new TextEncoder().encode(JSON.stringify(message)).length).toBeLessThanOrEqual(4096)
    const received = receiver.accept(message)
    if (message.type === 'result-chunk') expect(received).toEqual({ acknowledge: message.sequence })
    else if (message.type !== 'result-end') expect(received.complete).toBeUndefined()
    completed = received.complete ?? completed
  }
  expect(completed).toEqual(original)
  expect(payload).toEqual(original)
})

it('splits an oversized scalar and preserves UTF-16, empty containers, sparse arrays, undefined and exceptional numbers', async () => {
  const sparse = new Array(5)
  sparse[3] = undefined
  const payload = report({ text: '至简😀\u0000\ud800\udc00'.repeat(4000), emptyArray: [], emptyObject: {}, undefined, nan: NaN, positive: Infinity, negative: -Infinity, negativeZero: -0, sparse })
  const receiver = createCalculationResultReceiver()
  let completed: CalculationResultPayload | undefined
  for (const message of await capture(payload, 1024)) completed = receiver.accept(message).complete ?? completed
  expect(completed).toEqual(payload)
  expect(Object.prototype.hasOwnProperty.call(completed!.result.validation, 'undefined')).toBe(true)
  expect(Object.is(Reflect.get(completed!.result.validation, 'negativeZero'), -0)).toBe(true)
  expect(Object.keys(Reflect.get(completed!.result.validation, 'sparse'))).toEqual(['3'])
})

it('preserves dangerous own keys across container boundaries without modifying prototypes', async () => {
  const edge = { ['__proto__']: { polluted: '值'.repeat(10000) }, constructor: { prototype: '保留' }, prototype: {} }
  const payload = report({ edge })
  const receiver = createCalculationResultReceiver()
  let completed: CalculationResultPayload | undefined
  for (const message of await capture(payload)) completed = receiver.accept(message).complete ?? completed
  const restored = Reflect.get(completed!.result.validation, 'edge')
  expect(restored).toEqual(edge)
  expect(Object.prototype.hasOwnProperty.call(restored, '__proto__')).toBe(true)
  expect(Object.getPrototypeOf(restored)).toBe(Object.prototype)
  expect(Reflect.get({}, 'polluted')).toBeUndefined()
})

it('waits for each acknowledgement before posting the next chunk or completion', async () => {
  const messages: CalculationResultMessage[] = []
  const sender = createCalculationResultSender(message => messages.push(message), { maxChunkBytes: 4096 })
  const sent = sender.sendResult(large())
  expect(messages.map(message => message.type)).toEqual(['result-start', 'result-chunk'])
  await Promise.resolve()
  expect(messages).toHaveLength(2)
  let acknowledged = -1
  while (messages[messages.length - 1]?.type !== 'result-end') {
    const last = messages[messages.length - 1]!
    expect(last.type).toBe('result-chunk')
    if (last.type !== 'result-chunk') throw new Error('Expected chunk')
    expect(last.sequence).toBe(++acknowledged)
    sender.acknowledge(last.sequence)
    await Promise.resolve()
    await Promise.resolve()
  }
  await sent
})

it.each(['out-of-order', 'duplicate'] as const)('rejects %s acknowledgements and never emits completion', async kind => {
  const messages: CalculationResultMessage[] = []
  const sender = createCalculationResultSender(message => messages.push(message), { maxChunkBytes: 4096 })
  const sent = sender.sendResult(large())
  const rejected = expect(sent).rejects.toThrow('确认序号不连续')
  if (kind === 'duplicate') sender.acknowledge(0)
  expect(() => sender.acknowledge(kind === 'duplicate' ? 0 : 1)).toThrow('确认序号不连续')
  await rejected
  expect(messages.some(message => message.type === 'result-end')).toBe(false)
})

it('surfaces a clone/send failure without emitting result-end', async () => {
  const messages: CalculationResultMessage[] = []
  const sender = createCalculationResultSender(message => {
    messages.push(message)
    if (message.type === 'result-chunk') throw new DOMException('clone rejected', 'DataCloneError')
  })
  await expect(sender.sendResult(report({ text: '巨大报告'.repeat(200000) }))).rejects.toThrow('clone rejected')
  expect(messages.map(message => message.type)).toEqual(['result-start', 'result-chunk'])
})

it('rejects repeated sends, cycles and unsupported report values explicitly', async () => {
  const sender = createCalculationResultSender(() => {})
  await sender.sendResult(report())
  await expect(sender.sendResult(report())).rejects.toThrow('重复发送')
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  await expect(createCalculationResultSender(() => {}).sendResult(report({ cyclic }))).rejects.toThrow('循环引用')
  await expect(createCalculationResultSender(() => {}).sendResult(report({ date: new Date(0) }))).rejects.toThrow('不支持的数据类型')
})

it('fails explicitly for an individual property name larger than the budget instead of dropping it', async () => {
  const messages: CalculationResultMessage[] = []
  const sender = createCalculationResultSender(message => {
    messages.push(message)
    if (message.type === 'result-chunk') queueMicrotask(() => sender.acknowledge(message.sequence))
  }, { maxChunkBytes: 4096 })
  await expect(sender.sendResult(report({ ['超长未知键'.repeat(2000)]: '保留或明确失败' }))).rejects.toThrow('字段超过分块预算')
  expect(messages.some(message => message.type === 'complete' || message.type === 'result-end')).toBe(false)
})

it.each(['before-start', 'duplicate-start', 'out-of-order', 'duplicate-chunk', 'truncated', 'wrong-record-count', 'unclosed'] as const)('rejects %s streams before publishing a report', async kind => {
  const messages = await capture(large())
  const start = messages[0]!
  const firstChunk = messages[1]!
  const end = messages[messages.length - 1]!
  const receiver = createCalculationResultReceiver()
  if (kind === 'before-start') expect(() => receiver.accept(firstChunk)).toThrow('尚未开始')
  else {
    receiver.accept(start)
    if (kind === 'duplicate-start') expect(() => receiver.accept(start)).toThrow('传输头')
    else if (kind === 'out-of-order') expect(() => receiver.accept({ ...firstChunk, sequence: 1 } as CalculationResultMessage)).toThrow('序号不连续')
    else if (kind === 'duplicate-chunk') {
      receiver.accept(firstChunk)
      expect(() => receiver.accept(firstChunk)).toThrow('序号不连续')
    } else if (kind === 'truncated') expect(() => receiver.accept(end)).toThrow('截断')
    else if (kind === 'wrong-record-count') {
      for (const message of messages.slice(1, -1)) receiver.accept(message)
      expect(() => receiver.accept({ ...end, records: 0 } as CalculationResultMessage)).toThrow('计数不一致')
    } else {
      receiver.accept({ type: 'result-chunk', sequence: 0, records: [{ kind: 'open', key: null, container: 'object', entries: 1 }] })
      expect(() => receiver.accept({ type: 'result-end', chunks: 1, records: 1 })).toThrow('截断')
    }
  }
  expect(() => receiver.accept(end)).toThrow('已结束')
})

it('rejects a container closed before all entries arrive and overlong text parts', () => {
  const receiver = createCalculationResultReceiver()
  receiver.accept({ type: 'result-start', version: 1, maxChunkBytes: 4096 })
  expect(() => receiver.accept({ type: 'result-chunk', sequence: 0, records: [
    { kind: 'open', key: null, container: 'object', entries: 1 }, { kind: 'close' },
  ] })).toThrow('尚未完整')
  const text = createCalculationResultReceiver()
  text.accept({ type: 'result-start', version: 1, maxChunkBytes: 4096 })
  expect(() => text.accept({ type: 'result-chunk', sequence: 0, records: [{ kind: 'string', key: null, length: 1 }, { kind: 'text', value: 'too long' }] })).toThrow('文本分片越界')
})
