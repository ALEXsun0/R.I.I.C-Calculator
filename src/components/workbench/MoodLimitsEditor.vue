<script setup lang="ts">
/** Mower alpha MoodLimitsEditor.vue, MIT, Copyright 2021 Nano. */
import { computed, ref } from 'vue'
import { NButton, NCheckbox, NInputNumber, NSelect } from 'naive-ui'
import { OPERATORS } from '../../domain/operators'
import { resolveOperatorCharId } from '../../domain/operatorIdentifiers'
import { useRosterWorkbenchStore } from '../../workbench/store'
type Range={lower:number;upper:number}
const store=useRosterWorkbenchStore()
const selected=ref<string|null>(null)
const defaults=computed(()=>store.workspace.mainPlan.conf.mood_limits as Range|null|undefined)
const overrides=computed(()=>JSON.parse(JSON.stringify(store.workspace.mainPlan.conf.operator_mood_limits??{})) as Record<string,Range>)
const choices=computed(()=>OPERATORS.filter(op=>!Object.keys(overrides.value).some(name=>resolveOperatorCharId(name)===op.charId)).map(op=>({value:op.name,label:op.name})))
function enableDefaults(enabled:boolean):void {store.updateConf({mood_limits:enabled?{lower:0,upper:24}:null})}
function updateRange(name:string|null,field:keyof Range,value:number|null):void {
 if(value===null||!Number.isFinite(value))return
 const current=name===null?defaults.value:overrides.value[name];if(!current)return
 const next={...current,[field]:value};if(next.lower<0||next.lower>=next.upper||next.upper>24)return
 if(name===null)store.updateConf({mood_limits:next})
 else store.updateConf({operator_mood_limits:{...overrides.value,[name]:next}})
}
function addOperator():void {
 if(!selected.value)return
 store.updateConf({operator_mood_limits:{...overrides.value,[selected.value]:{...(defaults.value??{lower:0,upper:24})}}});selected.value=null
}
function removeOperator(name:string):void {const next={...overrides.value};delete next[name];store.updateConf({operator_mood_limits:next})}
defineExpose({enableDefaults,updateRange,addOperator,removeOperator,selected})
</script>
<template>
  <div class="mood-limits-editor">
    <n-checkbox :checked="defaults != null" @update:checked="enableDefaults">自定义排班内全体干员</n-checkbox>
    <div v-if="defaults" class="mood-range">
      <span>下限</span><n-input-number :value="defaults.lower" :min="0" :max="defaults.upper-0.1" :precision="1" aria-label="全体心情下限" @update:value="updateRange(null,'lower',$event)" />
      <span>上限</span><n-input-number :value="defaults.upper" :min="defaults.lower+0.1" :max="24" :precision="1" aria-label="全体心情上限" @update:value="updateRange(null,'upper',$event)" />
    </div>
    <div v-for="(limits,name) in overrides" :key="name" class="mood-range">
      <span>{{ OPERATORS.find(op => op.charId === name)?.name ?? name }}</span>
      <span>下限</span><n-input-number :value="limits.lower" :min="0" :max="limits.upper-0.1" :precision="1" :aria-label="`${name}心情下限`" @update:value="updateRange(name,'lower',$event)" />
      <span>上限</span><n-input-number :value="limits.upper" :min="limits.lower+0.1" :max="24" :precision="1" :aria-label="`${name}心情上限`" @update:value="updateRange(name,'upper',$event)" />
      <n-button quaternary @click="removeOperator(name)">移除</n-button>
    </div>
    <div class="mood-range">
      <n-select v-model:value="selected" class="operator-select" :options="choices" filterable clearable placeholder="选择单独设置的干员" aria-label="单独设置心情的干员" />
      <n-button :disabled="!selected" @click="addOperator">添加</n-button>
    </div>
    <p>个人设置优先，其次令夕模式、全体设置；未设置沿用自动规则。阈值按上下限换算，仅对排班内主班、替班生效。</p>
  </div>
</template>
<style scoped>
.mood-limits-editor {display:flex;flex-direction:column;gap:10px;width:100%;}
.mood-range {display:flex;align-items:center;flex-wrap:wrap;gap:8px;}
.mood-range :deep(.n-input-number) {width:100px;}
.operator-select {width:220px;max-width:100%;}
p {margin:0;opacity:.65;line-height:1.6;}
</style>
