import { expect, it } from 'vitest'
import { createCalculationBottleneckTracker } from './calculationBottlenecks'
import type { SimulationActivity } from '../simulator/simulationActivity'
const activity = (overrides: Partial<SimulationActivity> = {}): SimulationActivity => ({
  status: 'slow', message: '慢', capturedHours: 19, windowSeconds: 15, advancedHours: .01,
  iterations: 500, operators: [], recentEvents: [], ...overrides,
})
it('retains the slowest window after recovery and phase-only progress without mutating inputs', () => {
  const tracker = createCalculationBottleneckTracker()
  const slow = activity({ operators: [{ id: 'test', name: '测试', morale: 3, upperLimit: 24, groups: ['绑组'], room: '设施', eventCount: 2 }] })
  tracker.observe({ label: '预热19h', fraction: .2, activity: slow }, 15)
  slow.operators[0]!.groups.push('后来添加')
  tracker.observe({ label: '预热20h', fraction: .3, activity: activity({ advancedHours: .2 }) }, 16)
  tracker.observe({ label: '采样', fraction: .9, activity: activity({ status: 'running', capturedHours: 100 }) }, 20)
  tracker.observe({ label: '汇总', fraction: .99 }, 21)
  const summary = tracker.finish({ outcome: 'completed', elapsedSeconds: 23 })
  expect(summary.progressLabel).toBe('汇总')
  expect(summary.slowest?.receivedSeconds).toBe(15)
  expect(summary.slowest?.activity.operators[0]!.groups).toEqual(['绑组'])
  expect(summary.latest?.activity.capturedHours).toBe(100)
  expect(summary.silence).toBeUndefined()
})
it('retains intervening constraints and filters report assumptions with bounded storage', () => {
  const tracker = createCalculationBottleneckTracker()
  for (let i = 0; i < 30; i++) tracker.observe({ label: '进度', fraction: .1, activity: activity({ status: 'running', findings: [{ code: 'group-blocked', kind: 'constraint', message: `曾报告 ${i}`, operatorIds: [] }] }) }, i)
  tracker.observe({ label: '恢复', fraction: .9, activity: activity({ status: 'running' }) }, 31)
  const summary = tracker.finish({ outcome: 'completed', elapsedSeconds: 32, diagnostics: [
    { code: 'MOWER_SCHEDULING_MODEL', message: '模型' },
    { code: 'SHIFT_DEFERRED_RECOVERED', message: '下班已恢复' },
  ] })
  expect(summary.diagnostics).toHaveLength(12)
  expect(summary.diagnostics.some(d => d.message === '曾报告 29')).toBe(true)
  expect(summary.diagnostics[summary.diagnostics.length - 1]?.message).toContain('下班已恢复')
  expect(summary.diagnostics.some(d => d.code === 'MOWER_SCHEDULING_MODEL')).toBe(false)
})
it('distinguishes no progress from no activity and computes silence at termination', () => {
  const tracker = createCalculationBottleneckTracker()
  expect(tracker.finish({ outcome: 'cancelled', elapsedSeconds: 20 })).toMatchObject({ silence: { seconds: 20, lastProgressSeconds: null }, diagnostics: [] })
  tracker.observe({ label: '汇总', fraction: .99 }, 10)
  const summary = tracker.finish({ outcome: 'failed', elapsedSeconds: 25.9, error: '失败' })
  expect(summary.silence).toEqual({ seconds: 15, lastProgressSeconds: 10 })
  expect(summary.latest).toBeUndefined()
  expect(summary.error).toBe('失败')
  expect(createCalculationBottleneckTracker().finish({ outcome: 'cancelled', elapsedSeconds: 1 }).diagnostics).toEqual([])
})
