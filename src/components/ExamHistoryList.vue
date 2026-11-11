<script setup>
/**
 * 模考记录列表。进度页（最近 5 场）与完整记录页（全部场次）共用，
 * 时间、级别都是回顾链接 —— 点进去看到的就是交卷那一刻的成绩单。
 */
defineProps({
  sessions: { type: Array, default: () => [] },
})

const reviewTo = (e) => `/exam/review/${e.id}`

function fmtDate(ts) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function pct(e) {
  return e.total ? Math.round((e.correct / e.total) * 100) : 0
}
</script>

<template>
  <ul class="ex">
    <li v-for="e in sessions" :key="e.id">
      <RouterLink class="d" :to="reviewTo(e)" :title="`回顾 ${fmtDate(e.ts)} 的模考`">{{ fmtDate(e.ts) }}</RouterLink>
      <RouterLink class="lvtag" :to="reviewTo(e)" :title="`回顾这场 ${e.level} 模考`">{{ e.level }}</RouterLink>
      <span class="sc"><b>{{ e.correct }}</b>/{{ e.total }}</span>
      <span class="bar2"><i :style="{ width: pct(e) + '%' }"></i></span>
      <span class="rate" :class="pct(e) >= 74 ? 'ok' : 'no'">{{ pct(e) }}%</span>
      <span class="dur">{{ Math.round((e.durationSec || 0) / 60) }} 分钟</span>
    </li>
  </ul>
</template>

<style scoped>
.ex { list-style: none; margin: 0; padding: 0; }
.ex li { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px dashed var(--line); font-size: 13.5px; }
.ex li:first-child { border-top: none; }
.d { width: 84px; flex: none; color: var(--text-3); font-size: 12.5px; font-family: var(--mono); }
.lvtag { flex: none; color: var(--text-2); }
.d:hover, .lvtag:hover { color: var(--tech); text-decoration: underline; }
.sc { font-family: var(--mono); flex: none; }
.bar2 { flex: 1; height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; min-width: 40px; }
.bar2 i { display: block; height: 100%; background: var(--gen); }
.rate { font-family: var(--mono); font-weight: 600; width: 42px; flex: none; text-align: right; }
.rate.ok { color: var(--ok); }
.rate.no { color: var(--err); }
.dur { width: 60px; flex: none; text-align: right; font-size: 12.5px; color: var(--text-3); }

@media (max-width: 620px) {
  .ex li { flex-wrap: wrap; gap: 8px; }
  .bar2 { order: 5; width: 100%; }
}
</style>
