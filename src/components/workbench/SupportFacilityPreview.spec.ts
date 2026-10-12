/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { NCheckbox, NSelect } from 'naive-ui'
import SupportFacilityPreview from './SupportFacilityPreview.vue'
import { createDefaultConfig } from '../../domain/defaults'
import { OPERATOR_MAP } from '../../domain/operators'
import { selectUnlockedSkills } from '../../domain/operatorInventory'
import type { AppConfig } from '../../domain/types'

const HOMEBOUND = 'char_4232_hbound'
const TOLEDO = 'char_393_toledo'
const CLEMENSHA = 'char_4231_clemnt'
const mounted: VueWrapper[] = []

function stageConfig(id: string, phase: number): AppConfig {
  const config = createDefaultConfig()
  const operator = OPERATOR_MAP.get(id)!
  config.operatorRecords = { [id]: { ...operator, skills: selectUnlockedSkills(operator, phase, 1) } }
  return config
}

function preview(config: AppConfig, roomId: string): VueWrapper {
  const wrapper = mount(SupportFacilityPreview, { props: { config, roomId } })
  mounted.push(wrapper)
  return wrapper
}

afterEach(() => mounted.splice(0).forEach(wrapper => wrapper.unmount()))

describe('support facility previews', () => {
  it('shows no preview for an unbuilt or unrelated facility', () => {
    const config = createDefaultConfig()
    expect(preview(config, 'recycle').find('.support-preview').exists()).toBe(false)
    expect(preview(config, 'unknown-room').find('.support-preview').exists()).toBe(false)
    expect(preview(config, 'room_1_1').find('.support-preview').exists()).toBe(false)
  })

  it('reports unmanned level-one conversion without assigning staff or material value', () => {
    const config = createDefaultConfig()
    config.facilities.recycle = 1
    const wrapper = preview(config, 'recycle')
    expect(wrapper.text()).toContain('100%')
    expect(wrapper.text()).toContain('48.00')
    expect(wrapper.text()).toContain('储藏容量 5')
    expect(wrapper.text()).toContain('在岗 0 人')
    expect(wrapper.findComponent(NCheckbox).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('龙门币')
    expect(wrapper.text()).not.toContain('82 分')
  })

  it('uses inventory stages and stops Homebound speed bonuses when morale reaches zero', async () => {
    const config = stageConfig(HOMEBOUND, 0)
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = [HOMEBOUND]
    const wrapper = preview(config, 'recycle')
    expect(wrapper.text()).toContain('141%')
    expect(wrapper.text()).toContain('拾荒者')

    const elite = stageConfig(HOMEBOUND, 2)
    elite.facilities.recycle = 3
    elite.facilityOperatorIds.recycle = [HOMEBOUND]
    await wrapper.setProps({ config: elite })
    expect(wrapper.text()).toContain('151%')
    expect(wrapper.text()).toContain('捡海人')
    expect(wrapper.text()).not.toContain('拾荒者')
    elite.operatorMorale[HOMEBOUND] = 0
    await wrapper.setProps({ config: { ...elite } })
    expect(wrapper.text()).toContain('120%')
    expect(wrapper.text()).toContain('在岗 0 人')
  })

  it('keeps the boost as a local preview and resets it when level three is removed', async () => {
    const config = stageConfig(HOMEBOUND, 2)
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = [HOMEBOUND]
    const originalConfig = structuredClone(config)
    const wrapper = preview(config, 'recycle')
    wrapper.getComponent(NCheckbox).vm.$emit('update:checked', true)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('201%')
    expect(wrapper.text()).toContain('仅预览')
    expect(config).toEqual(originalConfig)

    await wrapper.setProps({ config: { ...config, facilities: { ...config.facilities, recycle: 2 } } })
    expect(wrapper.text()).toContain('131%')
    expect(wrapper.findComponent(NCheckbox).exists()).toBe(false)
    await wrapper.setProps({ config })
    expect(wrapper.text()).toContain('151%')
    expect(wrapper.getComponent(NCheckbox).props('checked')).toBe(false)
  })

  it('keeps an overcapacity imported roster editable and clears the error after correction', async () => {
    const config = createDefaultConfig()
    config.facilities.recycle = 1
    config.facilityOperatorIds.recycle = [HOMEBOUND, 'char_123_fang']
    const wrapper = preview(config, 'recycle')
    expect(wrapper.get('[data-test="support-preview-error"]').text()).toContain('工位上限')
    expect(wrapper.find('[data-test="recycle-preview"]').exists()).toBe(false)
    await wrapper.setProps({ config: { ...config, facilityOperatorIds: { ...config.facilityOperatorIds, recycle: [HOMEBOUND] } } })
    expect(wrapper.find('[data-test="support-preview-error"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="recycle-preview"]').text()).toContain('131%')
  })

  it('renders a preserved unknown operator without inventing a recycling skill', () => {
    const config = createDefaultConfig()
    config.facilities.recycle = 3
    config.facilityOperatorIds.recycle = ['legacy_unknown_operator']
    const wrapper = preview(config, 'recycle')
    expect(wrapper.get('[data-test="support-preview-error"]').text()).toContain('未识别干员')
    expect(wrapper.text()).toContain('legacy_unknown_operator')
    expect(wrapper.text()).not.toContain('拾荒者')
    expect(wrapper.text()).not.toContain('捡海人')
    expect(wrapper.find('[data-test="recycle-preview"]').exists()).toBe(false)
  })

  it('shows Toledo stage-specific speed and personal morale cost only in a built office', async () => {
    const config = stageConfig(TOLEDO, 0)
    config.facilityOperatorIds.office = [TOLEDO]
    const wrapper = preview(config, 'contact')
    expect(wrapper.text()).toContain('联络速度 +20%')
    expect(wrapper.text()).toContain('0.75/h')

    const elite = stageConfig(TOLEDO, 2)
    elite.facilityOperatorIds.office = [TOLEDO]
    await wrapper.setProps({ config: elite })
    expect(wrapper.text()).toContain('联络速度 +30%')
    await wrapper.setProps({ config: { ...elite, facilities: { ...elite.facilities, office: 0 } } })
    expect(wrapper.find('.support-preview').exists()).toBe(false)
  })

  it('switches both Clemensha speed and morale when an active meeting coworker joins or exhausts', async () => {
    const config = stageConfig(CLEMENSHA, 2)
    config.facilityOperatorIds.reception = [CLEMENSHA]
    const wrapper = preview(config, 'meeting')
    expect(wrapper.text()).toContain('线索搜集速度 +20%')
    expect(wrapper.text()).toContain('2.00/h')

    const withPeer = { ...config, facilityOperatorIds: { ...config.facilityOperatorIds, reception: [CLEMENSHA, 'char_123_fang'] } }
    await wrapper.setProps({ config: withPeer })
    expect(wrapper.text()).toContain('线索搜集速度 +35%')
    expect(wrapper.text()).toContain('3.00/h')
    await wrapper.setProps({ config: { ...withPeer, operatorMorale: { char_123_fang: 0 } } })
    expect(wrapper.text()).toContain('线索搜集速度 +20%')
    expect(wrapper.text()).toContain('2.00/h')
  })

  it('previews Homebound relative crafting probability for the selected unlocked formula', async () => {
    const config = stageConfig(HOMEBOUND, 0)
    config.facilityOperatorIds.workshop = [HOMEBOUND]
    const wrapper = preview(config, 'factory')
    expect(wrapper.text()).toContain('副产物概率 10% → 10%')
    const elite = stageConfig(HOMEBOUND, 2)
    elite.facilityOperatorIds.workshop = [HOMEBOUND]
    await wrapper.setProps({ config: elite })
    expect(wrapper.text()).toContain('副产物概率 10% → 19%')
    expect(wrapper.text()).toContain('相对提升 90%')
    wrapper.getComponent(NSelect).vm.$emit('update:value', '30165')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('副产物概率 10% → 19%')
    wrapper.getComponent(NSelect).vm.$emit('update:value', '30034')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('副产物概率 10% → 10%')
    expect(wrapper.text()).toContain('相对提升 0%')
  })
})
