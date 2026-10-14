<script setup lang="ts">
import { computed } from 'vue'
import { isDroneCapacity, resolveDroneCapacity } from '../../domain/droneCapacity'
import { useRosterWorkbenchStore } from '../../workbench/store'

defineProps<{ disabled?: boolean }>()
const store = useRosterWorkbenchStore()
const capacity = computed(() => resolveDroneCapacity(store.workspace))

function onChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const value = input.value.trim() === '' ? NaN : Number(input.value)
  if (isDroneCapacity(value)) store.setDroneCapacity(value)
  else input.value = String(capacity.value)
}
</script>

<template>
  <label class="drone-capacity-setting">
    <span>无人机上限</span>
    <input
      type="number"
      min="0"
      step="1"
      aria-label="无人机上限"
      data-test="drone-capacity-input"
      :value="capacity"
      :disabled="disabled"
      @change="onChange"
    />
  </label>
</template>

<style scoped>
.drone-capacity-setting { display: inline-flex; align-items: center; gap: 8px; color: #d8e2ed; font-size: 13px; }
input { width: 88px; height: 32px; box-sizing: border-box; padding: 4px 8px; border: 1px solid rgba(255,255,255,.2); border-radius: 4px; color: inherit; background: rgba(255,255,255,.08); font: inherit; }
input:focus { outline: 2px solid #4ca7e5; outline-offset: 2px; }
input:disabled { opacity: .5; }
</style>
