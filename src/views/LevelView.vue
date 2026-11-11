<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useBank } from '../stores/bank'
import { useStudy } from '../stores/study'
import { useDrill } from '../stores/drill'
import { replayDrill, summarize } from '../lib/drill'

const route = useRoute()
const bank = useBank()
const st = useStudy()
const drill = useDrill()

const slug = computed(() => route.params.slug)
const info = computed(() => bank.levelBySlug(slug.value))
const loading = ref(true)
const openBlocks = ref({})

watch(slug, async (s) => {
  if (!bank.meta) await bank.fetchMeta()
  await bank.loadLevel(s)
  loading.value = false
  openBlocks.value = Object.fromEntries((info.value?.blocks || []).map((b, i) => [b.code, i === 0]))
}, { immediate: true })

/* 本页是浏览模式的目录：小节进度条显示全部练习模式汇总的完成度
   （刷题 / 模考 / 错题本 / 收藏夹），与首页下面那条只读阅读链路区分开，
   避免把阅读误当成练习进度。 */
const qsOfLevel = computed(() => bank.loaded[slug.value]?.qs || [])
const drillProgress = computed(() =>
  replayDrill(st.attempts, qsOfLevel.value.map((q) => q.id), drill.resets)
)
const idsBySec = computed(() => {
  const m = new Map()
  for (const q of qsOfLevel.value) {
    if (!m.has(q.sec)) m.set(q.sec, [])
    m.get(q.sec).push(q.id)
  }
  return m
})
function secProgress(code) {
  return summarize(idsBySec.value.get(code) || [], drillProgress.value.score, drillProgress.value.seen).aptitude
}
function secTotal(code) {
  for (const b of info.value?.blocks || []) {
    const s = b.secs.find((x) => x.code === code)
    if (s) return s.count
  }
  return 0
}
function secState(code) {
  const p = secProgress(code)
  if (!p) return ''
  return p >= 80 ? 'good' : p >= 50 ? 'mid' : 'low'
}
</script>

<template>
  <div class="wrap" v-if="info">
    <div class="crumb">
      <RouterLink to="/">题库总览</RouterLink>
      <span class="sep">/</span>
      <span>{{ info.en }}</span>
    </div>

    <header class="head card" :style="{ '--c': info.color }">
      <div class="h-l">
        <span class="badge">{{ info.tag }}</span>
        <h1>{{ info.en }} <span class="zh">{{ info.key }}</span></h1>
        <p class="desc">{{ info.desc }}</p>
        <div class="facts">
          <span>{{ info.count }} 题</span>
          <span>{{ info.period }}</span>
          <span>{{ info.imgCount }} 张配图</span>
          <span>考试 {{ info.exam.questions }} 题 / 答对 {{ info.exam.pass }}</span>
        </div>
      </div>
      <div class="h-r">
        <RouterLink to="/study" class="btn btn-primary">进入刷题模式</RouterLink>
        <RouterLink :to="`/exam/${info.slug}`" class="btn">立即模拟考试</RouterLink>
        <RouterLink :to="`/l/${info.slug}/${info.blocks[0]?.secs[0]?.code}`" class="btn">从头浏览</RouterLink>
      </div>
    </header>

    <div class="browse-note">
      <span>下方各小节属于<b>浏览模式</b>：默认显示正确答案与解析，仅供阅读学习，不计分。</span>
      <span>进度条是刷题 / 模考 / 错题本 / 收藏夹汇总的完成度，<RouterLink to="/study">去刷题 →</RouterLink></span>
    </div>

    <div v-if="loading" class="loading">题库加载中…</div>

    <div v-else class="blocks">
      <section v-for="b in info.blocks" :key="b.code" class="blk card">
        <button class="blk-h" @click="openBlocks[b.code] = !openBlocks[b.code]">
          <span class="blk-code">{{ b.code }}</span>
          <span class="blk-name">{{ b.name }}</span>
          <span class="blk-n">{{ b.count }} 题</span>
          <svg class="caret" :class="{ up: openBlocks[b.code] }" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M4 6l4 4 4-4"/>
          </svg>
        </button>

        <div v-show="openBlocks[b.code]" class="secs">
          <RouterLink
            v-for="s in b.secs" :key="s.code"
            :to="`/l/${info.slug}/${s.code}`" class="sec" :class="secState(s.code)"
          >
            <span class="s-code">{{ s.code }}</span>
            <span class="s-n">{{ s.count }} 题</span>
            <span class="s-bar" :title="`练习完成度 ${secProgress(s.code)}%`"><i :style="{ width: secProgress(s.code) + '%' }"></i></span>
            <span class="s-pct">{{ secProgress(s.code) }}%</span>
            <span class="s-d">难度 {{ s.avgDiff }}</span>
          </RouterLink>
        </div>
      </section>
    </div>
  </div>

  <div v-else class="wrap"><div class="loading">级别不存在</div></div>
</template>

<style scoped>
.wrap { max-width: 1080px; margin: 0 auto; padding: 24px 20px 60px; }
.crumb { font-size: 13px; color: var(--text-3); margin-bottom: 14px; }
.crumb a:hover { color: var(--tech); }
.sep { margin: 0 7px; opacity: .5; }

.head {
  display: flex; gap: 22px; align-items: flex-end; flex-wrap: wrap;
  padding: 24px 26px; border-top: 3px solid var(--c); margin-bottom: 22px;
}
.h-l { flex: 1; min-width: 280px; }
.badge {
  display: inline-block; padding: 2px 9px; border-radius: 6px; font-size: 12px; font-weight: 600;
  background: color-mix(in srgb, var(--c) 12%, transparent); color: var(--c);
}
.head h1 { font-size: 25px; margin-top: 9px; letter-spacing: -.02em; }
.head h1 .zh { font-size: 16px; color: var(--text-2); font-weight: 500; }
.desc { margin-top: 7px; color: var(--text-2); font-size: 14.5px; line-height: 1.65; }
.facts { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; font-size: 12.5px; color: var(--text-3); }
.facts span { padding-left: 11px; border-left: 2px solid var(--line); }
.facts span:first-child { padding-left: 0; border-left: none; }

.h-r { display: flex; gap: 10px; flex-wrap: wrap; }
.browse-note {
  display: flex; gap: 8px 20px; flex-wrap: wrap;
  padding: 10px 15px; margin-bottom: 18px; border-radius: var(--r);
  border: 1px dashed var(--line-2); background: var(--surface-2);
  font-size: 12.5px; color: var(--text-2);
}
.browse-note b { color: var(--gen); }
.browse-note a { color: var(--tech); font-weight: 600; }
.browse-note a:hover { text-decoration: underline; }

.blocks { display: flex; flex-direction: column; gap: 12px; }
.blk { overflow: hidden; }
.blk-h {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 14px 20px; text-align: left;
}
.blk-h:hover { background: var(--surface-2); }
.blk-code {
  font-family: var(--mono); font-weight: 600; font-size: 14px;
  background: var(--surface-sunken); padding: 2px 8px; border-radius: 6px;
}
.blk-name { font-weight: 550; font-size: 15px; flex: 1; }
.blk-n { font-size: 13px; color: var(--text-3); font-family: var(--mono); }
.caret { color: var(--text-3); transition: .18s; }
.caret.up { transform: rotate(180deg); }

.secs {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 9px; padding: 4px 16px 16px;
}
.sec {
  display: flex; align-items: center; gap: 9px;
  padding: 10px 13px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--surface-2);
  transition: .14s;
}
.sec:hover { border-color: var(--gen); background: #fff; transform: translateY(-1px); }
.s-code { font-family: var(--mono); font-size: 13.5px; font-weight: 600; width: 44px; }
.s-n { font-size: 12px; color: var(--text-3); }
.s-bar { flex: 1; height: 4px; border-radius: 3px; background: var(--line); overflow: hidden; min-width: 26px; }
.s-bar i { display: block; height: 100%; background: var(--gen); transition: width .3s; }
.sec.good .s-bar i { background: var(--ok); }
.sec.mid .s-bar i { background: var(--star); }
.sec.low .s-bar i { background: var(--err); }
.s-pct { font-size: 11.5px; color: var(--text-3); width: 30px; text-align: right; font-family: var(--mono); }
.s-d { display: none; }

.loading { padding: 50px; text-align: center; color: var(--text-3); }

@media (max-width: 620px) {
  .head { padding: 20px 18px; }
  .secs { grid-template-columns: 1fr 1fr; padding: 4px 12px 12px; }
}
</style>
