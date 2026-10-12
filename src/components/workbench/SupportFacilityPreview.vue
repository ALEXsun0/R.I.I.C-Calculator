<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NCheckbox, NSelect } from 'naive-ui'
import type { AppConfig } from '../../domain/types'
import { evaluateHomeboundByproduct, evaluateNewContactAndClueSkills, evaluateRecycleEfficiency, WORKSHOP_FORMULAS } from '../../engine/supportFacilitySkills'
import { currentMoraleRates } from '../../engine/morale'

const props = defineProps<{ config: AppConfig; roomId: string }>()
const boosted = ref(false)
const product = ref('31094')
watch(() => props.config.facilities.recycle, level => { if (level !== 3) boosted.value = false })
const recyclePreview = computed(() => {
  if (props.roomId !== 'recycle' || !props.config.facilities.recycle) return { value: null, error: null }
  try {
    return { value: evaluateRecycleEfficiency(props.config, { boosted: boosted.value }), error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      value: null,
      error: message === 'Recycle staffing exceeds facility level capacity'
        ? '驻员数量超过当前等级的工位上限，请调整干员或设施等级。'
        : message.startsWith('Unknown recycle operator: ')
          ? `回收站中存在未识别干员：${message.slice('Unknown recycle operator: '.length)}。请核对导入数据。`
          : `回收站配置暂无法预览：${message}`,
    }
  }
})
const recycle = computed(() => recyclePreview.value.value)
const bonuses = computed(() => evaluateNewContactAndClueSkills(props.config))
const workshop = computed(() => evaluateHomeboundByproduct(props.config, product.value))
const rates = computed(() => currentMoraleRates(props.config).rates)
const hasToledo = computed(() => props.config.facilityOperatorIds.office.includes('char_393_toledo'))
const hasClemensha = computed(() => props.config.facilityOperatorIds.reception.includes('char_4231_clemnt'))
const hasHomebound = computed(() => props.config.facilityOperatorIds.workshop.includes('char_4232_hbound'))
const productOptions = [...new Map(WORKSHOP_FORMULAS.map(formula => [formula.itemId, { label: formula.name, value: formula.itemId }])).values()]
const percent = (value: number) => Number((value * 100).toFixed(2))
</script>

<template>
  <div v-if="recycle && config.facilities.recycle" class="support-preview" data-test="recycle-preview">
    <div>转化效率 <strong>{{ Number(recycle.efficiencyPercent.toFixed(2)) }}%</strong> · 每 {{ recycle.hoursPerMaterial?.toFixed(2) }} 小时产出 1 次 · 储藏容量 {{ recycle.capacity }}</div>
    <div class="preview-detail">{{ recycle.details.join('；') }}</div>
    <n-checkbox v-if="config.facilities.recycle === 3" v-model:checked="boosted">预览转化提效（+50%）</n-checkbox>
    <div class="preview-detail">理论间隔按当前驻员的已解锁技能计算；仓库满后暂停转化。</div>
    <div v-if="config.facilities.recycle === 3" class="preview-detail">提效仅预览持续激活时的速度；排班模拟不自动投料。</div>
  </div>
  <div v-else-if="recyclePreview.error" class="support-preview preview-error" role="status" data-test="support-preview-error">{{ recyclePreview.error }}</div>
  <div v-else-if="roomId === 'contact' && config.facilities.office > 0 && hasToledo" class="support-preview" data-test="toledo-preview">
    德·托莱多技能：联络速度 +{{ bonuses.contactBonus }}% · 当前心情消耗 {{ rates.char_393_toledo?.toFixed(2) ?? '0.00' }}/h
  </div>
  <div v-else-if="roomId === 'meeting' && config.facilities.reception > 0 && hasClemensha" class="support-preview" data-test="clemensha-preview">
    克莱门莎技能：线索搜集速度 +{{ bonuses.clueBonus }}% · 当前心情消耗 {{ rates.char_4231_clemnt?.toFixed(2) ?? '0.00' }}/h
  </div>
  <div v-else-if="roomId === 'factory' && config.facilities.workshop > 0 && hasHomebound" class="support-preview" data-test="homebound-preview">
    <n-select v-model:value="product" :options="productOptions" size="small" class="workshop-product" />
    <div>旅骨技能：副产物概率 {{ percent(workshop.baseProbability) }}% → <strong>{{ percent(workshop.probability) }}%</strong>（相对提升 {{ workshop.bonusPercent }}%）</div>
  </div>
</template>

<style scoped>
.support-preview { margin: 12px auto 0; max-width: 860px; padding: 10px 14px; border: 1px solid #6ccbcb55; border-radius: 6px; color: #e2e8f0; font-size: 13px; line-height: 1.8; background: #14252a; }
.preview-detail { color: #a8bec7; font-size: 12px; }
.preview-error { color: #f5bd7b; border-color: #f5bd7b55; }
.workshop-product { max-width: 260px; margin-bottom: 6px; }
</style>
