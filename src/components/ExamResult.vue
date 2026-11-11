<script setup>
/**
 * 模考成绩单（交卷结果 + 历史回顾共用）。
 *
 * 考试提交后 ExamView 直接渲染本组件；从「学习进度 → 模考记录」点进来的
 * 历史回顾页也渲染同一个组件，只是 result 由 hs_sessions.detail 还原。
 * 两处刻意共用一份模板与样式，保证回顾看到的内容与交卷那一刻完全一致：
 * 分数卡、四项统计、逐题对错题号、点击展开的题目解析。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBank } from '../stores/bank'
import QuestionCard from './QuestionCard.vue'

const props = defineProps({
  /** { correct, total, pass, passed, wrong, blank, durationSec, detail:[{qid,chosen,ok,sec}] } */
  result: { type: Object, required: true },
})

const router = useRouter()
const bank = useBank()
const reviewId = ref('')
const loadingQ = ref(false)
const ready = ref(false)

const detail = computed(() => Array.isArray(props.result?.detail) ? props.result.detail : [])

/** 逐题回顾要按 qid 取题面，先把明细涉及的级别题库装进来 */
watch(() => props.result, async (r) => {
  reviewId.value = ''
  ready.value = false
  const ids = (Array.isArray(r?.detail) ? r.detail : []).map((d) => d.qid).filter(Boolean)
  if (!ids.length) { ready.value = true; return }
  loadingQ.value = true
  try {
    if (!bank.meta) await bank.fetchMeta()
    await bank.ensureLoaded(ids)
  } catch (e) {
    console.warn('[exam-result] 题库加载失败', e?.message)
  } finally {
    loadingQ.value = false
    ready.value = true
  }
}, { immediate: true })

const reviewQ = computed(() => bank.effective(reviewId.value) || null)
/** 未作答的题用 '__none__' 占位：与交卷结果页一致，卡片会标出正确答案 */
const reviewPicked = computed(() => {
  const d = detail.value.find((x) => x.qid === reviewId.value)
  return d?.chosen || '__none__'
})

function retry() {
  router.push({ name: 'exam-setup' })
}
</script>

<template>
  <div class="exam-result">
    <div class="res card" :class="result.passed ? 'pass' : 'fail'">
      <div class="score">
        <b>{{ result.correct }}</b><span>/ {{ result.total }}</span>
      </div>
      <div class="verdict">
        <h2>{{ result.passed ? '通过' : '未通过' }}</h2>
        <p>合格线 {{ result.pass }} 题 · 正确率 {{ Math.round(result.correct / result.total * 100) }}% · 用时 {{ Math.round(result.durationSec / 60) }} 分钟</p>
      </div>
      <div class="acts">
        <button class="btn" @click="retry()">再来一套</button>
        <RouterLink to="/wrong" class="btn">查看错题本</RouterLink>
      </div>
    </div>

    <div class="facts-row">
      <div class="f card"><b>{{ result.correct }}</b><span>答对</span></div>
      <div class="f card err"><b>{{ result.wrong }}</b><span>答错</span></div>
      <div class="f card"><b>{{ result.blank }}</b><span>未答</span></div>
      <div class="f card"><b>{{ Math.round(result.durationSec / result.total) }}s</b><span>平均每题</span></div>
    </div>

    <!-- 错题回顾 -->
    <h3 class="sec-t">逐题回顾（点击题号查看解析）</h3>
    <template v-if="detail.length">
      <div class="chips">
        <button
          v-for="(d, k) in detail" :key="`${d.qid}-${k}`" class="chip"
          :class="[d.ok ? 'ok' : 'no', { on: reviewId === d.qid }]"
          @click="reviewId = reviewId === d.qid ? '' : d.qid"
        >{{ k + 1 }}. {{ d.qid }}</button>
      </div>

      <div v-if="loadingQ" class="loading q-load">题库加载中…</div>
      <div v-else-if="reviewQ" class="review wrap-q">
        <QuestionCard :q="reviewQ" mode="review" :picked="reviewPicked" />
      </div>
      <div v-else-if="reviewId && ready" class="loading q-load">
        这道题已不在当前题库中，无法展开解析。
      </div>
    </template>
    <p v-else class="no-detail">这场模考没有保存逐题明细，只能查看成绩概览。</p>
  </div>
</template>

<style scoped>
.res { display: flex; align-items: center; gap: 22px; padding: 22px 26px; margin-bottom: 16px; flex-wrap: wrap; }
.res.pass { border-left: 4px solid var(--ok); }
.res.fail { border-left: 4px solid var(--err); }
.score { display: flex; align-items: baseline; gap: 4px; }
.score b { font-size: 40px; font-family: var(--mono); letter-spacing: -.02em; }
.score span { font-size: 17px; color: var(--text-3); font-family: var(--mono); }
.res.pass .score b { color: var(--ok); }
.res.fail .score b { color: var(--err); }
.verdict { flex: 1; min-width: 220px; }
.verdict h2 { font-size: 20px; }
.verdict p { font-size: 13.5px; color: var(--text-2); margin-top: 3px; }
.acts { display: flex; gap: 9px; }

.facts-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 26px; }
.f { padding: 14px 16px; text-align: center; }
.f b { display: block; font-size: 22px; font-family: var(--mono); }
.f span { font-size: 12.5px; color: var(--text-3); }
.f.err b { color: var(--err); }

.sec-t { font-size: 15px; margin-bottom: 11px; color: var(--text-2); font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 16px; }
.chip {
  padding: 5px 11px; border-radius: 8px; font-size: 12.5px; font-family: var(--mono);
  border: 1px solid var(--line); background: var(--surface); color: var(--text-2);
}
.chip.ok { border-color: var(--ok); color: var(--ok); background: var(--ok-soft); }
.chip.no { border-color: var(--err); color: var(--err); background: var(--err-soft); }
.chip.on { box-shadow: var(--ring); font-weight: 700; }
.wrap-q { margin-top: 6px; }

.loading { padding: 70px; text-align: center; color: var(--text-3); }
.q-load { padding: 22px; font-size: 13px; }
.no-detail { font-size: 13px; color: var(--text-3); padding: 16px 0; }

@media (max-width: 620px) {
  .res { padding: 18px; gap: 14px; }
  .score b { font-size: 34px; }
  .facts-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
