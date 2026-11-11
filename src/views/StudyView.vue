<script setup>
/**
 * 刷题模式 —— 仿 HamStudy 官方 Study Mode 的流程：
 *   选 question set（整级 / 子单元 / 小节）→ 一次只出一题 → 立即判分并给出
 *   正确答案与解析 → 下一题；未见过的新题优先，见过之后按掌握度回炉。
 * 顶部常驻「已做题目占比 / 完成度」两条读数，按小节分组显示组内平均。
 *
 * 掌握分不落本地缓存，而是由 hs_attempts 的全部练习流水重放得到：
 * 刷题 / 模拟考试 / 错题本 / 收藏夹共用同一套完成度，登录同步、备份恢复、
 * 换设备都自动对齐（详见 lib/drill.js）。只读浏览与「显示答案」不计分。
 */
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useBank } from '../stores/bank'
import { useStudy } from '../stores/study'
import { useDrill } from '../stores/drill'
import {
  DRILL_MODE, MAX_SCORE, replayDrill, summarize, chooseNext,
} from '../lib/drill'
import { onKey } from '../lib/keys'
import QuestionCard from '../components/QuestionCard.vue'

const route = useRoute()
const bank = useBank()
const st = useStudy()
const drill = useDrill()

const phase = ref('setup')          // setup | run
const level = ref('technician')
const setCode = ref('all')          // all | T3 | T3C
const expanded = ref(null)          // setup 里展开的子单元
const loading = ref(false)

const cur = ref(null)
const recent = ref([])
const picked = ref('')
const revealed = ref(false)
const session = ref({ done: 0, ok: 0, skipped: 0 })
const confirmReset = ref(false)
const resetNote = ref(false)

const info = computed(() => bank.levelBySlug(level.value))
const allQs = computed(() => bank.loaded[level.value]?.qs || [])
const levelIds = computed(() => allQs.value.map((q) => q.id))
const scopeKey = computed(() => `${level.value}:${setCode.value}`)

/** 整级只重放一次流水；任意范围、任意小节的读数都从同一份 score/seen 聚合 */
const progress = computed(() => replayDrill(st.attempts, levelIds.value, drill.resets))
const pool = ref([])
const poolIds = computed(() => pool.value.map((q) => q.id))
const stat = computed(() => summarize(poolIds.value, progress.value.score, progress.value.seen))

/** 组内平均：官方按 subelement 分组，本站按小节分组，分母恒为 2 × 该组题数 */
const groupStats = computed(() => {
  const m = new Map()
  for (const q of pool.value) {
    const k = q.sec || q.id.slice(0, 3)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(q.id)
  }
  return [...m.entries()]
    .map(([code, ids]) => ({ code, ...summarize(ids, progress.value.score, progress.value.seen) }))
    .sort((a, b) => a.code.localeCompare(b.code))
})

const scopeLabel = computed(() => {
  if (setCode.value === 'all') return `${info.value?.en || ''} · 全部题目`
  const code = setCode.value
  for (const b of info.value?.blocks || []) {
    if (b.code === code) return `${info.value?.en} · ${b.code} ${b.name}`
    const s = b.secs.find((x) => x.code === code)
    if (s) return `${info.value?.en} · ${s.code} 小节`
  }
  return `${info.value?.en || ''} · ${code}`
})

/** setup 面板里每一行都带自己的已做 / 完成度读数 */
function statFor(ids) {
  return summarize(ids, progress.value.score, progress.value.seen)
}
function idsOfBlock(b) {
  return b.secs.flatMap((s) => s.ids)
}

async function ensureLevel() {
  if (!bank.meta) await bank.fetchMeta()
  loading.value = true
  try {
    await bank.loadLevel(level.value)
    buildPool()
  } finally {
    loading.value = false
  }
}

function buildPool() {
  const all = bank.loaded[level.value]?.qs || []
  const code = setCode.value === 'all' ? 'all' : String(setCode.value).toUpperCase()
  let ids = null
  if (code !== 'all') {
    ids = new Set()
    for (const b of info.value?.blocks || []) {
      if (b.code.toUpperCase() === code) {
        for (const s of b.secs) for (const id of s.ids) ids.add(id)
        break
      }
      const s = b.secs.find((x) => x.code.toUpperCase() === code)
      if (s) {
        for (const id of s.ids) ids.add(id)
        break
      }
    }
  }
  // 链接里带了无效的范围码时别把池子清空，退回整级，避免「点进去一题都没有」
  if (ids && !ids.size) ids = null
  pool.value = ids ? all.filter((q) => ids.has(q.id)) : [...all]
}

function chooseLevel(slug) {
  level.value = slug
  setCode.value = 'all'
  expanded.value = null
  ensureLevel()
}
function chooseSet(code) {
  setCode.value = code
  buildPool()
}
function toggleBlock(code) {
  // 点子单元行直接选中它，同时展开看下面的小节；再点一次只收起
  if (expanded.value === code) expanded.value = null
  else {
    expanded.value = code
    setCode.value = code
    buildPool()
  }
}

async function start() {
  await ensureLevel()
  if (!pool.value.length) return
  drill.setScope(level.value, setCode.value)
  phase.value = 'run'
  session.value = { done: 0, ok: 0, skipped: 0 }
  recent.value = []
  nextQuestion()
  nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
}

function nextQuestion() {
  clearTimeout(autoTimer)
  if (!pool.value.length) {
    cur.value = null
    return
  }
  const q = chooseNext(pool.value, progress.value.score, progress.value.seen, recent.value)
  cur.value = q
  recent.value = [...recent.value, q.id].slice(-6)
  picked.value = ''
  revealed.value = false
}

let autoTimer = null
function scheduleNext() {
  clearTimeout(autoTimer)
  if (!drill.autoNext) return
  autoTimer = setTimeout(() => {
    if (phase.value === 'run') nextQuestion()
  }, 1100)
}

function onAnswer({ letter, ok, q, reveal }) {
  if (reveal) {
    // 主动看答案：亮出正确项与解析，但不计分、不计入已做
    revealed.value = true
    return
  }
  if (picked.value || revealed.value || !q) return
  picked.value = letter
  st.record(q, ok, DRILL_MODE)
  session.value.done++
  if (ok) session.value.ok++
  scheduleNext()
}

function skip() {
  session.value.skipped++
  nextQuestion()
}

function goNext() {
  nextQuestion()
  nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
}

function backToSetup() {
  clearTimeout(autoTimer)
  phase.value = 'setup'
  confirmReset.value = false
}

function doReset() {
  if (!confirmReset.value) {
    confirmReset.value = true
    clearTimeout(doReset._t)
    doReset._t = setTimeout(() => (confirmReset.value = false), 8000)
    return
  }
  drill.resetScope(scopeKey.value)
  confirmReset.value = false
  resetNote.value = true
  clearTimeout(doReset._n)
  doReset._n = setTimeout(() => (resetNote.value = false), 4500)
  recent.value = []
  nextQuestion()
}

const answered = computed(() => !!picked.value || revealed.value)
const sessionRate = computed(() =>
  session.value.done ? Math.round((100 * session.value.ok) / session.value.done) : 0
)

let offKey = null
onMounted(async () => {
  offKey = onKey((e) => {
    if (phase.value !== 'run' || e.key !== 'ArrowRight') return
    e.preventDefault()
    goNext()
  })
  await bank.fetchMeta()
  // 记住上次的范围，刷新 / 下次进来直接续上（仿官方「继续 study」）。
  // 无论有没有上次范围，都要先把当前级别的题目装进来：范围面板的
  // 已做 / 完成度读数、以及「开始刷题」按钮都依赖这份题库。
  // 进度页「完成度较低的小节」会带 ?level=&set= 过来，优先按链接预选范围。
  const saved = drill.lastScope
  const qLevel = String(route.query.level || '')
  const qSet = String(route.query.set || '').toUpperCase()
  const fromLink = !!(qLevel && bank.levelBySlug(qLevel))
  const resume = fromLink || !!(saved?.level && bank.levelBySlug(saved.level))
  if (fromLink) {
    level.value = qLevel
    setCode.value = qSet || 'all'
  } else if (resume) {
    level.value = saved.level
    setCode.value = saved.set === 'all' ? 'all' : String(saved.set || 'all').toUpperCase()
  }
  await ensureLevel()
  if (resume && pool.value.length) {
    if (fromLink) drill.setScope(level.value, setCode.value)
    phase.value = 'run'
    nextQuestion()
  }
})
onUnmounted(() => {
  clearTimeout(autoTimer)
  clearTimeout(doReset._t)
  clearTimeout(doReset._n)
  offKey && offKey()
})

// 题库修订到位后原地写回题目对象，池子里的引用仍然有效，
// 但切换范围或级别时仍需重建一次，避免用到还没加载完的级别
watch(() => bank.loaded[level.value], () => {
  if (phase.value === 'run' && !pool.value.length) buildPool()
})
</script>

<template>
  <div class="wrap">
    <div class="crumb">
      <RouterLink to="/">首页</RouterLink><span class="sep">/</span><span>刷题模式</span>
    </div>

    <!-- ────────────── 选范围 ────────────── -->
    <template v-if="phase === 'setup'">
      <header class="head">
        <div>
          <h1>刷题模式</h1>
          <p class="sub">
            仿 HamStudy 官方 Study：新题优先、答错回炉，按最近作答的指数加权计算完成度。
            选好范围后一次一题，答完立即出答案与解析。
          </p>
        </div>
      </header>

      <div class="lv-tabs">
        <button
          v-for="l in bank.levels" :key="l.slug"
          class="lv-tab" :class="{ on: level === l.slug }"
          :style="{ '--c': l.color }" @click="chooseLevel(l.slug)"
        >
          <b>{{ l.en }}</b><span>{{ l.key }} · {{ l.count }} 题</span>
        </button>
      </div>

      <div v-if="loading" class="loading">题库加载中…</div>

      <section v-else class="card picker">
        <div class="pk-h">
          <span>选择刷题范围</span>
          <em>已做占比 = 去重作答过的题 / 本范围题数；完成度 = 组内平均掌握分</em>
        </div>

        <button class="row all" :class="{ on: setCode === 'all' }" @click="chooseSet('all')">
          <span class="radio" aria-hidden="true"></span>
          <span class="r-name"><b>全部题目</b><em>{{ info?.en }} · {{ levelIds.length }} 题</em></span>
          <span class="r-num"><b>{{ statFor(levelIds).seenPct }}%</b><em>已做</em></span>
          <span class="r-num"><b>{{ statFor(levelIds).aptitude }}%</b><em>完成度</em></span>
          <span class="r-bar"><i :style="{ width: statFor(levelIds).aptitude + '%' }"></i></span>
        </button>

        <div v-for="b in info?.blocks || []" :key="b.code" class="blk">
          <div class="row blk-row" :class="{ on: setCode === b.code }">
            <button class="blk-main" @click="toggleBlock(b.code)">
              <span class="caret" :class="{ up: expanded === b.code }">▸</span>
              <span class="r-name"><b>{{ b.code }} · {{ b.name }}</b><em>{{ b.secs.length }} 小节 · {{ b.count }} 题</em></span>
            </button>
            <button class="blk-pick" @click="chooseSet(b.code)">整个 {{ b.code }}</button>
            <span class="r-num"><b>{{ statFor(idsOfBlock(b)).seenPct }}%</b><em>已做</em></span>
            <span class="r-num"><b>{{ statFor(idsOfBlock(b)).aptitude }}%</b><em>完成度</em></span>
            <span class="r-bar"><i :style="{ width: statFor(idsOfBlock(b)).aptitude + '%' }"></i></span>
          </div>
          <div v-if="expanded === b.code" class="secs">
            <button
              v-for="s in b.secs" :key="s.code"
              class="sec" :class="{ on: setCode === s.code }" @click="chooseSet(s.code)"
            >
              <span class="s-code">{{ s.code }}</span>
              <span class="s-n">{{ s.count }} 题</span>
              <span class="s-pct">已做 {{ statFor(s.ids).seenPct }}%</span>
              <span class="s-pct">完成度 <b>{{ statFor(s.ids).aptitude }}%</b></span>
            </button>
          </div>
        </div>

        <div class="pk-f">
          <span class="chosen">当前：<b>{{ scopeLabel }}</b> · {{ poolIds.length }} 题</span>
          <button class="btn btn-primary" :disabled="!poolIds.length" @click="start">开始刷题 →</button>
        </div>
      </section>

      <details class="algo card">
        <summary>完成度是怎么算的？</summary>
        <div class="algo-b">
          <p>每题有一个 0–2 的掌握分 <code>s</code>。官方按最近 10 次作答做指数加权，越近的一次权重越大（50%、25%、12.5%……），写成递推就是「新结果占一半」：</p>
          <ul>
            <li>答对：<code>s ← s + (2 − s) / 2</code>，即 1 → 1.5 → 1.75 → 1.875…，约连续答对 10 次才逼近满分。</li>
            <li>答错：<code>s ← max(0, s − 0.5)</code>。严格指数加权会把分数腰斩，官方实测是温和回退，此处按实测序列校准。</li>
            <li>完成度 <code>= 四舍五入(100 × Σs / (2 × 题数))</code>，分组读数按组内题数加权；未作答的题记 0 分。</li>
            <li>已做占比 <code>= 四舍五入(100 × 去重作答数 / 题数)</code>，上限 100%。</li>
          </ul>
          <p class="algo-n">口径用官方刷题程序实测的 T3 章节 120 次作答序列核对：第 100 次 A/B/C = 79/75/80、总 78，末态 71/76/80，四个分组读数全部复现。</p>
          <p class="algo-n">刷题模式、模拟考试、错题本、收藏夹里的作答全部计入同一套完成度；只读浏览、主动「显示答案」、刷题跳过、模考未作答不计分。</p>
        </div>
      </details>
    </template>

    <!-- ────────────── 答题 ────────────── -->
    <template v-else>
      <section class="card prog">
        <div class="pg-top">
          <div class="pg-title">
            <h1>{{ scopeLabel }}</h1>
            <span class="pg-sub">{{ poolIds.length }} 题 · 刷题模式</span>
          </div>
          <div class="pg-act">
            <button class="btn btn-sm" @click="backToSetup">切换范围</button>
            <button class="btn btn-sm" :class="{ danger: confirmReset }" @click="doReset">
              {{ confirmReset ? '确认重置本范围进度' : '重置进度' }}
            </button>
          </div>
        </div>

        <div class="pg-metrics">
          <div class="metric">
            <b>{{ stat.aptitude }}<i>%</i></b><span>完成度</span>
            <div class="m-bar"><i :style="{ width: stat.aptitude + '%' }"></i></div>
          </div>
          <div class="metric">
            <b>{{ stat.seenPct }}<i>%</i></b><span>已做题目占比</span>
            <div class="m-bar seen"><i :style="{ width: stat.seenPct + '%' }"></i></div>
          </div>
          <div class="sess">
            <div><b>{{ session.done }}</b><span>本轮作答</span></div>
            <div><b>{{ session.ok }}</b><span>答对</span></div>
            <div><b>{{ sessionRate }}%</b><span>正确率</span></div>
            <div v-if="session.skipped"><b>{{ session.skipped }}</b><span>跳过</span></div>
          </div>
        </div>

        <div v-if="groupStats.length > 1" class="groups">
          <span class="g-label">分组读数</span>
          <span v-for="g in groupStats" :key="g.code" class="g" :title="`${g.done}/${g.n} 题已做`">
            {{ g.code }} <b>{{ g.aptitude }}%</b>
          </span>
        </div>

        <p v-if="resetNote" class="note ok-note">本范围进度已重置，历史答题记录仍保留在错题本与学习统计中。</p>
        <p v-else-if="confirmReset" class="note warn-note">再点一次确认：将清空本范围的刷题掌握分（不影响其它范围与历史记录）。</p>
      </section>

      <div v-if="stat.aptitude >= 100" class="done card">
        <b>🎉 本范围已刷满 100%</b>
        <span>每题都连续答对约十次即可拿满。可以切换范围，或继续练习保持手感。</span>
      </div>

      <div v-if="!cur" class="loading">该范围暂无题目，请切换范围。</div>
      <QuestionCard
        v-else
        :key="cur.id"
        :q="cur" mode="browse" :picked="picked" :revealed="revealed" keys
        @answer="onAnswer"
      />

      <div class="act-bar card">
        <div class="act-l">
          <span v-if="!answered" class="act-hint">数字键 <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> 选择 A/B/C/D · 卡片内可「显示答案」（不计分）</span>
          <span v-else-if="picked" class="act-hint">已记录本题作答，完成度已更新</span>
          <span v-else class="act-hint">查看答案不计分，也不计入已做占比</span>
        </div>
        <label class="auto">
          <input type="checkbox" :checked="drill.autoNext" @change="drill.setAutoNext($event.target.checked)">
          自动下一题
        </label>
        <button v-if="!answered" class="btn btn-sm" @click="skip">跳过这题</button>
        <button v-else class="btn btn-sm btn-primary" @click="goNext">下一题 →</button>
      </div>
      <p class="tip"><kbd>→</kbd> 换下一题 · <kbd>Enter</kbd> 显示/隐藏中文译文 · 选项顺序与 FCC 官方题库一致，从不打乱</p>

      <details class="algo card">
        <summary>完成度是怎么算的？</summary>
        <div class="algo-b">
          <ul>
            <li>答对：<code>s ← s + (2 − s) / 2</code>；答错：<code>s ← max(0, s − 0.5)</code>，<code>s ∈ [0, 2]</code>。</li>
            <li>完成度 <code>= 四舍五入(100 × Σs / (2 × 题数))</code>；已做占比 <code>= 四舍五入(100 × 去重作答数 / 题数)</code>。</li>
            <li>新题优先出现；全部见过之后，按缺失分 <code>2 − s</code> 加权回炉，越不熟越常出现。</li>
          </ul>
          <p class="algo-n">采用官方最近 10 次作答的指数加权骨架（50%、25%、12.5%…），答错侧按实测序列做温和校准。</p>
          <p class="algo-n">模拟考试、错题本、收藏夹的作答同样计入完成度；只读浏览与「显示答案」不计分。</p>
        </div>
      </details>
    </template>
  </div>
</template>

<style scoped>
.wrap { max-width: 940px; margin: 0 auto; padding: 22px 20px 60px; }
.crumb { font-size: 13px; color: var(--text-3); margin-bottom: 14px; }
.crumb a:hover { color: var(--tech); }
.sep { margin: 0 7px; opacity: .5; }
.head { margin-bottom: 18px; }
h1 { font-size: 24px; }
.sub { color: var(--text-2); font-size: 14px; margin-top: 6px; line-height: 1.7; max-width: 720px; }
.loading { padding: 56px; text-align: center; color: var(--text-3); }

/* ---- 选范围 ---- */
.lv-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
.lv-tab {
  text-align: left; padding: 12px 15px; border-radius: var(--r);
  border: 1px solid var(--line); background: var(--surface); border-top: 3px solid var(--c);
  transition: .15s;
}
.lv-tab:hover { box-shadow: var(--sh-2); }
.lv-tab.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 7%, white); }
.lv-tab b { display: block; font-size: 15px; }
.lv-tab span { font-size: 12.5px; color: var(--text-3); }

.picker { overflow: hidden; }
.pk-h {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
  padding: 13px 18px; border-bottom: 1px solid var(--line);
  font-size: 13.5px; font-weight: 600;
}
.pk-h em { font-style: normal; font-weight: 400; font-size: 12px; color: var(--text-3); }

.row {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 11px 18px; text-align: left; border-bottom: 1px dashed var(--line);
}
.row:hover { background: var(--surface-2); }
.row.on { background: var(--tech-soft); }
.radio {
  flex: none; width: 15px; height: 15px; border-radius: 50%;
  border: 1.5px solid var(--line-2); background: #fff;
}
.row.on .radio { border: 5px solid var(--tech); }
.r-name { flex: 1; min-width: 0; }
.r-name b { display: block; font-size: 14px; font-weight: 600; }
.r-name em { font-style: normal; font-size: 12px; color: var(--text-3); }
.r-num { flex: none; width: 62px; text-align: right; }
.r-num b { display: block; font-family: var(--mono); font-size: 14px; line-height: 1.2; }
.r-num em { font-style: normal; font-size: 11px; color: var(--text-3); }
.r-bar { flex: none; width: 74px; height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; }
.r-bar i { display: block; height: 100%; background: var(--tech); }

.blk-row { padding-right: 18px; }
.blk-main {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px;
  text-align: left; padding: 0;
}
.caret { display: inline-block; transition: .16s; color: var(--text-3); font-size: 13px; }
.caret.up { transform: rotate(90deg); }
.blk-pick {
  flex: none; font-size: 12px; color: var(--tech); padding: 3px 8px;
  border: 1px solid var(--line-2); border-radius: 7px; background: var(--surface);
}
.blk-pick:hover { border-color: var(--tech); background: var(--tech-soft); }
.secs { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; padding: 10px 18px 14px 44px; background: var(--surface-2); border-bottom: 1px dashed var(--line); }
.sec { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; text-align: left; padding: 8px 11px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); }
.sec:hover { border-color: var(--tech); }
.sec.on { border-color: var(--tech); background: var(--tech-soft); }
.s-code { font-family: var(--mono); font-size: 13px; font-weight: 600; }
.s-n, .s-pct { font-size: 11.5px; color: var(--text-3); }
.s-pct b { font-family: var(--mono); color: var(--tech); }

.pk-f { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 18px; }
.chosen { font-size: 13px; color: var(--text-3); }
.chosen b { color: var(--text); }
.pk-f .btn { margin-left: auto; }

/* ---- 进度条 ---- */
.prog { padding: 16px 20px 14px; margin-bottom: 14px; }
.pg-top { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
.pg-title { flex: 1; min-width: 220px; }
.pg-title h1 { font-size: 19px; }
.pg-sub { font-size: 12.5px; color: var(--text-3); }
.pg-act { display: flex; gap: 8px; }
.pg-act .danger { color: var(--err); border-color: var(--err); background: var(--err-soft); }

.pg-metrics { display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap; margin-top: 16px; }
.metric { min-width: 132px; }
.metric > b { display: block; font-family: var(--mono); font-size: 30px; line-height: 1.1; color: var(--tech); }
.metric > b i { font-style: normal; font-size: 16px; margin-left: 2px; }
.metric > span { font-size: 12px; color: var(--text-3); }
.m-bar { height: 6px; border-radius: 4px; background: var(--line); overflow: hidden; margin-top: 7px; }
.m-bar i { display: block; height: 100%; background: var(--tech); transition: width .3s; }
.m-bar.seen i { background: var(--gen); }
.metric:has(.m-bar.seen) > b { color: var(--gen); }
.sess { display: flex; gap: 18px; margin-left: auto; flex-wrap: wrap; }
.sess div { text-align: center; }
.sess b { display: block; font-family: var(--mono); font-size: 18px; line-height: 1.2; }
.sess span { font-size: 11.5px; color: var(--text-3); }

.groups { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--line); }
.g-label { font-size: 12px; color: var(--text-3); margin-right: 2px; }
.g { font-size: 12px; font-family: var(--mono); padding: 2px 9px; border-radius: 7px; background: var(--surface-sunken); color: var(--text-2); }
.g b { color: var(--tech); }
.note { font-size: 12.5px; margin-top: 10px; }
.ok-note { color: var(--ok); }
.warn-note { color: var(--err); }

.done { padding: 13px 18px; margin-bottom: 14px; border-left: 3px solid var(--ok); background: var(--ok-soft); display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.done b { color: var(--ok); font-size: 14.5px; }
.done span { font-size: 12.5px; color: var(--text-2); }

/* ---- 操作条 ---- */
.act-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 11px 16px; margin-top: 14px; }
.act-l { flex: 1; min-width: 200px; }
.act-hint { font-size: 12.5px; color: var(--text-3); }
.auto { display: flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--text-2); white-space: nowrap; cursor: pointer; }
.auto input { accent-color: var(--tech); }
kbd { display: inline-block; padding: 1px 5px; margin: 0 2px; border: 1px solid var(--line-2); border-radius: 5px; background: var(--surface); font-family: var(--mono); font-size: 11px; }
.tip { margin-top: 10px; font-size: 12px; color: var(--text-3); }

/* ---- 算法说明 ---- */
.algo { margin-top: 18px; padding: 13px 18px; font-size: 13px; }
.algo summary { cursor: pointer; font-weight: 600; color: var(--text-2); user-select: none; }
.algo summary:hover { color: var(--tech); }
.algo-b { margin-top: 10px; color: var(--text-2); line-height: 1.75; }
.algo-b p { margin-bottom: 8px; }
.algo-b ul { margin: 0 0 8px; padding-left: 20px; }
.algo-b li { margin-bottom: 4px; }
.algo-b code { font-family: var(--mono); font-size: 12px; background: var(--surface-sunken); padding: 1px 5px; border-radius: 5px; }
.algo-n { font-size: 12px; color: var(--text-3); border-top: 1px dashed var(--line); padding-top: 8px; }

@media (max-width: 700px) {
  .wrap { padding: 18px 12px 44px; }
  .lv-tabs { grid-template-columns: 1fr; gap: 7px; }
  .lv-tab { display: flex; align-items: baseline; gap: 9px; padding: 9px 13px; }
  .r-bar { display: none; }
  .r-num { width: 52px; }
  .row { gap: 8px; padding: 10px 12px; }
  .secs { padding-left: 16px; grid-template-columns: 1fr 1fr; }
  .pg-metrics { gap: 16px; }
  .sess { margin-left: 0; width: 100%; gap: 14px; }
  .blk-pick { display: none; }
}
</style>
