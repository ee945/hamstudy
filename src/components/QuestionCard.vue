<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useUI } from '../stores/ui'
import { useStudy } from '../stores/study'
import { useUser } from '../stores/user'
import { onKey, digitIndex } from '../lib/keys'

const props = defineProps({
  q: { type: Object, required: true },
  idx: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  /** browse=刷题即时反馈 / exam=考试中只记录不反馈 / review=考后回顾 /
   *  read=浏览阅读（只读，默认亮出正确答案与解析） */
  mode: { type: String, default: 'browse' },
  picked: { type: String, default: '' },
  /** 刷题时主动点了「显示答案」：亮答案但不判分、不计入作答 */
  revealed: { type: Boolean, default: false },
  /** 页面是否只显示本卡片。是则启用数字键 1-4 选答案，多题列表页不要开 */
  keys: { type: Boolean, default: false },
  /** 模态弹窗挡住题目时暂停数字键作答，避免背后偷偷答题导致提示与实际不符 */
  paused: { type: Boolean, default: false },
})
const emit = defineEmits(['answer', 'next'])

const ui = useUI()
const st = useStudy()
const user = useUser()
const zoom = ref(false)
const copied = ref(false)
// 修订入口给管理员与编辑员。编辑员的改动要过审核，管理员直接生效；
// 普通用户与游客看不到，避免给出点了也用不了的入口
const canEdit = computed(() => user.isAdmin || user.isEditor)

const LETTERS = ['A', 'B', 'C', 'D']
// 英文恒显示（真实考试为英文出题），中文为可选辅助层
const showZh = computed(() => ui.showZh)

const readMode = computed(() => props.mode === 'read')
/** 浏览模式与「显示答案」都直接展开结果区，但两者都不算真正作答过 */
const hasAnswered = computed(() => !!props.picked || props.revealed || readMode.value)
const reallyPicked = computed(() => !!props.picked)
const isRight = computed(() => props.picked === props.q.ans)
const faved = computed(() => st.isFav(props.q.id))
/** 数字键是否真正可用：单卡 + 非回顾/非只读模式；考试中允许改答案，其余模式作答后即锁 */
const keysLive = computed(
  () => props.keys && !props.paused && props.mode !== 'review' && !readMode.value &&
    !props.revealed && (props.mode === 'exam' || !hasAnswered.value)
)

const accent = computed(() => {
  const lv = props.q.level
  return lv === '技术级' ? 'var(--tech)' : lv === '通用级' ? 'var(--gen)' : 'var(--extra)'
})

function pick(l) {
  // 回顾 / 浏览阅读 / 已显示答案后一律只读，不再把点击当作答
  if (props.mode === 'review' || readMode.value || props.revealed) return
  // 考试中允许改答案（交卷前不看结果），其余模式作答即锁
  if (hasAnswered.value && props.mode !== 'exam') return
  emit('answer', { letter: l, ok: l === props.q.ans, q: props.q })
}

// 数字键 1-4 → A-D。仅在「页面只有这一道题」时注册
// 刻意不绑定字母 A-D：浏览器与插件常占用单字母键，数字键冲突面最小
// digitIndex() 同时认主键盘顶排与小键盘，并兼容 NumLock 关闭 / 非 US 布局
let offKey = null
onMounted(() => {
  if (!props.keys) return
  offKey = onKey((e) => {
    if (!keysLive.value) return
    const n = digitIndex(e)
    if (n < 0) return
    e.preventDefault()
    pick(LETTERS[n])
  })
})
onUnmounted(() => offKey && offKey())

async function copyLink() {
  const url = `${location.origin}${location.pathname}#${props.q.id}`
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch {}
}

async function toggleFav() {
  await st.toggleFav({ id: props.q.id, level: props.q.level, sec: props.q.sec })
}

function optState(l) {
  // 浏览阅读 / 主动显示答案：只把正确项标出来，其余保持正常可读，不判对错
  if (readMode.value || (props.revealed && !props.picked)) {
    return l === props.q.ans ? 'right' : ''
  }
  if (!hasAnswered.value) return ''
  // 考试进行中：只标出「你选了哪个」，绝不透露对错
  if (props.mode === 'exam') return l === props.picked ? 'seled' : ''
  if (l === props.q.ans) return 'right'
  if (l === props.picked) return 'wrong'
  return 'dim'
}
</script>

<template>
  <article class="qc" :id="q.id" :style="{ '--accent': accent }">
    <!-- 头部 -->
    <div class="q-top">
      <span class="qid">#{{ q.id }}</span>
      <span class="tag">{{ q.sec }}</span>
      <span class="diff" :class="'lv' + Math.ceil(q.diff / 2)" :title="`难度 ${q.diff}/10`">
        <i v-for="n in 10" :key="n" :class="{ on: n <= q.diff }"></i>
      </span>
      <span v-if="q.img" class="tag FigTag">配图</span>

      <span class="grow"></span>
      <span v-if="total" class="pos">{{ idx + 1 }} / {{ total }}</span>
      <RouterLink
        v-if="(mode === 'browse' || mode === 'read') && canEdit"
        :to="`/edits?q=${q.id}`" class="ibtn" title="修订此题的译文 / 要点 / 解析"
      >
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M13.8 3.6l2.6 2.6L7.6 15l-3.4.8L4.8 12.4z"/>
          <path d="M11.9 5.5l2.6 2.6"/>
        </svg>
      </RouterLink>
      <button class="ibtn fav" :class="{ on: faved }" @click="toggleFav" :title="faved ? '取消收藏' : '收藏此题'">
        <svg width="15" height="15" viewBox="0 0 20 20" :fill="faved ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5">
          <path d="M10 3.2l2.2 4.5 4.9.7-3.6 3.5.9 4.9L10 14.4 5.6 16.8l.9-4.9L3 8.4l4.9-.7z"/>
        </svg>
      </button>
      <button class="ibtn" @click="copyLink" title="复制本题链接">
        <svg v-if="!copied" width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M8.5 11.5a3.5 3.5 0 005 0l2.5-2.5a3.5 3.5 0 00-5-5L9.7 5.3"/>
          <path d="M11.5 8.5a3.5 3.5 0 00-5 0L4 11a3.5 3.5 0 005 5l1.3-1.3"/>
        </svg>
        <span v-else class="ok-tick">✓</span>
      </button>
    </div>

    <!-- 题干：真实考试为英文出题，英文作主行大字号，中文降一级作辅助参考 -->
    <div class="stem">
      <p class="en">{{ q.qEn }}</p>
      <p v-if="showZh" class="zh">{{ q.qZh }}</p>
    </div>

    <!-- 配图 -->
    <figure v-if="q.img" class="fig" @click="zoom = !zoom">
      <img :src="'/' + q.img" :alt="q.id + ' 电路图'" loading="lazy">
      <figcaption>{{ q.id }} 电路图 · 点击放大</figcaption>
    </figure>
    <div v-if="zoom" class="lightbox" @click="zoom = false">
      <img :src="'/' + q.img" :alt="q.id">
    </div>

    <!-- 选项 -->
    <ul class="opts">
      <li
        v-for="(l, i) in LETTERS" :key="l"
        class="opt" :class="[optState(l), { pickable: !hasAnswered && mode !== 'review' }]"
        @click="pick(l)"
      >
        <span class="ltr">{{ l }}</span>
        <div class="body">
          <div class="en">{{ q.optEn[i] }}</div>
          <div v-if="showZh" class="zh">{{ q.optZh[i] }}</div>
        </div>
        <kbd v-if="keysLive" class="kbd-hint" aria-hidden="true">{{ i + 1 }}</kbd>
        <svg v-if="optState(l) === 'right'" class="mark" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4.5 10.5 8 14l7.5-8"/>
        </svg>
        <svg v-else-if="optState(l) === 'wrong'" class="mark" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>
        </svg>
      </li>
    </ul>

    <!-- 考试中只做「已选」的确认，不判分；交卷后统一出结果 -->
    <div v-if="hasAnswered && mode === 'exam'" class="picked-note fade-up">
      已选择 <b>{{ picked }}</b> · 交卷后统一判分，可随时回来改
    </div>

    <!-- 结果区 -->
    <div v-else-if="hasAnswered" class="result fade-up">
      <!-- 真正选过答案才判对错；浏览模式与「显示答案」只呈现参考答案，不计分 -->
      <div v-if="reallyPicked" class="verdict" :class="isRight ? 'ok' : 'no'">
        <span class="v-badge">{{ isRight ? '回答正确' : '回答错误' }}</span>
        <span v-if="!isRight" class="v-ans">正确答案 <b>{{ q.ans }}</b></span>
      </div>
      <div v-else class="verdict ref">
        <span class="v-badge">正确答案 <b>{{ q.ans }}</b></span>
        <span class="v-note">
          {{ readMode ? '浏览模式 · 仅供阅读学习，不计分' : '已查看答案 · 本题不计分' }}
        </span>
      </div>

      <div v-if="q.mnem" class="mnem">
        <span class="mnem-l">记忆要点</span>
        <span>{{ q.mnem }}</span>
      </div>

      <details v-if="ui.showExpl && q.expl" class="expl" :open="mode !== 'exam'">
        <summary>题目解析</summary>
        <p>{{ q.expl }}</p>
        <p v-if="q.rev" class="rev">{{ q.rev }}</p>
      </details>
    </div>

    <div v-else-if="mode === 'browse'" class="hint-row">
      <button class="btn btn-sm btn-ghost" @click="emit('answer', { letter: '', ok: null, q, reveal: true })">
        显示答案
      </button>
    </div>
  </article>
</template>

<style scoped>
.qc {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 20px 22px 22px;
  box-shadow: var(--sh-1);
  scroll-margin-top: 74px;
}
/* 极窄屏时题号 / 难度点 / 操作按钮放不下就换行，别把卡片撑出横向滚动条 */
.q-top { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; row-gap: 6px; margin-bottom: 12px; }
.grow { flex: 1; }
.pos { font-size: 12.5px; color: var(--text-3); font-family: var(--mono); }
.FigTag { background: var(--accent-soft); color: #a06a00; }

.ibtn {
  flex: none;
  width: 28px; height: 28px; border-radius: 7px;
  display: grid; place-items: center; color: var(--text-3);
}
.ibtn:hover { background: var(--surface-sunken); color: var(--text); }
.fav.on { color: var(--star); }
.ok-tick { color: var(--ok); font-size: 14px; }

/* 英文为主行（大字号、高对比），中文为辅行（小字号、降饱和度） */
.stem { margin-bottom: 15px; }
.stem .en {
  font-size: 17px; font-weight: 600; line-height: 1.6; color: var(--text);
  letter-spacing: .002em;
}
.stem .zh {
  font-size: 14px; line-height: 1.6; color: var(--text-2);
  margin-top: 6px; padding-left: 10px;
  border-left: 2px solid var(--line-2);
}

.fig { margin: 0 0 14px; text-align: center; cursor: zoom-in; }
.fig img {
  max-width: 100%; max-height: 260px; display: inline-block;
  background: #fbfcfd; border: 1px solid var(--line); border-radius: var(--r);
  padding: 10px;
}
.fig figcaption { font-size: 12px; color: var(--text-3); margin-top: 5px; }
.lightbox {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(16, 20, 26, .72);
  display: grid; place-items: center; padding: 40px; cursor: zoom-out;
}
.lightbox img { max-width: 92vw; max-height: 88vh; background: #fff; border-radius: 12px; padding: 16px; }

.opts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.opt {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 10px 13px; border-radius: var(--r);
  border: 1px solid var(--line); background: var(--surface-2);
  transition: .14s ease;
}
.opt.pickable { cursor: pointer; }
.opt.pickable:hover { border-color: var(--accent); background: #fff; }
.ltr {
  flex: none; width: 22px; height: 22px; border-radius: 6px;
  display: grid; place-items: center;
  font-family: var(--mono); font-size: 12.5px; font-weight: 600;
  background: var(--surface-sunken); color: var(--text-2);
  border: 1px solid var(--line);
  margin-top: 1px;
}
.body { flex: 1; min-width: 0; }

/* 数字键提示：只在本卡片独占页面时出现，避免用户不知道有快捷键 */
.kbd-hint {
  flex: none; align-self: center;
  min-width: 19px; height: 19px; padding: 0 4px;
  display: grid; place-items: center;
  font-family: var(--mono); font-size: 11px; line-height: 1;
  border-radius: 5px;
  border: 1px solid var(--line-2); background: var(--surface);
  color: var(--text-3);
  transition: .14s ease;
}
.opt.pickable:hover .kbd-hint {
  border-color: var(--accent); background: var(--accent-soft); color: #a06a00;
}
.mark ~ .kbd-hint, .opt.right .kbd-hint, .opt.wrong .kbd-hint { display: none; }
.body .en { font-size: 14.5px; font-weight: 550; line-height: 1.55; color: var(--text); }
.body .zh {
  font-size: 13px; line-height: 1.55; color: var(--text-2);
  margin-top: 3px; padding-left: 9px;
  border-left: 2px solid var(--line-2);
}
.mark { flex: none; margin-top: 3px; }

.opt.right { border-color: var(--ok); background: var(--ok-soft); }
.opt.right .ltr { background: var(--ok); color: #fff; border-color: var(--ok); }
.opt.right .mark { color: var(--ok); }
.opt.wrong { border-color: var(--err); background: var(--err-soft); }
.opt.wrong .ltr { background: var(--err); color: #fff; border-color: var(--err); }
.opt.wrong .mark { color: var(--err); }
.opt.dim { opacity: .5; }

/* 考试中「已选」：用中性的强调色，不带任何对错语义 */
.opt.seled { border-color: var(--accent); background: var(--accent-soft); }
.opt.seled .ltr { background: var(--accent); color: #fff; border-color: var(--accent); }

.picked-note {
  margin-top: 14px; padding: 9px 13px; border-radius: var(--r);
  border: 1px dashed var(--line-2); background: var(--surface-2);
  font-size: 13px; color: var(--text-2);
}
.picked-note b { font-family: var(--mono); color: var(--text); }

.result { margin-top: 15px; border-top: 1px dashed var(--line-2); padding-top: 14px; }
.verdict { display: flex; align-items: center; gap: 9px; margin-bottom: 11px; }
.v-badge {
  padding: 3px 10px; border-radius: 7px; font-size: 13px; font-weight: 600;
}
.verdict.ok .v-badge { background: var(--ok-soft); color: var(--ok); }
.verdict.no .v-badge { background: var(--err-soft); color: var(--err); }
.verdict.ref .v-badge { background: var(--gen-soft); color: var(--gen); }
.verdict.ref .v-badge b { font-family: var(--mono); font-size: 14px; }
.v-note { font-size: 12.5px; color: var(--text-3); }
.v-ans { font-size: 13px; color: var(--text-2); }
.v-ans b { color: var(--text); font-family: var(--mono); }

.mnem {
  display: flex; gap: 10px; align-items: baseline;
  background: var(--accent-soft); border-radius: var(--r);
  padding: 9px 13px; font-size: 14px; margin-bottom: 10px;
}
.mnem-l {
  flex: none; font-size: 12px; font-weight: 600; color: #a06a00;
  letter-spacing: .02em;
}

.expl { font-size: 14px; }
.expl summary {
  cursor: pointer; font-weight: 600; color: var(--text-2);
  padding: 4px 0; user-select: none;
}
.expl summary:hover { color: var(--text); }
.expl p { color: var(--text-2); line-height: 1.72; margin-top: 6px; }
.expl .rev { font-size: 12.5px; color: var(--text-3); border-top: 1px solid var(--line); padding-top: 6px; }

.hint-row { margin-top: 13px; display: flex; justify-content: flex-end; }
</style>
