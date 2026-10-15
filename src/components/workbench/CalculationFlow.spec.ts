// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
vi.hoisted(() => {
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  if (typeof window !== 'undefined') window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
})
import WorkbenchShell from './WorkbenchShell.vue'
import PlanToolbar from './PlanToolbar.vue'
import { normalizeSimulationInventory } from '../../domain/simulationInventory'
import { EDITION } from '../../domain/edition'
import { createDefaultConfig } from '../../domain/defaults'
import { calculate } from '../../engine/calculate'

const workers: TestWorker[] = []
class TestWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { workers.push(this) }
}
let wrapper: VueWrapper<any>
beforeEach(() => {
  localStorage.clear()
  workers.length = 0
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('Worker', TestWorker)
  wrapper = mount(WorkbenchShell, { global: { plugins: [createPinia()] } })
})
afterEach(() => { wrapper.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

it('sends finite initial inventory to the worker, persists it and can return to potential output', async () => {
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '', initialInventory: { gold: 12, exp: 1500 } })
  await wrapper.vm.$nextTick()
  const production = workers[0]!.postMessage.mock.calls[0]![0].options.simulationOptions.production
  expect(production).toMatchObject({ outputMode: 'settled', inventoryMode: 'finite', initialResources: normalizeSimulationInventory({ gold: 12, exp: 1500 }) })
  const key = `arc-income-calculator-sim-settings-v1-${EDITION.storageNamespace}`
  expect(JSON.parse(localStorage.getItem(key)!).initialInventory).toEqual(production.initialResources)
  wrapper.unmount()
  wrapper = mount(WorkbenchShell, { global: { plugins: [createPinia()] } })
  expect(wrapper.vm.simSettings.initialInventory).toEqual(production.initialResources)
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '', initialInventory: undefined })
  await wrapper.vm.$nextTick()
  const disabled = workers[1]!.postMessage.mock.calls[0]![0].options.simulationOptions.production
  expect(disabled.outputMode).toBe('potential')
  expect(disabled.inventoryMode).toBeUndefined()
  expect(disabled.initialResources).toBeUndefined()
  expect(JSON.parse(localStorage.getItem(key)!).initialInventory).toBeUndefined()
})

it('forces zero finite stock for inventory conditions even when a caller omits the UI field', () => {
  wrapper.vm.store.workspace.compatibility.backupPlans = [{ name: '库存', trigger: "op_data.inventory_count('源石碎片') > 0" }]
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  expect(workers[0]!.postMessage.mock.calls[0]![0].options.simulationOptions.production).toMatchObject({ outputMode: 'settled', inventoryMode: 'finite', initialResources: normalizeSimulationInventory({}) })
})

it('does not launch or overwrite saved settings when initial inventory is invalid', () => {
  const previous = wrapper.vm.simSettings.initialInventory
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '', initialInventory: { gold: -.5 } })
  expect(workers).toHaveLength(0)
  expect(wrapper.vm.isCalculating).toBe(false)
  expect(wrapper.vm.calculationError).toContain('安全整数')
  expect(wrapper.vm.simSettings.initialInventory).toEqual(previous)
})

it.each([{ gold: -1 }, { exp: 1.5 }, { gold: '12' }, null, { drone: 1 }])('preserves invalid saved initial inventory and blocks calculation: %j', async initialInventory => {
  wrapper.unmount()
  const key = `arc-income-calculator-sim-settings-v1-${EDITION.storageNamespace}`
  localStorage.setItem(key, JSON.stringify({ sampleDays: 7, initialInventory }))
  wrapper = mount(WorkbenchShell, { global: { plugins: [createPinia()] } })
  await wrapper.vm.$nextTick()
  expect(wrapper.vm.simSettings.initialInventory).toEqual(initialInventory)
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '', initialInventory: wrapper.vm.simSettings.initialInventory })
  await wrapper.vm.$nextTick()
  expect(workers).toHaveLength(0)
  expect(wrapper.vm.isCalculating).toBe(false)
  expect(wrapper.vm.calculationError).toBeTruthy()
  expect(wrapper.vm.simSettings.initialInventory).toEqual(initialInventory)
  expect(JSON.parse(localStorage.getItem(key)!).initialInventory).toEqual(initialInventory)
})

it('asks for drone settings before launching a cancellable background calculation', async () => {
  await wrapper.get('[data-test="tab-settings"]').trigger('click')
  expect(wrapper.find('[data-test="jaye-elite0-select"]').exists()).toBe(false)
  await wrapper.get('[data-test="fiammetta-fool"]').setValue('false')
  await wrapper.get('[data-test="fiammetta-threshold"]').setValue('80')
  await wrapper.get('[data-test="resting-threshold"]').setValue('70')
  await wrapper.get('[data-test="rescue-threshold"]').setValue('90')
  await wrapper.get('[data-test="free-room"]').setValue('true')
  await wrapper.get('[data-test="tab-workbench"]').trigger('click')
  await wrapper.get('[data-test="calc-btn"]').trigger('click')
  expect(wrapper.vm.calculationConfigOpen).toBe(true)
  expect(workers).toHaveLength(0)
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'trading', droneTradingRoomId: 'room_3_1' })
  await wrapper.vm.$nextTick()
  expect(workers).toHaveLength(1)
  expect(workers[0]!.postMessage.mock.calls[0]![0].options.simulationAssumptions).toEqual({ fiammettaFool: false, fiammettaThreshold: .8, restingThreshold: .7, rescueThreshold: .9, freeRoom: true })
  expect(workers[0]!.postMessage.mock.calls[0]![0].options.simulationOptions.production).toMatchObject({
    droneTarget: 'trading', droneTradingRoomId: 'room_3_1',
  })
  workers[0]!.onmessage!({ data: { type: 'progress', progress: { label: '正在采样 12 / 24 小时', fraction: .5 } } } as MessageEvent)
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[data-test="calculation-progress-row"]').text()).toContain('正在采样')
  expect(wrapper.get('[data-test="calc-btn"]').attributes('disabled')).toBeDefined()
  const staleMessage = workers[0]!.onmessage!
  await wrapper.get('[data-test="abort-calculation-btn"]').trigger('click')
  expect(workers[0]!.terminate).toHaveBeenCalledOnce()
  expect(wrapper.vm.isCalculating).toBe(false)
  wrapper.vm.handleCalculate()
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  staleMessage({ data: { type: 'error', error: 'obsolete failure' } } as MessageEvent)
  expect(wrapper.vm.isCalculating).toBe(true)
  expect(wrapper.vm.calculationError).toBeNull()
  wrapper.unmount()
  expect(workers[1]!.terminate).toHaveBeenCalledOnce()
})

it('cancels an active snapshot when the roster changes and reports worker failures without blocking fallback', async () => {
  wrapper.vm.handleCalculate()
  expect(workers).toHaveLength(0)
  expect(wrapper.vm.calculationConfigOpen).toBe(true)
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  wrapper.vm.store.workspace.name = 'changed roster'
  await wrapper.vm.$nextTick()
  expect(workers[0]!.terminate).toHaveBeenCalledOnce()
  expect(wrapper.vm.isCalculating).toBe(false)
  wrapper.vm.handleCalculate()
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  workers[1]!.onerror!({ message: 'worker failed' } as ErrorEvent)
  await wrapper.vm.$nextTick()
  expect(wrapper.vm.isCalculating).toBe(false)
  expect(wrapper.vm.calculationError).toContain('worker failed')
  expect(wrapper.findComponent(PlanToolbar).props('isCalculating')).toBe(false)
})

it('estimates remaining time from real progress and resets timing on restart', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[data-test="calculation-progress-row"]').text()).toContain('估算中')
  workers[0]!.onmessage!({ data: { type: 'progress', progress: { label: '正在采样', fraction: .25 } } } as MessageEvent)
  vi.advanceTimersByTime(10000)
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[data-test="calculation-progress-row"]').text()).toContain('约剩余 30 秒')
  await wrapper.get('[data-test="abort-calculation-btn"]').trigger('click')
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[data-test="calculation-progress-row"]').text()).toContain('已用 0 秒')
  expect(wrapper.get('[data-test="calculation-progress-row"]').text()).toContain('估算中')
})

it('wires slow activity and unresponsive observations through the toolbar and clears them on recovery', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  const activity = { status: 'slow', message: 'slow', capturedHours: 80, windowSeconds: 15, advancedHours: .01, iterations: 10,
    operators: [{ id: 'aroma', name: '阿罗玛', morale: 3, upperLimit: 20, groups: ['贸易组'], room: 'room_1_1', eventCount: 2 }], recentEvents: [] }
  workers[0]!.onmessage!({ data: { type: 'progress', progress: { label: '正在采样 8 / 168 小时', fraction: .4, activity } } } as MessageEvent)
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[data-test="calculation-activity"]').text()).toContain('阿罗玛')
  expect(wrapper.get('[data-test="calculation-progress-row"]').text()).toContain('暂无法估算')
  vi.advanceTimersByTime(15000)
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[data-test="calculation-activity"]').text()).toContain('后台计算暂未响应')
  expect(wrapper.get('[data-test="calculation-activity"]').text()).toContain('最后进度：启动后 0 秒')
  expect(wrapper.find('[data-test="abort-calculation-btn"]').exists()).toBe(true)
  workers[0]!.onmessage!({ data: { type: 'progress', progress: { label: '正在采样 9 / 168 小时', fraction: .41, activity: { ...activity, status: 'running' } } } } as MessageEvent)
  await wrapper.vm.$nextTick()
  expect(wrapper.find('[data-test="calculation-activity"]').exists()).toBe(false)
  expect(wrapper.get('[data-test="calculation-progress-row"]').text()).toContain('约剩余')
})

it('keeps a stopped calculation summary above every page and clears it when a new calculation starts', async () => {
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  const activity = { status: 'slow', message: '演算正在推进', capturedHours: 48, windowSeconds: 15, advancedHours: .03, iterations: 80,
    operators: [{ id: 'aroma', name: '阿罗玛', morale: 2, upperLimit: 20, groups: ['贸易组'], room: 'room_1_1', eventCount: 4 }], recentEvents: [{ label: '下班', count: 4 }] }
  workers[0]!.onmessage!({ data: { type: 'progress', progress: { label: '正在采样', fraction: .25, activity } } } as MessageEvent)
  workers[0]!.onmessage!({ data: { type: 'progress', progress: { label: '正在汇总报告', fraction: .99 } } } as MessageEvent)
  const staleMessage = workers[0]!.onmessage!
  wrapper.vm.handleAbortCalculation()
  await wrapper.vm.$nextTick()
  const summary = wrapper.get('[data-test="calculation-bottleneck-summary"]')
  expect(summary.text()).toContain('演算已中止')
  expect(summary.text()).toContain('阿罗玛')
  expect(summary.text()).toContain('正在汇总报告')
  expect(summary.element.previousElementSibling?.tagName).toBe('HEADER')
  await wrapper.get('[data-test="tab-logs"]').trigger('click')
  expect(wrapper.get('[data-test="calculation-bottleneck-summary"]').isVisible()).toBe(true)
  await wrapper.get('[data-test="tab-settings"]').trigger('click')
  expect(wrapper.get('[data-test="calculation-bottleneck-summary"]').isVisible()).toBe(true)
  wrapper.vm.handleCalculate()
  await wrapper.vm.$nextTick()
  expect(wrapper.find('[data-test="calculation-bottleneck-summary"]').exists()).toBe(true)
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  staleMessage({ data: { type: 'error', error: 'stale failure' } } as MessageEvent)
  await wrapper.vm.$nextTick()
  expect(wrapper.find('[data-test="calculation-bottleneck-summary"]').exists()).toBe(false)
})

it('shows startup failures independently of missing bottleneck observations', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('worker unavailable') } })
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  await wrapper.vm.$nextTick()
  const summary = wrapper.get('[data-test="calculation-bottleneck-summary"]')
  expect(summary.text()).toContain('演算失败')
  expect(summary.text()).toContain('未收到演算观测')
  expect(summary.get('[data-test="bottleneck-error"]').text()).toContain('worker unavailable')
})

it('keeps an observed constraint in the completed summary after the worker returns its report', async () => {
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  workers[0]!.onmessage!({ data: { type: 'progress', progress: { label: '正在采样', fraction: .5, activity: {
    status: 'running', message: '演算正在推进', capturedHours: 120, windowSeconds: 15, advancedHours: 24, iterations: 80,
    operators: [], recentEvents: [], findings: [{ code: 'group-blocked', kind: 'constraint', message: '曾报告替补不足；不表示仍未解决。', operatorIds: [] }],
  } } } } as MessageEvent)
  workers[0]!.onmessage!({ data: { type: 'complete', result: {
    success: true, report: calculate(createDefaultConfig()),
  }, timelineData: null } } as MessageEvent)
  await wrapper.vm.$nextTick()
  const summary = wrapper.get('[data-test="calculation-bottleneck-summary"]')
  expect(summary.text()).toContain('演算已完成')
  expect(summary.get('[data-test="bottleneck-diagnostics"]').text()).toContain('曾报告替补不足')
  expect(wrapper.vm.isCalculating).toBe(false)
})

it('retains a distinct summary when a workspace change stops the active calculation', async () => {
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  wrapper.vm.store.workspace.name = 'changed during calculation'
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[data-test="calculation-bottleneck-summary"]').text()).toContain('排班已变更，演算已停止')
})

it('shows a recoverable error when workers are unavailable instead of running on the UI thread', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('worker unavailable') } })
  wrapper.vm.handleConfirmCalculation({ droneTarget: 'none', droneTradingRoomId: '' })
  await wrapper.vm.$nextTick()
  expect(wrapper.vm.isCalculating).toBe(false)
  expect(wrapper.vm.calculationReport).toBeNull()
  expect(wrapper.get('[data-test="calculation-error"]').text()).toContain('worker unavailable')
  expect(wrapper.get('[data-test="calc-btn"]').attributes('disabled')).toBeUndefined()
})

it('can ignore the current inventory and forwards the exact manufacturing room',()=>{
 wrapper.vm.handleInventoryChange({enabled:true,valid:true,entries:[{operatorId:'芬',elite:0,level:1}]})
 wrapper.vm.handleConfirmCalculation({droneTarget:'gold',droneTradingRoomId:'',droneRoomId:'room_1_2',useOperatorInventory:false})
 const options=workers[0]!.postMessage.mock.calls[0]![0].options.simulationOptions
 expect(options.operatorInventory).toBeUndefined()
 expect(options.production.droneRoomId).toBe('room_1_2')
 wrapper.vm.handleAbortCalculation()
 wrapper.vm.handleConfirmCalculation({droneTarget:'none',droneTradingRoomId:'',useOperatorInventory:true})
 expect(workers[1]!.postMessage.mock.calls[0]![0].options.simulationOptions.operatorInventory).toHaveLength(1)
})
