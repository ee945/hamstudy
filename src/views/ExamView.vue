<script setup>
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBank, slugOf } from '../stores/bank'
import { useStudy } from '../stores/study'
import { EXAM_MODE, EXAM_BLANK_MODE } from '../lib/drill'
import QuestionCard from '../components/QuestionCard.vue'
import ExamResult from '../components/ExamResult.vue'

const route = useRoute()
const router = useRouter()
const bank = useBank()
const st = useStudy()

const slug = computed(() => route.params.slug)
const mode = computed(() => route.query.mode || 'random')
const info = computed(() => bank.levelBySlug(slug.value))

const stage = ref('loading')   // loading | running | result | error
const errMsg = ref('')
const list = ref([])
const i = ref(0)
const ans = ref({})            // qid -> letter
const remain = ref(0)
const startedAt = ref(0)
// 手动交卷时待确认的未作答题快照：非空即显示确认弹窗。
// 存 { no(第几题), qid, idx(list 下标) }，点击题号可直接跳过去作答。
const blankList = ref([])
const dlgEl = ref(null)
let timer = null

const total = computed(() => list.value.length)
const answered = computed(() => Object.keys(ans.value).length)
const cur = computed(() => list.value[i.value])

function shuffle(arr) {
  const a = [...arr]
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1))
    ;[a[k], a[j]] = [a[j], a[k]]
  }
  return a
}

async function prepare() {
  stage.value = 'loading'
  errMsg.value = ''
  blankList.value = []       // 换一套卷 / 换模式时，上一场的未作答弹窗不能残留
  clearInterval(timer)
  try {
    if (!bank.meta) await bank.fetchMeta()
    const ok = await bank.loadLevel(slug.value)
    const data = bank.loaded[slug.value]
    if (!ok || !data || !info.value) {
      errMsg.value = `找不到题库「${slug.value}」`
      stage.value = 'error'
      return
    }
    const all = data.qs
    const need = info.value.exam.questions
    let pool = []

    if (mode.value === 'wrong') {
      // 按题号首字母筛选本级别的错题，不读 w.level（老记录里它是空的，会导致抽不到）
      const wrongIds = new Set(st.wrongList.filter((w) => slugOf(w.qid) === slug.value).map((w) => w.qid))
      pool = shuffle(all.filter((q) => wrongIds.has(q.id)))
      const rest = shuffle(all.filter((q) => !wrongIds.has(q.id)))
      pool = [...pool, ...rest].slice(0, need)
    } else if (mode.value === 'new') {
      const seen = new Set(st.attempts.map((a) => a.qid))
      pool = shuffle(all.filter((q) => !seen.has(q.id)))
      const rest = shuffle(all.filter((q) => seen.has(q.id)))
      pool = [...pool, ...rest].slice(0, need)
    } else {
      pool = shuffle(all).slice(0, need)
    }

    if (!pool.length) {
      errMsg.value = '没有可用的题目'
      stage.value = 'error'
      return
    }

    list.value = pool
    ans.value = {}
    i.value = 0
    startedAt.value = Date.now()
    // 考试时长按级别配置在 meta.json 的 exam.minutes（T/G 60 分钟、E 75 分钟），
    // 不再按「题数 × 每题 75 秒」推算 —— 那样 T/G 只有 43.75 分钟、E 62.5 分钟。
    // 老数据没配 minutes 时兜底 60 分钟。
    const minutes = Number(info.value.exam.minutes) || 60
    remain.value = minutes * 60
    stage.value = 'running'
    timer = setInterval(() => {
      remain.value--
      if (remain.value <= 0) submit()
    }, 1000)
  } catch (e) {
    errMsg.value = String(e?.message || e)
    stage.value = 'error'
  }
}

watch(() => [slug.value, mode.value], prepare, { immediate: true })

/** ESC = 返回作答。弹窗期间倒计时照常走，时间到仍自动交卷 */
function onKeydown(e) {
  if (e.key === 'Escape' && blankList.value.length) {
    e.preventDefault()
    cancelSubmit()
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  clearInterval(timer)
  document.removeEventListener('keydown', onKeydown)
})

// 考试中只记录选择，不写学习流水：一来不泄露对错，二来改答案不会污染统计
function pick({ letter, q }) {
  const first = !ans.value[q.id]
  ans.value = { ...ans.value, [q.id]: letter }
  // 首次作答自动进入下一题；回头改答案时停在原地
  if (first && i.value < total.value - 1) setTimeout(() => go(1), 260)
}

function go(d) {
  const n = i.value + d
  if (n >= 0 && n < total.value) {
    i.value = n
    nextTick(() => document.querySelector('.stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
}

const mmss = computed(() => {
  const m = Math.floor(remain.value / 60), s = remain.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const result = ref(null)

/** 未作答题快照，按试卷顺序：{ no(第几题), qid, idx(list 下标) } */
function blankQuestions() {
  const out = []
  list.value.forEach((q, idx) => {
    if (!ans.value[q.id]) out.push({ no: idx + 1, qid: q.id, idx })
  })
  return out
}

/**
 * 手动交卷入口：有未作答题先弹确认，全部答完则直接交卷。
 * 倒计时归零不走这里 —— 它直接调 submit()，时间到已无作答机会，不能再拦一层弹窗。
 */
function requestSubmit() {
  if (stage.value !== 'running') return
  const blanks = blankQuestions()
  if (!blanks.length) return submit()
  blankList.value = blanks
  nextTick(() => dlgEl.value?.focus())
}

function closeBlank() {
  blankList.value = []
}

/** 返回作答：跳到第一道未作答题 */
function cancelSubmit() {
  const first = blankList.value[0]?.idx ?? i.value
  closeBlank()
  i.value = first
  nextTick(() => document.querySelector('.stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

/** 点弹窗里的题号：收起弹窗并跳到该题 */
function gotoBlank(idx) {
  closeBlank()
  i.value = idx
  nextTick(() => document.querySelector('.stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function confirmSubmit() {
  closeBlank()
  submit()
}

/** 交卷判分：只由 requestSubmit() 或倒计时归零调用 */
function submit() {
  if (stage.value !== 'running') return
  blankList.value = []          // 含时间到自动交卷，任何路径都要收起弹窗
  clearInterval(timer)
  const detail = list.value.map((q) => ({
    qid: q.id, chosen: ans.value[q.id] || '', ok: ans.value[q.id] === q.ans, sec: q.sec,
  }))
  const correct = detail.filter((d) => d.ok).length
  // 交卷时才把每道题计入学习流水（错题本/正确率都由此刻开始生效）。
  // 真正作过答的题计入完成度；未作答的仍按错题进错题本，但单独标记，
  // 免得把一道从没看过的题算成「已做」并白白扣完成度。
  st.recordMany(list.value.map((q) => ({
    q,
    ok: ans.value[q.id] === q.ans,
    mode: ans.value[q.id] ? EXAM_MODE : EXAM_BLANK_MODE,
  })))
  result.value = {
    correct,
    total: total.value,
    pass: info.value.exam.pass,
    passed: correct >= info.value.exam.pass,
    wrong: detail.filter((d) => !d.ok).length,
    blank: detail.filter((d) => !d.chosen).length,
    durationSec: Math.round((Date.now() - startedAt.value) / 1000),
    detail,
  }
  st.saveSession({
    level: info.value.key, total: total.value, correct,
    durationSec: result.value.durationSec, mode: `exam:${mode.value}`, detail,
  })
  stage.value = 'result'
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/** 答题卡只区分「已答 / 未答 / 当前」，绝不用颜色暗示对错 */
function cardState(q, k) {
  if (ans.value[q.id]) return k === i.value ? 'done cur' : 'done'
  return k === i.value ? 'cur' : ''
}

function backHome() {
  router.push('/')
}
</script>

<template>
  <div class="wrap">
    <!-- 考试中 -->
    <template v-if="stage === 'running'">
      <div class="bar card">
        <div class="b-l">
          <span class="lv">{{ info?.en }}</span>
          <span class="mono">{{ mmss }}</span>
        </div>
        <div class="b-m">
          <span>{{ answered }} / {{ total }} 已答</span>
          <span class="div"></span>
          <span>合格需答对 {{ info?.exam.pass }} 题</span>
          <span class="div"></span>
          <span>限时 {{ info?.exam.minutes }} 分钟</span>
        </div>
        <div class="b-r">
          <button class="btn btn-sm" :disabled="i === 0" @click="go(-1)">上一题</button>
          <button class="btn btn-sm" @click="go(1)">下一题</button>
          <button class="btn btn-sm btn-primary" @click="requestSubmit()">交卷</button>
        </div>
      </div>

      <div class="layout">
        <main class="stage">
          <QuestionCard
            v-if="cur" :key="cur.id" :q="cur" :idx="i" :total="total"
            mode="exam" :picked="ans[cur.id] || ''" keys
            :paused="blankList.length > 0" @answer="pick"
          />
        </main>

        <aside class="sheet card">
          <div class="sh-h">答题卡</div>
          <div class="grid">
            <button
              v-for="(q, k) in list" :key="q.id" class="th"
              :class="cardState(q, k)" @click="i = k"
            >{{ k + 1 }}</button>
          </div>
          <button class="btn btn-primary submit" @click="requestSubmit()">交卷判分</button>
          <p class="note">考试中不提示对错，答题卡只标记「已答」。<br>手动交卷会提示未作答题目；时间到自动交卷，未作答计为错误。</p>
        </aside>
      </div>

      <!-- 手动交卷的未作答确认。倒计时到点直接 submit()，不会走到这里 -->
      <div v-if="blankList.length" class="mask" @click.self="cancelSubmit()">
        <div
          ref="dlgEl" class="dlg card" tabindex="-1"
          role="dialog" aria-modal="true" aria-labelledby="blank-title"
        >
          <h3 id="blank-title">还有 {{ blankList.length }} 题未作答</h3>
          <p class="dlg-p">以下题目尚未选择答案，交卷后将计为错误。是否继续提交？</p>
          <div class="blank-grid">
            <button
              v-for="b in blankList" :key="b.qid" class="blank-chip"
              :title="`跳到第 ${b.no} 题作答`" @click="gotoBlank(b.idx)"
            ><b>{{ b.no }}</b><span>{{ b.qid }}</span></button>
          </div>
          <p class="dlg-tip">点击题号可直接跳到该题继续作答；也可按 ESC 或点击空白处返回。</p>
          <div class="dlg-acts">
            <button class="btn" @click="cancelSubmit()">返回作答</button>
            <button class="btn btn-primary" @click="confirmSubmit()">继续提交</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 结果：与历史模考回顾共用同一份成绩单组件 -->
    <ExamResult v-else-if="stage === 'result' && result" :result="result" />

    <!-- 组卷失败：把原因显式显示出来，避免又变成「点了没反应」 -->
    <div v-else-if="stage === 'error'" class="loading err">
      <p class="big">⚠️</p>
      <p>组卷失败：{{ errMsg }}</p>
      <div class="err-acts">
        <button class="btn btn-primary" @click="prepare()">重试</button>
        <button class="btn" @click="backHome()">返回首页</button>
      </div>
    </div>

    <div v-else class="loading">正在组卷…</div>
  </div>
</template>

<style scoped>
.wrap { max-width: 1180px; margin: 0 auto; padding: 18px 20px 60px; }

.bar { display: flex; align-items: center; gap: 16px; padding: 11px 18px; margin-bottom: 14px; flex-wrap: wrap; }
.b-l { display: flex; align-items: center; gap: 10px; }
.lv { font-weight: 600; font-size: 15px; }
.mono {
  font-family: var(--mono); font-size: 14px; padding: 2px 9px; border-radius: 7px;
  background: var(--surface-sunken); color: var(--text-2);
}
.b-m { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-2); }
.div { width: 1px; height: 12px; background: var(--line-2); }
.b-r { margin-left: auto; display: flex; gap: 8px; }

.layout { display: grid; grid-template-columns: 1fr 240px; gap: 16px; align-items: start; }
.stage { min-width: 0; }

.sheet { padding: 14px; position: sticky; top: 74px; }
.sh-h { font-size: 13px; font-weight: 600; color: var(--text-2); margin-bottom: 10px; }
.grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.th {
  min-width: 0;   /* 允许格子随容器收缩，否则极窄屏会撑出整页横向滚动条 */
  height: 30px; border-radius: 7px; font-size: 12.5px; font-family: var(--mono);
  border: 1px solid var(--line); background: var(--surface-2); color: var(--text-2);
}
.th.cur { outline: 2px solid var(--gen); font-weight: 700; }
/* 已答：中性填充，与对错无关 */
.th.done { background: var(--gen-soft); border-color: var(--gen); color: var(--gen); font-weight: 600; }
.submit { width: 100%; margin-top: 12px; }
.note { font-size: 11.5px; color: var(--text-3); margin-top: 8px; line-height: 1.55; }

.loading { padding: 70px; text-align: center; color: var(--text-3); }
.loading.err { padding: 60px 20px; }
.loading.err .big { font-size: 32px; margin-bottom: 10px; }
.err-acts { display: flex; gap: 9px; justify-content: center; margin-top: 18px; }

/* ── 未作答确认弹窗 ── */
.mask {
  position: fixed; inset: 0; z-index: 400;
  background: rgba(16, 20, 26, .62);
  display: grid; place-items: center; padding: 20px;
}
.dlg {
  width: min(540px, 100%); max-height: 86vh;
  display: flex; flex-direction: column;
  padding: 22px 24px; box-shadow: var(--sh-3);
}
.dlg:focus { outline: none; }
.dlg h3 { font-size: 17px; }
.dlg-p { font-size: 13.5px; color: var(--text-2); line-height: 1.6; margin: 9px 0 14px; }
.blank-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 7px; overflow-y: auto; min-height: 0; padding: 2px;
}
.blank-chip {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 7px 6px; border-radius: var(--r-sm);
  font-family: var(--mono); font-size: 12px;
  border: 1px solid var(--line); background: var(--surface-2); color: var(--text-2);
}
.blank-chip b { color: var(--warn); font-size: 13px; }
.blank-chip:hover { border-color: var(--warn); background: var(--surface-sunken); }
.dlg-tip { font-size: 11.5px; color: var(--text-3); margin: 11px 0 0; line-height: 1.55; }
.dlg-acts { display: flex; gap: 9px; justify-content: flex-end; margin-top: 18px; }

@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .sheet { position: static; }
  .grid { grid-template-columns: repeat(10, minmax(0, 1fr)); }
  .blank-grid { grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); }
}
/* 手机宽度：答题卡少列一些，别让两位数的题号被挤扁 */
@media (max-width: 420px) {
  .grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }
}
</style>
