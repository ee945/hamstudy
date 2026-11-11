<script setup>
/**
 * 收藏夹练习：与错题本同一套「一轮练习」交互 —— 答完保留对错颜色与解析
 * 留在本页回看，← / → 循环翻页，整轮答完后再往右回到第一题重新刷。
 * 作答写进 hs_attempts（mode='fav'），与刷题、模考、错题本共用完成度。
 */
import { computed, ref, watch, nextTick } from 'vue'
import { useBank, slugOf } from '../stores/bank'
import { useStudy } from '../stores/study'
import { FAV_MODE } from '../lib/drill'
import { usePracticeRound } from '../lib/practiceRound'
import QuestionCard from '../components/QuestionCard.vue'

const bank = useBank()
const st = useStudy()

const qs = ref([])
const loading = ref(true)
let firstLoad = true
const filter = ref('')
const flash = ref('')
let flashTimer = null

const list = computed(() => (filter.value ? qs.value.filter((q) => q.level === filter.value) : qs.value))
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
  onNewRound: (n) => tip(`整轮完成，已回到第一题开始第 ${n} 轮`),
})
const { i, cur, picked, revealed, round, doneCount } = practice

/** 收藏集合变化时重建题目，但保留本轮作答与当前位置（颜色不会被清掉） */
async function syncList() {
  if (firstLoad) loading.value = true
  const anchor = cur.value?.id
  try {
    const out = []
    for (const f of st.favs) {
      const q = await bank.getQuestion(f.qid)
      if (q) out.push(q)
    }
    qs.value = out
    nextTick(() => practice.keepAnchor(anchor))
  } finally {
    firstLoad = false
    loading.value = false
  }
}
watch(() => st.favs.map((f) => f.qid).sort().join(','), syncList, { immediate: true })

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
  if (practice.done(q.id)) return
  practice.markAnswer(q.id, letter)
  st.record(q, letter === q.ans, FAV_MODE)
  tip(letter === q.ans ? '回答正确 · 完成度同步更新' : '回答错误 · 完成度同步回退')
}

async function unfav(q) {
  if (!q) return
  await st.toggleFav(q)
  tip('已取消收藏')
}
</script>

<template>
  <div class="wrap">
    <div class="head">
      <div>
        <h1>收藏夹</h1>
        <p class="sub">
          共 {{ qs.length }} 道收藏题目 · 作答同时计入全站完成度（与刷题、模考、错题本共用一套分数）
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
      <p class="big">☆</p>
      <p>还没有收藏题目。在题目卡片上点击星标即可收藏。</p>
    </div>

    <template v-else>
      <div class="bar card">
        <span class="pos mono">{{ i + 1 }} / {{ list.length }}</span>
        <span class="rnd">第 {{ round }} 轮 · 本轮 {{ doneCount }}/{{ list.length }}</span>
        <RouterLink v-if="cur" :to="`/l/${slugOf(cur.id)}/${cur.sec}#${cur.id}`" class="jump">在题库中打开</RouterLink>
        <div class="grow"></div>
        <span v-if="flash" class="flash">{{ flash }}</span>
        <button class="btn btn-sm" @click="practice.go(-1)">← 上一题</button>
        <button class="btn btn-sm" @click="practice.go(1)">下一题 →</button>
        <button class="btn btn-sm btn-ghost" @click="practice.restart()" title="清空本轮作答，从第一题重刷">重开一轮</button>
        <button class="btn btn-sm btn-ghost" @click="unfav(cur)">取消收藏</button>
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
.pos { font-size: 13px; color: var(--text-2); font-family: var(--mono); }
.rnd { font-size: 12px; color: var(--text-3); font-family: var(--mono); }
.jump { font-size: 12.5px; color: var(--gen); }
.jump:hover { text-decoration: underline; }
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
.empty .big { font-size: 30px; margin-bottom: 8px; }
</style>
