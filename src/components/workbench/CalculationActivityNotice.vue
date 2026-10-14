<script setup lang="ts">
import { computed } from 'vue'
import type { SimulationActivity } from '../../simulator/simulationActivity'
import type { CalculationSilence } from '../../workbench/composables/useWorkbenchCalculation'

const props = defineProps<{ activity?: SimulationActivity; silence?: CalculationSilence | null; progressLabel?: string }>()
const activity = computed(() => props.activity ?? props.silence?.observation?.activity)
const number = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '未知'
</script>

<template>
  <section v-if="silence || activity?.status === 'slow'" class="calculation-activity" data-test="calculation-activity">
    <p class="activity-title" role="status">{{ silence ? '后台计算暂未响应' : '演算推进较慢' }}</p>
    <template v-if="silence">
      <p>已 {{ silence.seconds }} 秒未收到后台进度，计算尚未停止。可继续等待或中止计算。</p>
      <p v-if="silence.lastProgressSeconds !== null">最后进度：启动后 {{ silence.lastProgressSeconds }} 秒 · {{ progressLabel || '状态未知' }}</p>
      <p v-else>尚未收到后台进度，无法判断当前涉及的干员或任务。</p>
    </template>
    <template v-if="activity">
      <p v-if="silence">以下为最后收到的观察，可能已不是当前状态。</p>
      <p v-if="silence?.observation">演算观察收到于启动后 {{ silence.observation.receivedSeconds }} 秒。</p>
      <p>最近 {{ number(activity.windowSeconds) }} 秒推进 {{ number(activity.advancedHours) }} 小时 · {{ activity.iterations }} 次演算 · 观察时刻 {{ number(activity.capturedHours) }} 小时</p>
      <p>最近涉及的干员与任务仅供排查，不代表导致变慢的原因。</p>
      <ul v-if="activity.operators.length" class="activity-operators">
        <li v-for="operator in activity.operators" :key="operator.id">
          <strong>{{ operator.name }}</strong> · 心情 {{ number(operator.morale) }} / {{ number(operator.upperLimit) }}
          · 组 {{ operator.groups.join('、') || '无' }} · 房间 {{ operator.room || '未知' }} · 近期记录事件 {{ operator.eventCount }} 次
          <template v-if="operator.eventCount === 0">（任务关联）</template>
        </li>
      </ul>
      <p v-else>近期未观察到干员事件，暂无法定位相关干员。</p>
      <p v-if="activity.recentEvents.length">近期记录（最多 256 条）：{{ activity.recentEvents.map(event => `${event.label} ${event.count} 次`).join('；') }}</p>
      <p v-else>最近事件：暂无</p>
      <p v-if="activity.task" data-test="activity-task">
        {{ activity.task.source === 'active' ? '执行中任务' : '队列待执行任务（不代表正在执行）' }}：{{ activity.task.label }}
        · 计划时刻 {{ number(activity.task.dueHours) }} 小时
        · 房间 {{ activity.task.rooms.join('、') || '未指定' }}<template v-if="activity.task.metadata"> · {{ activity.task.metadata }}</template>
      </p>
      <p v-else>尚无可观察的任务。</p>
    </template>
  </section>
</template>

<style scoped>
.calculation-activity {
  width: 100%;
  padding: 12px 14px;
  box-sizing: border-box;
  border-radius: 6px;
  background: rgba(192, 133, 32, .09);
  box-shadow: inset 3px 0 0 rgba(192, 133, 32, .6);
  font-size: 13px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.calculation-activity p { margin: 4px 0; }
.activity-title { font-weight: 600; }
.activity-operators { margin: 6px 0; padding-left: 20px; }
</style>
