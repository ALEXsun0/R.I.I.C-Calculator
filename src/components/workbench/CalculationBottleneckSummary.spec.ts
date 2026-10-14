// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import CalculationBottleneckSummaryView from './CalculationBottleneckSummary.vue'
import type { CalculationBottleneckSummary } from '../../workbench/calculationBottlenecks'
import type { SimulationActivity } from '../../simulator/simulationActivity'

const activity: SimulationActivity = {
  status: 'slow', message: '演算正在推进。', capturedHours: 48, windowSeconds: 15, advancedHours: .03, iterations: 80,
  operators: [{ id: 'aroma', name: '阿罗玛', morale: 2, upperLimit: 20, groups: ['贸易组'], room: 'room_1_1', eventCount: 4 }],
  recentEvents: [{ label: '下班', count: 4 }],
  task: { label: '下班', metadata: '阿罗玛', rooms: ['room_1_1'], dueHours: 48, source: 'active' },
}
const summary: CalculationBottleneckSummary = { outcome: 'completed', elapsedSeconds: 90, progressLabel: '正在汇总产出报告', diagnostics: [] }

it('keeps slow history separate from the last recovered observation and collapses details initially', () => {
  const wrapper = mount(CalculationBottleneckSummaryView, { props: { summary: { ...summary,
    slowest: { activity, receivedSeconds: 25 }, latest: { activity: { ...activity, status: 'running', capturedHours: 240, advancedHours: 24, task: { ...activity.task!, source: 'queued' } }, receivedSeconds: 88 },
  } } })
  expect(wrapper.text()).toContain('演算已完成')
  expect(wrapper.get('[data-test="bottleneck-headline"]').text()).toContain('尚未确定卡点原因')
  expect(wrapper.get('[data-test="bottleneck-slowest"]').text()).toContain('推进较慢')
  expect(wrapper.get('[data-test="bottleneck-slowest"]').text()).toContain('48.00 小时')
  expect(wrapper.get('[data-test="bottleneck-latest"]').text()).toContain('正常推进')
  expect(wrapper.get('[data-test="bottleneck-latest"]').text()).toContain('240.00 小时')
  expect(wrapper.get('[data-test="bottleneck-latest"]').text()).toContain('观测时队列任务（不代表已执行）')
  expect(wrapper.text()).toContain('阿罗玛 · 心情 2.00 / 20.00')
  expect(wrapper.text()).toContain('绑组 贸易组 · 设施 room_1_1')
  expect(wrapper.text()).toContain('下班 4 次')
  expect(wrapper.text()).not.toContain('演算正在推进')
  expect(wrapper.text()).not.toContain('计算尚未停止')
  expect((wrapper.get('[data-test="bottleneck-details"]').element as HTMLDetailsElement).open).toBe(false)
  wrapper.unmount()
})

it('distinguishes observed constraints from activity correlations and external errors', () => {
  const findings = [
    { code: 'bound', kind: 'constraint' as const, message: '替补正在占用，换班延后。', operatorIds: ['aroma'] },
    { code: 'repeated', kind: 'activity' as const, message: '近期重复触发菲亚充能。', operatorIds: ['aroma'] },
  ]
  const observation = { activity: { ...activity, findings }, receivedSeconds: 25 }
  const wrapper = mount(CalculationBottleneckSummaryView, { props: { summary: { ...summary, outcome: 'failed', latest: observation, slowest: observation,
    error: 'Worker unavailable', diagnostics: [{ code: 'plan-warning', message: '替补存在共享约束。' }],
  } } })
  expect(wrapper.get('[data-test="bottleneck-headline"]').text()).toContain('1 项历史诊断')
  expect(wrapper.text()).toContain('调度约束：替补正在占用')
  expect(wrapper.text()).toContain('活动观察：近期重复触发')
  expect(wrapper.text()).toContain('不能据此认定变慢根因')
  expect(wrapper.get('[data-test="bottleneck-error"]').text()).toBe('计算错误：Worker unavailable')
  expect(wrapper.get('[data-test="bottleneck-diagnostics"]').text()).toContain('替补存在共享约束')
  wrapper.unmount()
})

it('surfaces historical diagnostics even when the last observation has recovered', () => {
  const wrapper = mount(CalculationBottleneckSummaryView, { props: { summary: { ...summary,
    latest: { activity: { ...activity, status: 'running' }, receivedSeconds: 80 },
    diagnostics: [{ code: 'SHIFT_DEFERRED_RECOVERED', message: '此前换班延后已恢复。' }],
  } } })
  expect(wrapper.get('[data-test="bottleneck-headline"]').text()).toContain('含已恢复记录')
  expect(wrapper.get('[data-test="bottleneck-headline"]').text()).toContain('此前换班延后已恢复')
  expect(wrapper.text()).not.toContain('未记录到明确卡点')
  expect(wrapper.text()).toContain('历史调度约束不表示结束时仍未解决')
  wrapper.unmount()
})

it.each(['completed', 'cancelled', 'failed', 'changed'] as const)('does not invent observations after %s', outcome => {
  const wrapper = mount(CalculationBottleneckSummaryView, { props: { summary: { ...summary, outcome, progressLabel: '', silence: { seconds: 18, lastProgressSeconds: null } } } })
  expect(wrapper.text()).toContain('未收到演算观测，无法判断卡点')
  expect(wrapper.text()).toContain('本次未收到后台进度')
  expect(wrapper.text()).not.toContain('阿罗玛')
  expect(wrapper.text()).not.toContain('还在计算')
  expect(wrapper.text()).not.toContain('继续等待')
  wrapper.unmount()
})

it('reports no clear bottleneck for a normal observation and keeps absent evidence unknown', () => {
  const wrapper = mount(CalculationBottleneckSummaryView, { props: { summary: { ...summary,
    latest: { activity: { ...activity, status: 'running', operators: [], task: undefined, recentEvents: [] }, receivedSeconds: 8 },
    silence: { seconds: 15, lastProgressSeconds: 9 },
  } } })
  expect(wrapper.text()).toContain('未记录到明确卡点')
  expect(wrapper.text()).toContain('未观测到关联干员')
  expect(wrapper.text()).toContain('未观测到任务')
  expect(wrapper.text()).toContain('未观测到近期事件')
  expect(wrapper.text()).toContain('启动后 9.00 秒')
  wrapper.unmount()
})
