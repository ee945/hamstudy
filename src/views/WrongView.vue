<script setup>
/**
 * 错题本练习：一次一题，作答后保留对错颜色与解析留在本页回看；
 * ← / → 循环翻页，整轮答完后再往右就清空作答、回到第一题重新刷。
 *
 * 这里曾有个隐蔽的 bug：st.wrongList 按「最近作答时间」倒序，每答一题
 * 顺序都会变；旧代码直接监听 qid 拼接串，于是每次作答都重载列表并把
 * picked 清空 —— 表现为不显示对错颜色、只有加分/退分提示、还能连续作答。
 * 现在改为监听「排序后的题号集合」，且本轮已答的题不因积满掌握分被抽走。
 */
import { computed, ref, watch, nextTick } from 'vue'
import { useBank } from '../stores/bank'
import { useStudy, WRONG_TARGET } from '../stores/study'
import { WRONG_MODE } from '../lib/drill'
import { usePracticeRound } from '../lib/practiceRound'
import QuestionCard from '../components/QuestionCard.vue'

const bank = useBank()
const st = useStudy()
const NEED = WRONG_TARGET

const qs = ref([])
const loading = ref(true)
let firstLoad = true
const filter = ref('')
const flash = ref('')
let flashTimer = null

/** qid -> 错题本掌握积分 */
const scoreMap = computed(() => st.wrongScore)
const scoreOf = (qid) => scoreMap.value.get(qid) || 0

const list = computed(() =>
  filter.value ? qs.value.filter((q) => q.level === filter.value) : qs.value
)
const counts = computed(() => {
  const m = {}
  for (const q of qs.value) m[q.level] = (m[q.level] || 0) + 1
  return m
})

function tip(msg) {
  flash.value = msg
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = ''), 2600)
}

const practice = usePracticeRound(list, {
  // 新一轮才把已掌握（积满 NEED 分）的题移出，本轮始终留着供检查
  onNewRound: async (n) => {
    await syncList(true)
    tip(`整轮完成，已回到第一题开始第 ${n} 轮`)
  },
})
const { i, cur, picked, revealed, round, doneCount } = practice

async function resolve(ids) {
  const out = []
  for (const id of ids) {
    const q = await bank.getQuestion(id)
    if (q) out.push(q)
  }
  return out
}

/**
 * rebuild=true：按当前错题本重建（进入页面 / 新一轮 / 手动刷新）。
 * 否则只把新出现的错题追加进来，不抽走本轮已答的题，颜色与位置都保住。
 */
async function syncList(rebuild = false) {
  if (firstLoad || rebuild) loading.value = true
  try {
    const wanted = st.wrongList.map((w) => w.qid)
    if (rebuild) {
      qs.value = await resolve(wanted)
      practice.keepAnchor(null)
    } else {
      const have = new Set(qs.value.map((q) => q.id))
      const extra = wanted.filter((id) => !have.has(id))
      if (extra.length) qs.value = [...qs.value, ...(await resolve(extra))]
    }
  } finally {
    firstLoad = false
    loading.value = false
  }
}

// 排序后再拼：题号集合不变（只是最近作答顺序变了）就不重载，
// 避免刚选完答案就被清掉。收藏夹 / 其它页面同步来的新错题仍会补进本轮。
watch(
  () => st.wrongList.map((w) => w.qid).sort().join(','),
  () => syncList(false),
  { immediate: true }
)

function setFilter(k) {
  const anchor = cur.value?.id
  filter.value = k
  nextTick(() => practice.keepAnchor(anchor))
}

function onAnswer({ letter, ok, q, reveal }) {
  if (reveal) {
    if (practice.done(q.id)) return
    practice.markReveal(q.id)
    tip('已查看答案 · 本题不计分')
    return
  }
  // 每题每轮只判一次：颜色与解析留在本页，不许再连点改答案
  if (practice.done(q.id)) return
  practice.markAnswer(q.id, letter)
  const before = scoreOf(q.id)
  st.record(q, letter === q.ans, WRONG_MODE)
  const after = scoreOf(q.id)
  if (after >= NEED) {
    tip(`答对了，已掌握 ${after}/${NEED} · 本轮结束后移出错题本 🎉`)
  } else if (ok) {
    tip(`答对了，掌握进度 ${after}/${NEED} · 完成度同步更新`)
  } else {
    tip(`答错了，掌握进度 ${before} → ${after}/${NEED} · 完成度同步回退`)
  }
}

function remove(q) {
  if (!q) return
  st.markCleared(q.id)
  const idx = qs.value.findIndex((x) => x.id === q.id)
  if (idx >= 0) qs.value.splice(idx, 1)
  practice.keepAnchor(q.id)
  tip('已手动移出错题本')
}

async function refresh() {
  await syncList(true)
  practice.clearAnswers()
  tip('错题列表已刷新')
}
</script>

<template>
  <div class="wrap">
    <div class="head">
      <div>
        <h1>错题本</h1>
        <p class="sub">
          共 {{ qs.length }} 道待清错题 · 答对 +1 / 答错 −1，积满 {{ NEED }} 次移出 ·
          作答同时计入全站完成度（与刷题、模考、收藏夹共用一套分数）
        </p>
      </div>
      <div class="filters">
        <button class="f" :class="{ on: !filter }" @click="setFilter('')">全部 {{ qs.length }}</button>
        <button v-for="(n, k) in counts" :key="k" class="f" :class="{ on: filter === k }" @click="setFilter(k)">
          {{ k }} {{ n }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="empty card">加载中…</div>

    <div v-else-if="!list.length" class="empty card">
      <p class="big">🎉</p>
      <p v-if="qs.length">当前筛选下没有错题</p>
      <p v-else>还没有错题记录。去<RouterLink to="/study">刷题模式</RouterLink>练几题吧。</p>
    </div>

    <template v-else>
      <div class="bar card">
        <span class="pos mono">{{ i + 1 }} / {{ list.length }}</span>
        <span class="rnd">第 {{ round }} 轮 · 本轮 {{ doneCount }}/{{ list.length }}</span>

        <span v-if="cur" class="prog" :title="`当前题掌握进度 ${scoreOf(cur.id)}/${NEED}`">
          <i v-for="n in NEED" :key="n" :class="{ on: n <= scoreOf(cur.id) }"></i>
          <em>{{ scoreOf(cur.id) }}/{{ NEED }}</em>
        </span>

        <div class="grow"></div>
        <span v-if="flash" class="flash">{{ flash }}</span>
        <button class="btn btn-sm" @click="practice.go(-1)">← 上一题</button>
        <button class="btn btn-sm" @click="practice.go(1)">下一题 →</button>
        <button class="btn btn-sm btn-ghost" @click="practice.restart()" title="清空本轮作答，从第一题重刷">重开一轮</button>
        <button class="btn btn-sm btn-ghost" @click="remove(cur)" title="跳过累积，直接标记已掌握">强制移出</button>
        <button class="btn btn-sm btn-ghost" @click="refresh" title="同步错题本最新列表">刷新</button>
      </div>

      <main class="stage">
        <QuestionCard
          v-if="cur" :key="cur.id" :q="cur" :idx="i" :total="list.length"
          mode="browse" :picked="picked[cur.id] || ''" :revealed="!!revealed[cur.id]"
          keys @answer="onAnswer"
        />
      </main>

      <p class="tip">
        <kbd>←</kbd> <kbd>→</kbd> 循环切换上一题 / 下一题 · 数字键 <kbd>1</kbd>–<kbd>4</kbd> 选择 A/B/C/D ·
        答完保留对错颜色与解析留在本页检查 · 整轮做完再往右会自动回到第一题重新刷
      </p>
    </template>
  </div>
</template>

<style scoped>
.wrap { max-width: 940px; margin: 0 auto; padding: 24px 20px 60px; }
.head { display: flex; align-items: flex-end; gap: 20px; flex-wrap: wrap; margin-bottom: 18px; }
h1 { font-size: 24px; }
.sub { color: var(--text-2); font-size: 14px; margin-top: 4px; line-height: 1.65; }
.filters { margin-left: auto; display: flex; gap: 7px; flex-wrap: wrap; }
.f {
  padding: 5px 11px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text-2);
}
.f.on { background: var(--text); color: #fff; border-color: var(--text); }

.bar { display: flex; align-items: center; gap: 9px; padding: 10px 16px; margin-bottom: 14px; flex-wrap: wrap; }
.grow { flex: 1; }
.pos { font-size: 13px; color: var(--text-2); }
.mono { font-family: var(--mono); }
.rnd { font-size: 12px; color: var(--text-3); font-family: var(--mono); }

/* 掌握进度：三格进度条 */
.prog { display: inline-flex; align-items: center; gap: 4px; }
.prog i {
  width: 16px; height: 6px; border-radius: 3px;
  background: var(--line-2); transition: .2s;
}
.prog i.on { background: var(--ok); }
.prog em {
  font-style: normal; font-family: var(--mono); font-size: 12px;
  color: var(--text-2); margin-left: 3px;
}

.flash {
  font-size: 12.5px; padding: 4px 10px; border-radius: 7px;
  background: var(--accent-soft, #fdf3e3); color: #a06a00;
}
.tip { margin-top: 12px; font-size: 12px; color: var(--text-3); line-height: 1.8; }
.tip kbd {
  display: inline-block; padding: 1px 5px; margin: 0 1px;
  border: 1px solid var(--line-2); border-radius: 5px;
  background: var(--surface); font-family: var(--mono); font-size: 11px;
}

.empty { padding: 60px 30px; text-align: center; color: var(--text-3); }
.empty .big { font-size: 34px; margin-bottom: 8px; }
.empty a { color: var(--tech); text-decoration: underline; }
</style>
