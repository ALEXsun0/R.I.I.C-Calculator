<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MOWER_INVENTORY_ITEMS, normalizeSimulationInventory, type SimulationInventory, type SimulationInventoryResource } from '../../domain/simulationInventory'

const props = defineProps<{ modelValue?: SimulationInventory; required?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: SimulationInventory | undefined]; 'validity-change': [valid: boolean] }>()
const draft = ref<SimulationInventory>({})
const enabled = computed(() => props.required || props.modelValue !== undefined)
watch(() => props.modelValue, value => { if (value !== undefined) draft.value = value }, { immediate: true })
const error = computed(() => {
  if (!enabled.value) return ''
  try { normalizeSimulationInventory(props.modelValue === undefined ? {} : props.modelValue); return '' }
  catch (error) { return error instanceof Error ? error.message : String(error) }
})
watch(error, value => emit('validity-change', !value), { immediate: true })
function toggle(event: Event): void {
  emit('update:modelValue', props.required || (event.target as HTMLInputElement).checked ? draft.value : undefined)
}
function update(resource: SimulationInventoryResource, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', { ...(props.modelValue ?? draft.value), [resource]: value.trim() === '' ? NaN : Number(value) })
}
</script>

<template>
  <section class="simulation-inventory" data-test="simulation-inventory-editor" aria-label="初始物品库存">
    <label class="inventory-toggle">
      <input type="checkbox" data-test="simulation-inventory-enabled" :checked="enabled" :disabled="required" @change="toggle" />
      <span>使用有限物品库存</span>
    </label>
    <p v-if="required" data-test="simulation-inventory-required">副表含库存条件，本次计算必须使用有限库存。</p>
    <p v-else-if="!enabled">关闭时沿用潜力产出模式，不受材料库存限制。</p>
    <template v-if="enabled">
      <p>以下数量从预热开始使用，进入采样时不重置。仅计入本次基建的产出和消耗，无外源收入；缺料时停止相应生产或交付。各项初始数量默认为 0。</p>
      <div class="inventory-grid">
        <label v-for="item in MOWER_INVENTORY_ITEMS" :key="item.resource">
          <span>{{ item.label }}（{{ item.unit }}）</span>
          <input type="number" min="0" step="1" :max="Number.MAX_SAFE_INTEGER" :value="modelValue?.[item.resource] ?? 0"
            :data-test="`initial-inventory-${item.resource}`" :aria-invalid="!!error" @input="update(item.resource, $event)" />
        </label>
      </div>
      <p>经验填写总经验值，不是作战记录张数。</p>
      <button type="button" data-test="reset-initial-inventory" @click="emit('update:modelValue', {})">全部归零</button>
      <p v-if="error" class="inventory-error" role="alert" data-test="simulation-inventory-error">{{ error }}</p>
    </template>
  </section>
</template>

<style scoped>
.simulation-inventory { display: flex; flex-direction: column; gap: 10px; }
.inventory-toggle { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.simulation-inventory p { margin: 0; color: #a9b5c8; line-height: 1.6; font-size: 12px; }
.inventory-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.inventory-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.inventory-grid input { width: 100%; box-sizing: border-box; padding: 8px; background: #18212f; color: #e2e8f0; border: 1px solid #455367; border-radius: 6px; }
.inventory-grid input:focus-visible { outline: 2px solid #42d6c7; }
.inventory-grid input[aria-invalid="true"] { border-color: #e29b80; }
.simulation-inventory .inventory-error { color: #e29b80; }
@media (max-width: 420px) { .inventory-grid { grid-template-columns: 1fr; } }
</style>
