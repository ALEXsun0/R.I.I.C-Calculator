// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import CalculationActivityNotice from './CalculationActivityNotice.vue'
import type { SimulationActivity } from '../../simulator/simulationActivity'

const activity: SimulationActivity = {
  status: 'slow', message: '演算推进较慢', capturedHours: 48, windowSeconds: 15, advancedHours: .03, iterations: 80,
  operators: [{ id: 'aroma', name: '阿罗玛', morale: 2, upperLimit: 20, groups: ['贸易组'], room: 'room_1_1', eventCount: 4 }],
  recentEvents: [{ label: '下班', count: 4 }],
  task: { label: '下班', metadata: '阿罗玛', rooms: ['room_1_1'], dueHours: 48, source: 'active' },
}

it('shows bounded observations and operator details without attributing the slowdown', async () => {
  const wrapper = mount(CalculationActivityNotice, { props: { activity } })
  expect(wrapper.text()).toContain('15.00 秒推进 0.03 小时')
  expect(wrapper.text()).toContain('观察时刻 48.00 小时')
  expect(wrapper.text()).toContain('阿罗玛 · 心情 2.00 / 20.00')
  expect(wrapper.text()).toContain('贸易组')
  expect(wrapper.text()).toContain('近期记录事件 4 次')
  expect(wrapper.text()).toContain('最多 256 条')
  expect(wrapper.text()).toContain('不代表导致变慢的原因')
  expect(wrapper.get('[data-test="activity-task"]').text()).toContain('执行中任务')
  await wrapper.setProps({ activity: { ...activity, task: { ...activity.task!, source: 'queued' } } })
  expect(wrapper.get('[data-test="activity-task"]').text()).toContain('队列待执行任务（不代表正在执行）')
  wrapper.unmount()
})

it('keeps missing operator and task evidence unknown and hides recovered observations', async () => {
  const wrapper = mount(CalculationActivityNotice, { props: { activity: { ...activity, operators: [], recentEvents: [], task: undefined } } })
  expect(wrapper.text()).toContain('暂无法定位相关干员')
  expect(wrapper.text()).toContain('尚无可观察的任务')
  expect(wrapper.text()).not.toContain('阿罗玛')
  await wrapper.setProps({ activity: { ...activity, status: 'running' } })
  expect(wrapper.find('[data-test="calculation-activity"]').exists()).toBe(false)
  wrapper.unmount()
})

it('labels retained observations as stale during silence and does not invent pre-start evidence', async () => {
  const wrapper = mount(CalculationActivityNotice, { props: { activity, silence: { seconds: 15, lastProgressSeconds: 8 }, progressLabel: '正在采样 1 / 24 小时' } })
  expect(wrapper.text()).toContain('后台计算暂未响应')
  expect(wrapper.text()).toContain('启动后 8 秒')
  expect(wrapper.text()).toContain('正在采样 1 / 24 小时')
  expect(wrapper.text()).toContain('可能已不是当前状态')
  await wrapper.setProps({ activity: undefined, silence: { seconds: 15, lastProgressSeconds: null } })
  expect(wrapper.text()).toContain('尚未收到后台进度')
  expect(wrapper.text()).not.toContain('阿罗玛')
  wrapper.unmount()
})

it('shows the last observation when report summary messages omit activity', () => {
  const wrapper = mount(CalculationActivityNotice, { props: {
    silence: { seconds: 15, lastProgressSeconds: 9, observation: { activity, receivedSeconds: 8 } }, progressLabel: '正在汇总产出报告…',
  } })
  expect(wrapper.text()).toContain('阿罗玛')
  expect(wrapper.text()).toContain('演算观察收到于启动后 8 秒')
  expect(wrapper.text()).toContain('最后进度：启动后 9 秒')
  expect(wrapper.text()).toContain('正在汇总产出报告')
  expect(wrapper.text()).toContain('可能已不是当前状态')
  wrapper.unmount()
})
