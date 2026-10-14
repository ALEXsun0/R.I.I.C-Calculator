<script setup lang="ts">
import { computed } from 'vue'
import type { CalculationBottleneckSummary } from '../../workbench/calculationBottlenecks'

const props = defineProps<{ summary: CalculationBottleneckSummary }>()
const outcomes = { completed: '演算已完成', cancelled: '演算已中止', failed: '演算失败', changed: '排班已变更，演算已停止' }
const number = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '未知'
const observations = computed(() => [
  ...(props.summary.slowest ? [{ key: 'slowest', title: '慢速历史观测', ...props.summary.slowest }] : []),
  ...(props.summary.latest ? [{ key: 'latest', title: '最后收到的观测', ...props.summary.latest }] : []),
])
const constraints = computed(() => [...new Set(observations.value.flatMap(entry =>
  (entry.activity.findings ?? []).filter(finding => finding.kind === 'constraint').map(finding => finding.message),
))])
const headline = computed(() => {
  if (props.summary.diagnostics.length) {
    const recovered = props.summary.diagnostics.some(diagnostic => diagnostic.code === 'SHIFT_DEFERRED_RECOVERED')
    return `本次记录 ${props.summary.diagnostics.length} 项历史诊断${recovered ? '（含已恢复记录）' : ''}：${props.summary.diagnostics[0]!.message}`
  }
  if (constraints.value.length) return `观测到 ${constraints.value.length} 项调度约束：${constraints.value[0]}`
  if (props.summary.slowest) return '记录到慢速观测，尚未确定卡点原因。'
  if (props.summary.latest) return '未记录到明确卡点。'
  return '未收到演算观测，无法判断卡点。'
})
const names = computed(() => [...new Set(observations.value.flatMap(entry => entry.activity.operators.map(operator => operator.name)))])
</script>

<template>
  <section class="bottleneck-summary" :class="`outcome-${summary.outcome}`" data-test="calculation-bottleneck-summary" aria-label="本次演算卡点摘要">
    <div class="summary-heading" role="status">
      <strong>{{ outcomes[summary.outcome] }} · 卡点摘要</strong>
      <span>用时 {{ number(summary.elapsedSeconds) }} 秒</span>
    </div>
    <p class="summary-headline" data-test="bottleneck-headline">{{ headline }}</p>
    <p v-if="names.length" class="summary-associated">观测关联干员：{{ names.slice(0, 4).join('、') }}{{ names.length > 4 ? `等 ${names.length} 人` : '' }}。关联不代表变慢原因。</p>
    <p v-if="summary.error" class="summary-error" data-test="bottleneck-error">计算错误：{{ summary.error }}</p>
    <details class="summary-details" data-test="bottleneck-details">
      <summary>查看观测与诊断详情</summary>
      <div class="details-content">
        <p>结束前最后进度：{{ summary.progressLabel || '未收到进度' }}</p>
        <p>以下为本次演算结束前的记录。历史调度约束不表示结束时仍未解决；活动关联和重复事件仅供排查，不能据此认定变慢根因。</p>
        <p v-if="summary.silence" data-test="bottleneck-silence">
          结束前 {{ number(summary.silence.seconds) }} 秒未收到后台进度。
          <template v-if="summary.silence.lastProgressSeconds !== null">最后进度收到于启动后 {{ number(summary.silence.lastProgressSeconds) }} 秒。</template>
          <template v-else>本次未收到后台进度。</template>
        </p>
        <article v-for="observation in observations" :key="observation.key" class="observation" :data-test="`bottleneck-${observation.key}`">
          <h3>{{ observation.title }} <span>启动后 {{ number(observation.receivedSeconds) }} 秒收到</span></h3>
          <p>观测时状态：{{ observation.activity.status === 'slow' ? '推进较慢' : '正常推进' }} · 模拟时刻 {{ number(observation.activity.capturedHours) }} 小时</p>
          <p>{{ number(observation.activity.windowSeconds) }} 秒内推进 {{ number(observation.activity.advancedHours) }} 小时 · {{ observation.activity.iterations }} 次演算</p>
          <ul v-if="observation.activity.findings?.length" class="finding-list">
            <li v-for="(finding, index) in observation.activity.findings" :key="`${finding.code}-${index}`" :data-kind="finding.kind">
              <strong>{{ finding.kind === 'constraint' ? '调度约束' : '活动观察' }}</strong>：{{ finding.message }}
              <span v-if="finding.operatorIds.length"> · 关联干员：{{ finding.operatorIds.map(id => observation.activity.operators.find(operator => operator.id === id)?.name ?? id).join('、') }}</span>
            </li>
          </ul>
          <ul v-if="observation.activity.operators.length" class="operator-list">
            <li v-for="operator in observation.activity.operators" :key="operator.id">
              <strong>{{ operator.name }}</strong> · 心情 {{ number(operator.morale) }} / {{ number(operator.upperLimit) }}
              · 绑组 {{ operator.groups.join('、') || '无' }} · 设施 {{ operator.room || '未知' }}
              · 近期事件 {{ operator.eventCount }} 次<template v-if="operator.eventCount === 0">（任务关联）</template>
            </li>
          </ul>
          <p v-else>未观测到关联干员。</p>
          <p v-if="observation.activity.task">
            {{ observation.activity.task.source === 'active' ? '观测时执行任务' : '观测时队列任务（不代表已执行）' }}：{{ observation.activity.task.label }}
            · 计划时刻 {{ number(observation.activity.task.dueHours) }} 小时 · 设施 {{ observation.activity.task.rooms.join('、') || '未指定' }}
            <template v-if="observation.activity.task.metadata"> · {{ observation.activity.task.metadata }}</template>
          </p>
          <p v-else>未观测到任务。</p>
          <p v-if="observation.activity.recentEvents.length">近期事件计数（最多 256 条记录）：{{ observation.activity.recentEvents.map(event => `${event.label} ${event.count} 次`).join('；') }}</p>
          <p v-else>未观测到近期事件。</p>
        </article>
        <div v-if="summary.diagnostics.length" class="report-diagnostics" data-test="bottleneck-diagnostics">
          <h3>历史调度与演算诊断</h3>
          <ul><li v-for="(diagnostic, index) in summary.diagnostics" :key="`${diagnostic.code}-${index}`">{{ diagnostic.message }} <span>（{{ diagnostic.code }}）</span></li></ul>
        </div>
      </div>
    </details>
  </section>
</template>

<style scoped>
.bottleneck-summary { margin: 0 0 16px; padding: 12px 16px; border: 1px solid #726243; border-left: 4px solid #d8ad60; border-radius: 8px; background: #25251f; color: #e7e4da; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; min-width: 0; }
.summary-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 16px; }
.summary-heading strong { font-size: 15px; }
.summary-heading span, .observation h3 span { font-weight: 400; color: #c0bdb5; font-size: 12px; }
.bottleneck-summary p { margin: 5px 0; }
.summary-headline { font-weight: 600; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.summary-associated { color: #d4cec0; }
.summary-error { color: #ffb9aa; max-height: 5em; overflow: auto; }
.summary-details summary { cursor: pointer; color: #ecd3a3; padding: 4px 0; }
.summary-details summary:focus-visible { outline: 2px solid #ecd3a3; outline-offset: 3px; }
.details-content { max-height: min(52vh, 540px); overflow: auto; scrollbar-gutter: stable; }
.observation { margin-top: 12px; padding-top: 8px; border-top: 1px solid #565044; }
.bottleneck-summary h3 { margin: 4px 0; font-size: 13px; }
.bottleneck-summary ul { padding-left: 20px; margin: 5px 0; }
.finding-list [data-kind="constraint"] strong { color: #f4d48e; }
.outcome-failed { border-left-color: #e28f7d; }
@media (max-width: 600px) { .bottleneck-summary { padding: 10px 12px; margin-bottom: 12px; } .details-content { max-height: 42vh; } }
</style>
