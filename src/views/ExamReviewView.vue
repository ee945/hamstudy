<script setup>
/**
 * 历史模考回顾。
 * 从学习进度页「模考记录」的时间 / 级别链接进来，按 session id 取出那场考试的
 * 逐题明细（hs_sessions.detail），还原成与交卷结果页一模一样的成绩单。
 * 这里不重新计分、不写任何答题流水，纯粹是只读回看。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useBank, slugOf } from '../stores/bank'
import { useStudy } from '../stores/study'
import ExamResult from '../components/ExamResult.vue'

const route = useRoute()
const bank = useBank()
const st = useStudy()

const SLUG = { 技术级: 'technician', 通用级: 'general', 业余特级: 'extra' }

const id = computed(() => String(route.params.id || ''))
const sess = computed(() => st.sessions.find((s) => s.id === id.value) || null)
const waiting = computed(() => !sess.value && (!st.hydrated || st.syncing))

/** 老记录里 level 是中文，details 里的题号首字母更可靠 */
const slug = computed(() => {
  const qid = sess.value?.detail?.[0]?.qid
  if (qid) return slugOf(qid)
  return SLUG[sess.value?.level] || ''
})

const result = computed(() => {
  const s = sess.value
  if (!s) return null
  const det = Array.isArray(s.detail) ? s.detail : []
  const total = Number(s.total) || det.length || 1
  const correct = Number.isFinite(s.correct) ? s.correct : det.filter((d) => d.ok).length
  const pass = bank.levelBySlug(slug.value)?.exam?.pass || Math.round(total * 0.74)
  return {
    correct,
    total,
    pass,
    passed: correct >= pass,
    // 与交卷时一致：答错数包含未作答的题，另单列未答数
    wrong: det.length ? det.filter((d) => !d.ok).length : total - correct,
    blank: det.filter((d) => !d.chosen).length,
    durationSec: Number(s.durationSec) || 0,
    detail: det,
  }
})

function fmt(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const MODE_LABEL = {
  'exam:random': '随机组卷', 'exam:wrong': '错题优先', 'exam:new': '新题优先',
}
</script>

<template>
  <div class="wrap">
    <div class="crumb">
      <RouterLink to="/progress">学习进度</RouterLink><span class="sep">/</span><span>模考回顾</span>
    </div>

    <p v-if="sess" class="meta-note">
      {{ fmt(sess.ts) }} · {{ sess.level }} · {{ MODE_LABEL[sess.mode] || '模拟考试' }}
      <em>历史成绩回顾，仅作查看，不会重新计分</em>
    </p>

    <ExamResult v-if="result" :result="result" />
    <div v-else-if="waiting" class="loading">正在同步模考记录…</div>
    <div v-else class="loading">
      找不到这场模考记录，可能已被清空或属于另一个账号。
      <div class="back"><RouterLink to="/progress" class="btn">返回学习进度</RouterLink></div>
    </div>
  </div>
</template>

<style scoped>
.wrap { max-width: 1180px; margin: 0 auto; padding: 18px 20px 60px; }
.crumb { font-size: 13px; color: var(--text-3); margin-bottom: 14px; }
.crumb a { color: var(--text-2); }
.crumb a:hover { color: var(--tech); }
.sep { margin: 0 8px; opacity: .55; }
.meta-note { font-size: 13px; color: var(--text-2); margin-bottom: 14px; }
.meta-note em { font-style: normal; color: var(--text-3); margin-left: 10px; }
.loading { padding: 70px 20px; text-align: center; color: var(--text-3); font-size: 14px; }
.back { margin-top: 18px; }
</style>
