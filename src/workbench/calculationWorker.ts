import { runCalculationBridge, type CalculationBridgeOptions } from './calculationBridge'
import type { RosterWorkspace } from '../domain/roster'
import { buildTimelineData } from './timeline/timelineModel'
import type { SimulationActivity } from '../simulator/simulationActivity'
import { createCalculationResultSender, type CalculationResultAcknowledgement, type CalculationResultMessage } from './calculationResultTransport'

export interface CalculationProgress { label: string; fraction: number; activity?: SimulationActivity }
export type CalculationWorkerMessage =
  | { type: 'progress'; progress: CalculationProgress }
  | CalculationResultMessage
  | { type: 'error'; error: string }

export type CalculationWorkerRequest = { workspace: RosterWorkspace; options: CalculationBridgeOptions } | CalculationResultAcknowledgement

const send = (message: CalculationWorkerMessage) => self.postMessage(message)
const sender = createCalculationResultSender(send)
let started = false
self.onmessage = async (event: MessageEvent<CalculationWorkerRequest>) => {
  try {
    if ('type' in event.data && event.data.type === 'result-ack') {
      sender.acknowledge(event.data.sequence)
      return
    }
    if (!('workspace' in event.data) || started) throw new Error('后台计算请求重复或无效')
    started = true
    send({ type: 'progress', progress: { label: '正在准备排班与干员数据…', fraction: 0 } })
    const result = runCalculationBridge(event.data.workspace, event.data.options, p => {
      const warmup = p.phase === 'warmup'
      const done = warmup ? p.elapsedHours : p.elapsedHours - p.warmupHours
      const total = warmup ? p.warmupHours : p.totalHours - p.warmupHours
      send({ type: 'progress', progress: {
        label: `正在${warmup ? '预热' : '采样'} ${done.toFixed(1)} / ${total.toFixed(1)} 小时`,
        fraction: Math.min(.99, p.elapsedHours / p.totalHours),
        activity: p.activity,
      } })
    })
    send({ type: 'progress', progress: { label: '正在汇总产出报告…', fraction: .99 } })
    const timelineData = result.simulationReport ? buildTimelineData(result.simulationReport) : null
    await sender.sendResult({ result, timelineData })
  } catch (error) {
    send({ type: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}
