/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { NInput, NSelect } from 'naive-ui'
import GroupBindingsEditor from './GroupBindingsEditor.vue'
import { useRosterWorkbenchStore } from '../../workbench/store'
import { exportMowerJson, importMowerJson } from '../../workbench/compat/mowerJson'

beforeEach(() => setActivePinia(createPinia()))
describe('editable imported group bindings', () => {
  it('edits only the selected additional binding and exports native Free semantics', async () => {
    const store = useRosterWorkbenchStore()
    store.loadWorkspace(importMowerJson(JSON.stringify({ plan1: { dormitory_1: { plans: [{ agent: '流明', group: 'A', replacement: ['Free'], group_bindings: [{ group: 'B', replacement: ['杜林'] }] }] } } })))
    const slot = store.workspace.mainPlan.facilities.dormitory_1.slots[0]!
    const wrapper = mount(GroupBindingsEditor, { props: { roomId: 'dormitory_1', slotIndex: 0, slot } })
    wrapper.findComponent(NInput).vm.$emit('update:value', 'C')
    await wrapper.setProps({ slot: store.workspace.mainPlan.facilities.dormitory_1.slots[0]! })
    wrapper.findComponent(NSelect).vm.$emit('update:value', ['Free'])
    const result = JSON.parse(exportMowerJson(store.workspace))
    expect(result.plan1.dormitory_1.plans[0]).toMatchObject({ group: 'A', replacement: ['Free'], group_bindings: [{ group: 'C', replacement: ['Free'] }] })
  })
  it('offers Free only for dormitory bindings', () => {
    const store = useRosterWorkbenchStore()
    const slot = { occupant: { kind: 'operator' as const, operatorId: 'char_002_amiya' }, groupId: 'A', replacements: [], groupBindings: [{ groupId: 'B', replacements: [] }] }
    store.updateSlot('central', 0, slot)
    const wrapper = mount(GroupBindingsEditor, { props: { roomId: 'central', slotIndex: 0, slot } })
    expect(wrapper.findComponent(NSelect).props('options')?.some((option) => option.value === 'Free')).toBe(false)
  })
})
