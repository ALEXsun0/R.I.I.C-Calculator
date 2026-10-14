// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CalculationConfigModal from './CalculationConfigModal.vue'
import { createDefaultWorkspace } from '../../workbench/defaults'
import { normalizeSimulationInventory } from '../../domain/simulationInventory'

afterEach(() => { document.body.innerHTML = '' })
it('requires finite inventory for an inventory-dependent backup and defaults every item to zero', async () => {
  const workspace = createDefaultWorkspace()
  workspace.compatibility.backupPlans = [{ name: '库存', trigger: "op_data.inventory_count('赤金') < 10" }]
  const wrapper = mount(CalculationConfigModal, { props: { open: true, workspace, initial: { droneTarget: 'none', droneTradingRoomId: '' } }, global: { stubs: { teleport: true } } })
  try {
    const toggle = wrapper.get<HTMLInputElement>('[data-test="simulation-inventory-enabled"]')
    expect(toggle.element.checked).toBe(true)
    expect(toggle.element.disabled).toBe(true)
    expect(wrapper.text()).toContain('进入采样时不重置')
    expect(wrapper.text()).toContain('无外源收入')
    expect(wrapper.text()).toContain('经验填写总经验值')
    await wrapper.get('[data-test="confirm-calculation"]').trigger('click')
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toMatchObject({ initialInventory: normalizeSimulationInventory({}) })
  } finally { wrapper.unmount() }
})

it('can disable optional inventory, retain its draft and restore saved amounts', async () => {
  const wrapper = mount(CalculationConfigModal, { props: { open: true, workspace: createDefaultWorkspace(), initial: { droneTarget: 'none', droneTradingRoomId: '', initialInventory: { gold: 12, exp: 5000 } } }, global: { stubs: { teleport: true } } })
  try {
    expect(wrapper.get<HTMLInputElement>('[data-test="initial-inventory-exp"]').element.value).toBe('5000')
    await wrapper.get('[data-test="initial-inventory-gold"]').setValue('25')
    await wrapper.get('[data-test="simulation-inventory-enabled"]').setValue(false)
    await wrapper.get('[data-test="confirm-calculation"]').trigger('click')
    expect((wrapper.emitted('confirm')?.[0]?.[0] as { initialInventory?: unknown }).initialInventory).toBeUndefined()
    await wrapper.get('[data-test="simulation-inventory-enabled"]').setValue(true)
    expect(wrapper.get<HTMLInputElement>('[data-test="initial-inventory-gold"]').element.value).toBe('25')
    await wrapper.get('[data-test="confirm-calculation"]').trigger('click')
    expect(wrapper.emitted('confirm')?.[1]?.[0]).toMatchObject({ initialInventory: normalizeSimulationInventory({ gold: 25, exp: 5000 }) })
  } finally { wrapper.unmount() }
})

it.each(['', '-1', '1.5', '9007199254740992'])('blocks invalid inventory input %s until corrected', async value => {
  const wrapper = mount(CalculationConfigModal, { props: { open: true, workspace: createDefaultWorkspace(), initial: { droneTarget: 'none', droneTradingRoomId: '', initialInventory: {} } }, global: { stubs: { teleport: true } } })
  try {
    await wrapper.get('[data-test="initial-inventory-gold"]').setValue(value)
    expect(wrapper.get('[data-test="confirm-calculation"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-test="simulation-inventory-error"]').text()).toContain('安全整数')
    await wrapper.get('[data-test="confirm-calculation"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    await wrapper.get('[data-test="initial-inventory-gold"]').setValue('0')
    expect(wrapper.get('[data-test="confirm-calculation"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-test="confirm-calculation"]').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  } finally { wrapper.unmount() }
})

it('keeps corrupt saved quantities blocked until the user explicitly resets them', async () => {
  const wrapper = mount(CalculationConfigModal, { props: { open: true, workspace: createDefaultWorkspace(), initial: { droneTarget: 'none', droneTradingRoomId: '', initialInventory: { exp: -10 } } }, global: { stubs: { teleport: true } } })
  try {
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-test="confirm-calculation"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-test="reset-initial-inventory"]').trigger('click')
    expect(wrapper.get('[data-test="confirm-calculation"]').attributes('disabled')).toBeUndefined()
  } finally { wrapper.unmount() }
})

it('edits and confirms the shared weights including zero', async () => {
  const wrapper = mount(CalculationConfigModal, {
    props: { open: true, workspace: createDefaultWorkspace(), initial: { droneTarget: 'none', droneTradingRoomId: '', productionWeights: { exp: 2, gold: .5, orders: .3, fragments: 4, orundum: 5 } } },
    global: { stubs: { teleport: true } },
  })
  try {
    expect(wrapper.get<HTMLInputElement>('[data-test="weight-exp"]').element.value).toBe('2')
    await wrapper.get('[data-test="weight-exp"]').setValue('0')
    await wrapper.get('[data-test="confirm-calculation"]').trigger('click')
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toMatchObject({ productionWeights: { exp: 0, gold: .5, orders: .3, fragments: 4, orundum: 5 } })
  } finally { wrapper.unmount() }
})
it('restores the saved target and drops a stale trading room when switching targets', async () => {
  const wrapper = mount(CalculationConfigModal, {
    props: { open: true, workspace: createDefaultWorkspace(), initial: { droneTarget: 'trading', droneTradingRoomId: 'room_3_2' } },
    global: { stubs: { teleport: true } },
  })
  try {
    expect(wrapper.get<HTMLSelectElement>('[data-test="calculation-drone-target"]').element.value).toBe('room_3_2')
    expect(wrapper.text()).toContain('B101')
    expect(wrapper.text()).toContain('B302')
    await wrapper.get('[data-test="calculation-drone-target"]').setValue('none')
    await wrapper.get('[data-test="confirm-calculation"]').trigger('click')
    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ droneTarget: 'none', droneTradingRoomId: '', droneRoomId: '', useOperatorInventory: true, jayeElite0: false, productionWeights: { exp: 1, gold: .8, orders: .2, fragments: 0, orundum: 0 } }])
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true, initial: { droneTarget: 'trading', droneTradingRoomId: 'room_1_3' } })
    expect(wrapper.get<HTMLSelectElement>('[data-test="calculation-drone-target"]').element.value).toBe('none')
  } finally { wrapper.unmount() }
})

it('selects a concrete manufacturing facility and can opt out of inventory', async () => {
 const wrapper=mount(CalculationConfigModal,{props:{open:true,workspace:createDefaultWorkspace(),initial:{droneTarget:'gold',droneTradingRoomId:''}},global:{stubs:{teleport:true}}})
 try {
  await wrapper.get('[data-test="calculation-drone-target"]').setValue('room_1_2')
  await wrapper.get('[data-test="calculation-use-inventory"]').setValue(false)
  await wrapper.get('[data-test="confirm-calculation"]').trigger('click')
  expect(wrapper.emitted('confirm')?.[0]).toEqual([{droneTarget:'gold',droneRoomId:'room_1_2',droneTradingRoomId:'',useOperatorInventory:false,jayeElite0:false,productionWeights:{exp:1,gold:.8,orders:.2,fragments:0,orundum:0}}])
 } finally { wrapper.unmount() }
})

it('can toggle jayeElite0 option in calculation config', async () => {
 const wrapper = mount(CalculationConfigModal, {
  props: { open: true, workspace: createDefaultWorkspace(), initial: { droneTarget: 'none', droneTradingRoomId: '', jayeElite0: true } },
  global: { stubs: { teleport: true } },
 })
 try {
  const checkbox = wrapper.get<HTMLInputElement>('[data-test="calculation-jaye-elite0"]')
  expect(checkbox.element.checked).toBe(true)
  await checkbox.setValue(false)
  await wrapper.get('[data-test="confirm-calculation"]').trigger('click')
  expect(wrapper.emitted('confirm')?.[0]).toEqual([{ droneTarget: 'none', droneRoomId: '', droneTradingRoomId: '', useOperatorInventory: true, jayeElite0: false, productionWeights: { exp: 1, gold: .8, orders: .2, fragments: 0, orundum: 0 } }])
 } finally { wrapper.unmount() }
})

it('removes the training-plan option even when old settings enabled it', async () => {
  const initial = { droneTarget: 'none' as const, droneTradingRoomId: '', masteryPlanPresent: true }
  const wrapper = mount(CalculationConfigModal, {
    props: { open: true, workspace: createDefaultWorkspace(), initial },
    global: { stubs: { teleport: true } },
  })
  try {
    expect(wrapper.find('[data-test="calculation-mastery-plan"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('有未完成的训练计划')
    await wrapper.get('[data-test="confirm-calculation"]').trigger('click')
    expect(wrapper.emitted('confirm')?.[0]?.[0]).not.toHaveProperty('masteryPlanPresent')
    expect(initial.masteryPlanPresent).toBe(true)
  } finally { wrapper.unmount() }
})
