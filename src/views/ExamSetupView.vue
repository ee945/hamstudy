<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useBank, slugOf } from '../stores/bank'
import { useStudy } from '../stores/study'

const bank = useBank()
const st = useStudy()
// 注意：useRouter() 内部是 inject()，只能在 setup 同步期调用，不能挪进事件回调
const router = useRouter()
const mode = ref('random')

watch(() => bank.meta, () => {}, { immediate: true })
if (!bank.meta) bank.fetchMeta()

const wrongByLevel = computed(() => {
  // 按题号首字母归级，不读 w.level：老记录的 level 是空的，
  // 读它的话这批错题会漏到 undefined 分组，界面显示 0 题、模考也抽不到。
  const m = {}
  for (const w of st.wrongList) {
    const s = slugOf(w.qid)
    if (s) m[s] = (m[s] || 0) + 1
  }
  return m
})
const doneByLevel = computed(() => {
  const m = {}
  for (const [, v] of st.mastery) m[v] = v
  // 用 section 前缀粗算（T/G/E）。前缀由 slug 反查，不要依赖 levels 的数组顺序
  const PREFIX = { technician: 'T', general: 'G', extra: 'E' }
  const out = {}
  for (const l of bank.levels) {
    const p = PREFIX[l.slug]
    let n = 0
    for (const [sec, v] of st.mastery) if (sec.startsWith(p)) n += v.done
    out[l.key] = n
  }
  return out
})

function start(slug) {
  router.push({ name: 'exam', params: { slug }, query: { mode: mode.value } })
}
</script>

<template>
  <div class="wrap">
    <div class="crumb"><RouterLink to="/">首页</RouterLink><span class="sep">/</span><span>模拟考试</span></div>
    <h1 class="t">模拟考试</h1>
    <p class="st">按真实考试规则抽题，交卷后即时判分并逐题回顾解析。</p>

    <div class="modes card">
      <div class="mode-h">抽题方式</div>
      <div class="opts">
        <button class="mo" :class="{ on: mode === 'random' }" @click="mode = 'random'">
          <b>随机全真</b><span>从该级别全部题目随机抽取</span>
        </button>
        <button class="mo" :class="{ on: mode === 'wrong' }" @click="mode = 'wrong'">
          <b>错题强化</b><span>优先抽取错题本中的题目</span>
        </button>
        <button class="mo" :class="{ on: mode === 'new' }" @click="mode = 'new'">
          <b>未练优先</b><span>优先抽取还没做过的题目</span>
        </button>
      </div>
    </div>

    <div class="levels">
      <div v-for="l in bank.levels" :key="l.slug" class="card lv" :style="{ '--c': l.color }">
        <div class="lv-h">
          <span class="tag" :style="{ background: l.color + '18', color: l.color }">{{ l.tag }}</span>
          <h3>{{ l.en }}</h3>
        </div>
        <div class="rows">
          <div class="row"><span>考试题量</span><b>{{ l.exam.questions }} 题</b></div>
          <div class="row"><span>考试时长</span><b>{{ l.exam.minutes }} 分钟</b></div>
          <div class="row"><span>合格线</span><b>答对 {{ l.exam.pass }} 题（{{ Math.round(l.exam.pass / l.exam.questions * 100) }}%）</b></div>
          <div class="row"><span>题库总量</span><b>{{ l.count }} 题</b></div>
          <div class="row"><span>错题待清</span><b :class="{ warn: (wrongByLevel[l.slug] || 0) > 0 }">{{ wrongByLevel[l.slug] || 0 }} 题</b></div>
          <div class="row"><span>已练习</span><b>{{ doneByLevel[l.key] || 0 }} 题</b></div>
        </div>
        <button class="btn btn-primary go" @click="start(l.slug)">开始 {{ l.exam.questions }} 题模考</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap { max-width: 1080px; margin: 0 auto; padding: 24px 20px 60px; }
.crumb { font-size: 13px; color: var(--text-3); margin-bottom: 12px; }
.crumb a:hover { color: var(--tech); }
.sep { margin: 0 7px; opacity: .5; }
.t { font-size: 25px; margin-bottom: 6px; }
.st { color: var(--text-2); font-size: 14.5px; margin-bottom: 22px; }

.modes { padding: 16px 18px; margin-bottom: 20px; }
.mode-h { font-size: 13px; color: var(--text-3); margin-bottom: 10px; font-weight: 600; }
.opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.mo {
  text-align: left; padding: 11px 14px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--surface-2); transition: .14s;
}
.mo:hover { border-color: var(--gen); }
.mo.on { border-color: var(--gen); background: var(--gen-soft); }
.mo b { display: block; font-size: 14.5px; }
.mo span { font-size: 12.5px; color: var(--text-3); }

.levels { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 16px; }
.lv { padding: 20px 22px; border-top: 3px solid var(--c); display: flex; flex-direction: column; }
.lv-h { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.lv-h h3 { font-size: 19px; }
.rows { flex: 1; }
.row {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 8px 0; border-top: 1px dashed var(--line); font-size: 13.5px;
}
.row span { color: var(--text-3); }
.row b { font-family: var(--mono); }
.row b.warn { color: var(--err); }
.go { margin-top: 16px; width: 100%; }
</style>
