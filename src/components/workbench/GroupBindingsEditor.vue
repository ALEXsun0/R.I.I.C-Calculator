<template>
  <tr v-for="(binding, index) in slot.groupBindings ?? []" :key="index" class="binding-row" data-test="group-bindings-editor">
    <td class="select-label">组</td>
    <td class="group">
      <div class="binding-group">
        <n-input :value="binding.groupId ?? ''" placeholder="留空按自身心情换班" title="最多一列空绑组；其他组休息时优先使用该组替班，个人休息仍按宿舍优先级安排。" size="small" :aria-label="`关联组 ${index + 2}`" @update:value="update(index, { groupId: $event || null })" />
        <n-button size="small" :aria-label="`移除关联组 ${index + 2}`" title="移除绑组" @click="remove(index)">−</n-button>
      </div>
    </td>
    <td class="select-label">替换：</td>
    <td><n-select :value="binding.replacements" :options="options" filterable multiple size="small" placeholder="该组的替班干员" :aria-label="`关联组 ${index + 2} 替班`" @update:value="update(index, { replacements: $event })" /></td>
  </tr>
</template>

<script setup lang="ts">
import { computed, toRaw } from 'vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import { OPERATORS, OPERATOR_MAP } from '../../domain/operators'
import type { MowerSlot, MowerRoomId, MowerGroupBinding } from '../../domain/roster'
import { useRosterWorkbenchStore } from '../../workbench/store'
const props = defineProps<{ roomId: MowerRoomId; slotIndex: number; slot: MowerSlot }>()
const store = useRosterWorkbenchStore()
const canBind = computed(() => props.slot.occupant.kind === 'operator' && (OPERATOR_MAP.get(props.slot.occupant.operatorId)?.name ?? props.slot.occupant.operatorId) !== '菲亚梅塔')
const options = computed(() => [
  ...(props.roomId.startsWith('dormitory_') ? [{ label: 'Free（组休息时开放床位）', value: 'Free' }] : []),
  ...OPERATORS.map(op => ({ label: op.name, value: op.charId })),
])
function save(bindings: MowerGroupBinding[]) {
  store.updateSlot(props.roomId, props.slotIndex, { ...structuredClone(toRaw(props.slot)), groupBindings: bindings })
}
function add() { if (canBind.value) save([...structuredClone(toRaw(props.slot.groupBindings ?? [])), { groupId: null, replacements: [] }]) }
function remove(index: number) { save(structuredClone(toRaw(props.slot.groupBindings ?? [])).filter((_, i) => i !== index)) }
function update(index: number, patch: Partial<MowerGroupBinding>) {
  const bindings = structuredClone(toRaw(props.slot.groupBindings ?? []))
  if (bindings[index]) { Object.assign(bindings[index], patch); save(bindings) }
}
defineExpose({ add })
</script>

<style scoped>
.binding-group {display:flex;align-items:center;gap:4px;}
.binding-group .n-input {min-width:90px;}
.binding-group .n-button {flex-shrink:0;padding:0 9px;}
</style>
