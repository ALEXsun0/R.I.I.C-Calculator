/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import DroneCapacityInput from './DroneCapacityInput.vue'
import { useRosterWorkbenchStore } from '../../workbench/store'

describe('drone capacity on the roster page', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows 250 by default and applies edits to the current workspace', async () => {
    const wrapper = mount(DroneCapacityInput)
    const input = wrapper.get<HTMLInputElement>('[data-test="drone-capacity-input"]')
    expect(input.element.value).toBe('250')
    expect(input.attributes('aria-label')).toBe('无人机上限')
    await input.setValue('240')
    expect(useRosterWorkbenchStore().workspace.droneCapacity).toBe(240)
    wrapper.unmount()
  })

  it('restores the previous valid value for empty or fractional edits', async () => {
    const store = useRosterWorkbenchStore()
    store.setDroneCapacity(240)
    const wrapper = mount(DroneCapacityInput)
    const input = wrapper.get<HTMLInputElement>('[data-test="drone-capacity-input"]')
    for (const value of ['', '-1', '250.5']) {
      await input.setValue(value)
      expect(input.element.value).toBe('240')
      expect(store.workspace.droneCapacity).toBe(240)
    }
    wrapper.unmount()
  })

  it('disables edits while calculation or roster generation is running', () => {
    const wrapper = mount(DroneCapacityInput, { props: { disabled: true } })
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
