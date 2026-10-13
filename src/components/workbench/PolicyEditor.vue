<template>
  <section class="mower-policy-editor" aria-label="策略配置">
    <div class="plan-advanced-actions">
      <n-button @click="showAdvanced = true">高级设置</n-button>
      <n-button @click="showMood = true">设置心情上下限</n-button>
    </div>
    <n-form class="policy-form" :show-feedback="false" label-placement="left" label-width="160" label-align="left">
      <n-form-item v-for="field in POLICY_LIST_FIELDS" :key="field.key" :data-field="field.key">
        <template #label>
          <span>{{ field.label }}</span>
          <n-tooltip trigger="hover">
            <template #trigger><span class="help-icon" tabindex="0" :aria-label="field.label + '说明'">?</span></template>
            <div class="help-content">{{ field.help }}</div>
          </n-tooltip>
        </template>
        <div class="policy-list-editor" :data-test="`list-editor-${field.key}`">
          <n-select
            :value="getList(field.key)" multiple filterable clear-filter-after-select
            :options="getSelectOptions(field.key)" :filter="filterOperator"
            :placeholder="field.placeholder" :render-label="renderOptionLabel"
            :render-tag="props => renderTag(field.key, props)"
            :data-test="`add-select-${field.key}`"
            @update:value="setList(field.key, $event)"
          />
        </div>
      </n-form-item>
      <n-form-item label="宿舍优先级排序" data-field="dorm_order">
        <n-select :value="dormOrder" multiple :options="dormOptions" placeholder="默认 1 → 2 → 3 → 4，可插入低优位"
          @update:value="setDormOrder" />
      </n-form-item>
    </n-form>
    <n-modal v-model:show="showAdvanced" preset="card" title="高级设置" :auto-focus="false" class="policy-dialog" :style="{ width: '800px', maxWidth: 'calc(100vw - 24px)' }" :content-style="{maxHeight:'75vh',overflowY:'auto'}">
      <PlanAdvancedSettings />
      <template #footer><n-button @click="showAdvanced = false">完成</n-button></template>
    </n-modal>
    <n-modal v-model:show="showMood" preset="card" title="设置心情上下限" :auto-focus="false" :style="{width:'680px',maxWidth:'calc(100vw - 24px)'}" :content-style="{maxHeight:'70vh',overflowY:'auto'}">
      <n-form label-placement="top" :show-feedback="false">
        <n-form-item label="令夕模式" data-field="ling_xi">
          <n-radio-group :value="conf.ling_xi === 0 ? 3 : conf.ling_xi" data-test="ling-xi-radio-group" @update:value="onLingXiChange">
            <n-space><n-radio :value="1">感知信息</n-radio><n-radio :value="2">人间烟火</n-radio><n-radio :value="3">均衡模式</n-radio></n-space>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="自定义上下限"><MoodLimitsEditor /></n-form-item>
      </n-form>
      <template #footer><n-button @click="showMood = false">完成</n-button></template>
    </n-modal>
  </section>
</template>

<script setup lang="ts">
/** Adapted from Mower alpha ab0a4e5 Plan.vue / SlickOperatorSelect.vue (MIT, Copyright 2021 Nano). */
import { computed, h, ref, type VNode } from 'vue'
import { NAvatar, NButton, NForm, NFormItem, NModal, NRadio, NRadioGroup, NSelect, NSpace, NTag, NTooltip, type SelectOption } from 'naive-ui'
import { match } from 'pinyin-pro'
import { OPERATOR_MAP, OPERATORS } from '../../domain/operators'
import { useRosterWorkbenchStore } from '../../workbench/store'
import { getOperatorAvatarUrl } from '../../workbench/operatorHelpers'
import { POLICY_LIST_FIELDS, type PolicyOperatorListKey } from './policyFields'
import MoodLimitsEditor from './MoodLimitsEditor.vue'
import PlanAdvancedSettings from './PlanAdvancedSettings.vue'

const store = useRosterWorkbenchStore()
const conf = computed(() => store.workspace.mainPlan.conf)
const showAdvanced = ref(false), showMood = ref(false)
const dormOrder = computed(() => typeof conf.value.dorm_order === 'string' ? conf.value.dorm_order.split(',').filter(Boolean) : [])
const dormOptions = Array.from({ length: 4 }, (_, i) => [
  {value:`dormitory_${i+1}`,label:`宿舍${i+1} 高优位`},
  {value:`dormitory_${i+1}_low`,label:`宿舍${i+1} 低优位`},
]).flat()
function setDormOrder(values:string[]):void { store.updateConf({dorm_order:values.join(',')}) }
function getOperatorName(id: string): string { return OPERATOR_MAP.get(id)?.name ?? id }
function getList(key: PolicyOperatorListKey): string[] { const raw=conf.value[key]; return Array.isArray(raw)?raw:[] }
function setList(key: PolicyOperatorListKey, values: string[]): void { store.updateConf({[key]:[...new Set(values)]}) }
function onLingXiChange(value: number): void { if(value===1||value===2||value===3)store.updateConf({ling_xi:value}) }
function addOperator(key: PolicyOperatorListKey,id:string):void { if(id)setList(key,[...getList(key),id]) }
function removeOperator(key:PolicyOperatorListKey,index:number):void { setList(key,getList(key).filter((_,i)=>i!==index)) }
function moveOperator(key:PolicyOperatorListKey,from:number,to:number):void {
 const values=[...getList(key)];if(from<0||to<0||from>=values.length||to>=values.length)return
 const [value]=values.splice(from,1);values.splice(to,0,value!);setList(key,values)
}
const operatorOptions=OPERATORS.map(op=>({label:op.name,value:op.charId}))
function getSelectOptions(key:PolicyOperatorListKey):SelectOption[] {
 return [...operatorOptions,...getList(key).filter(id=>!OPERATOR_MAP.has(id)).map(id=>({label:id,value:id}))]
}
function filterOperator(pattern:string,option:SelectOption):boolean {
 const text=String(option.label??'');return text.includes(pattern)||(match(text,pattern,{v:true})??match(text,pattern))!==null
}
function renderOptionLabel(option:SelectOption):VNode {
 return h('span',{class:'operator-option'},[h(NAvatar,{src:getOperatorAvatarUrl(String(option.value)),size:24,style:{verticalAlign:'middle',marginRight:'6px'}}),String(option.label)])
}
function renderTag(key:PolicyOperatorListKey,{option,handleClose}:{option:SelectOption;handleClose:()=>void}):VNode {
 const id=String(option.value),index=getList(key).indexOf(id)
 return h(NTag,{
  closable:true,round:false,'data-test':`tag-${key}-${index}`,draggable:true,tabindex:0,
  title:'拖动排序；Alt + 左右方向键调整顺序',
  onClose:(e:MouseEvent)=>{e.stopPropagation();handleClose()},
  onDragstart:(event:DragEvent)=>event.dataTransfer?.setData('application/x-mower-policy',JSON.stringify({key,index})),
  onDragover:(event:DragEvent)=>event.preventDefault(),
  onDrop:(event:DragEvent)=>{event.preventDefault();try {const source=JSON.parse(event.dataTransfer?.getData('application/x-mower-policy')??'');if(source.key===key&&Number.isInteger(source.index))moveOperator(key,source.index,index)}catch{/* Ignore unrelated drags. */}},
  onKeydown:(event:KeyboardEvent)=>{if(event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();moveOperator(key,index,index+(event.key==='ArrowLeft'?-1:1))}},
 },{default:()=>[h(NAvatar,{src:getOperatorAvatarUrl(id),size:24,style:{marginRight:'4px'}}),getOperatorName(id)]})
}
defineExpose({addOperator,removeOperator,moveOperator,onLingXiChange,getList,getOperatorName,POLICY_LIST_FIELDS,showMood,showAdvanced})
</script>

<style scoped>
.mower-policy-editor {width:100%;max-width:980px;margin:0 auto 12px;padding:0 12px;box-sizing:border-box;}
.plan-advanced-actions {display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px;}
.policy-list-editor {width:100%;min-width:0;}
.help-icon {display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-left:6px;width:16px;height:16px;border-radius:50%;background:#ffffff20;font-size:11px;cursor:help;}
.help-content {max-width:420px;white-space:pre-line;line-height:1.6;}
.policy-form :deep(.n-form-item-label) {align-items:center;}
@media(max-width:640px){.policy-form :deep(.n-form-item){display:block;}.policy-form :deep(.n-form-item-label){width:auto!important;text-align:left;justify-content:flex-start;padding-bottom:6px;}}
</style>
