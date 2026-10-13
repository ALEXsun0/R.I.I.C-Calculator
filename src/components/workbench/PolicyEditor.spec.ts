/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  class Observer { observe(){} unobserve(){} disconnect(){} }
  globalThis.ResizeObserver = Observer
  window.ResizeObserver = Observer
})
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { NSelect, NRadioGroup, NModal } from 'naive-ui'
import PolicyEditor from './PolicyEditor.vue'
import MoodLimitsEditor from './MoodLimitsEditor.vue'
import { POLICY_LIST_FIELDS } from './policyFields'
import { useRosterWorkbenchStore } from '../../workbench/store'
import { exportMowerJson } from '../../workbench/compat/mowerJson'
beforeEach(()=>setActivePinia(createPinia()))
const activeWrappers: {unmount:()=>void}[] = []
afterEach(()=>{activeWrappers.splice(0).forEach(wrapper=>wrapper.unmount());document.body.innerHTML=''})
const mountPolicy=()=>{const wrapper=mount(PolicyEditor,{global:{stubs:{NModal:{template:'<section><slot /></section>'}}}});activeWrappers.push(wrapper);return wrapper}
const listSelect=(wrapper:ReturnType<typeof mountPolicy>,key:string)=>wrapper.findAllComponents(NSelect).find(s=>s.attributes('data-test')===`add-select-${key}`)!
describe('Mower policy editor',()=>{
 it('uses upstream list order, dorm priority and separate settings dialogs',()=>{
  const wrapper=mountPolicy()
  expect(POLICY_LIST_FIELDS.map(f=>f.key)).toEqual(['rest_in_full','exhaust_require','ope_resting_priority','resting_priority','resting_priority_replacement','resting_standby','workaholic','free_blacklist','free_room_exclusions','refresh_trading','refresh_drained'])
  expect(wrapper.find('[data-field="dorm_order"]').exists()).toBe(true)
  expect(wrapper.text()).toContain('高级设置')
  expect(wrapper.text()).toContain('设置心情上下限')
  for(const f of POLICY_LIST_FIELDS)expect(listSelect(wrapper,f.key).props('multiple')).toBe(true)
 })
 it('edits multi-select lists without duplicates',async()=>{
  const store=useRosterWorkbenchStore(),wrapper=mountPolicy()
  listSelect(wrapper,'exhaust_require').vm.$emit('update:value',['char_002_amiya','char_102_texas','char_002_amiya'])
  await wrapper.vm.$nextTick()
  expect(store.workspace.mainPlan.conf.exhaust_require).toEqual(['char_002_amiya','char_102_texas'])
  listSelect(wrapper,'exhaust_require').vm.$emit('update:value',['char_102_texas'])
  expect(store.workspace.mainPlan.conf.exhaust_require).toEqual(['char_102_texas'])
 })
 it('reorders selected tags and removes only the chosen entry',()=>{
  const store=useRosterWorkbenchStore(),wrapper=mountPolicy()
  store.updateConf({workaholic:['char_002_amiya','char_102_texas','char_103_angel']})
  wrapper.vm.moveOperator('workaholic',2,0)
  expect(store.workspace.mainPlan.conf.workaholic).toEqual(['char_103_angel','char_002_amiya','char_102_texas'])
  wrapper.vm.removeOperator('workaholic',1)
  expect(store.workspace.mainPlan.conf.workaholic).toEqual(['char_103_angel','char_102_texas'])
 })
 it('shows native balanced mode without rewriting it, and edits the radio setting',async()=>{
  const store=useRosterWorkbenchStore();store.updateConf({ling_xi:0})
  const wrapper=mountPolicy();wrapper.vm.showMood=true;await wrapper.vm.$nextTick();const radio=wrapper.findComponent(NRadioGroup)
  expect(radio.props('value')).toBe(3);expect(store.workspace.mainPlan.conf.ling_xi).toBe(0)
  radio.vm.$emit('update:value',2);await wrapper.vm.$nextTick()
  expect(store.workspace.mainPlan.conf.ling_xi).toBe(2)
 })
 it('preserves unknown configuration and other policies across changes',()=>{
  const store=useRosterWorkbenchStore();store.updateConf({customMetadata:{keep:true},free_blacklist:['unknown'],refresh_trading:['望(room_1_1)']})
  store.workspace.compatibility.backupPlans=[{name:'other',conf:{}}]
  const wrapper=mountPolicy();wrapper.vm.addOperator('rest_in_full','char_002_amiya')
  expect(store.workspace.mainPlan.conf.customMetadata).toEqual({keep:true})
  expect(store.workspace.mainPlan.conf.free_blacklist).toEqual(['unknown'])
  expect(store.workspace.mainPlan.conf.refresh_trading).toEqual(['望(room_1_1)'])
  expect(store.workspace.compatibility.backupPlans).toEqual([{name:'other',conf:{}}])
 })
 it('opens the requested modal from each action',async()=>{
  const wrapper=mount(PolicyEditor)
  await wrapper.findAll('button').find(button=>button.text()==='高级设置')!.trigger('click')
  expect(wrapper.findAllComponents(NModal)[0]!.props('show')).toBe(true)
  wrapper.vm.showAdvanced=false
  await wrapper.findAll('button').find(button=>button.text()==='设置心情上下限')!.trigger('click')
  expect(wrapper.findAllComponents(NModal)[1]!.props('show')).toBe(true)
  wrapper.unmount()
 })
 it('exports mood ranges and rejects inverted values without discarding existing entries',async()=>{
  const store=useRosterWorkbenchStore();store.updateConf({operator_mood_limits:{阿米娅:{lower:2,upper:20}}})
  const wrapper=mount(MoodLimitsEditor);activeWrappers.push(wrapper)
  wrapper.vm.enableDefaults(true);wrapper.vm.updateRange(null,'upper',22)
  wrapper.vm.updateRange('阿米娅','lower',21)
  expect(store.workspace.mainPlan.conf.operator_mood_limits).toEqual({阿米娅:{lower:2,upper:20}})
  wrapper.vm.selected='芬';wrapper.vm.addOperator()
  const exported=JSON.parse(exportMowerJson(store.workspace))
  expect(exported.conf.mood_limits).toEqual({lower:0,upper:22})
  expect(exported.conf.operator_mood_limits).toEqual({阿米娅:{lower:2,upper:20},芬:{lower:0,upper:22}})
  wrapper.vm.removeOperator('芬')
  expect(store.workspace.mainPlan.conf.operator_mood_limits).toEqual({阿米娅:{lower:2,upper:20}})
 })
})
