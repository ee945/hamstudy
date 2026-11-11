<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBank, slugOf } from '../stores/bank'
import { useUI } from '../stores/ui'

const route = useRoute()
const router = useRouter()
const bank = useBank()
const ui = useUI()

const kw = ref(route.query.q || '')
const ready = ref(false)
const scope = ref('all')
const withImg = ref(false)
const maxDiff = ref(10)

watch(() => route.query.q, (v) => { kw.value = v || '' })

onMounted(async () => {
  await bank.ensureLoadedAll()
  ready.value = true
})

const SLUGKEY = { technician: '技术级', general: '通用级', extra: '业余特级' }

const hits = computed(() => {
  const k = kw.value.trim().toLowerCase()
  let pool = bank.allQuestions
  if (scope.value !== 'all') pool = pool.filter((q) => q.level === SLUGKEY[scope.value])
  if (withImg.value) pool = pool.filter((q) => q.img)
  if (!k) return pool.slice(0, 60)
  return pool
    .filter((q) =>
      q.id.toLowerCase().includes(k) ||
      q.sec.toLowerCase().includes(k) ||
      (q.qZh || '').toLowerCase().includes(k) ||
      (q.qEn || '').toLowerCase().includes(k) ||
      q.optZh.some((o) => (o || '').toLowerCase().includes(k)) ||
      q.optEn.some((o) => (o || '').toLowerCase().includes(k))
    )
    .slice(0, 120)
    .filter((q) => q.diff <= maxDiff.value)
})

function submit() {
  router.replace({ name: 'search', query: { q: kw.value } })
}

function hl(text, k) {
  if (!k) return text
  const i = text.toLowerCase().indexOf(k)
  if (i < 0) return text
  return text.slice(0, i) + '⟪' + text.slice(i, i + k.length) + '⟫' + text.slice(i + k.length)
}
</script>

<template>
  <div class="wrap">
    <h1>搜索</h1>
    <form class="boxx card" @submit.prevent="submit">
      <input v-model="kw" placeholder="输入题号（如 T1A01）或关键词（如 驻波、SWR、transmitter）">
      <button class="btn btn-primary" type="submit">搜索</button>
    </form>

    <div class="filters">
      <button class="f" :class="{ on: scope === 'all' }" @click="scope = 'all'">全部</button>
      <button class="f" :class="{ on: scope === 'technician' }" @click="scope = 'technician'">技术级</button>
      <button class="f" :class="{ on: scope === 'general' }" @click="scope = 'general'">通用级</button>
      <button class="f" :class="{ on: scope === 'extra' }" @click="scope = 'extra'">业余特级</button>
      <span class="sp"></span>
      <label class="chk"><input type="checkbox" v-model="withImg"> 仅带配图</label>
      <label class="rng">难度 ≤ <b>{{ maxDiff }}</b><input type="range" min="1" max="10" v-model="maxDiff"></label>
    </div>

    <div v-if="!ready" class="empty card">正在载入题库…</div>
    <div v-else class="count">命中 {{ hits.length }} 题<span v-if="hits.length === 120">（仅显示前 120 条，请细化关键词）</span></div>

    <ul class="res">
      <li v-for="q in hits" :key="q.id" class="r card">
        <div class="r-h">
          <!-- 级别由题号首字母推出，不读 q.level：那个字段历史上缺过，
               一旦为空这里的三元就会落到 extra，T/G 的题点开全是空小节 -->
          <RouterLink :to="`/l/${slugOf(q.id)}/${q.sec}#${q.id}`" class="rid">#{{ q.id }}</RouterLink>
          <span class="tag">{{ q.sec }}</span>
          <span class="diff" :title="`难度 ${q.diff}/10`">
            <i v-for="n in 10" :key="n" :class="{ on: n <= q.diff }"></i>
          </span>
          <span v-if="q.img" class="tag imgtag">配图</span>
          <span class="grow"></span>
          <span class="ans">答案 <b>{{ q.ans }}</b></span>
        </div>
        <p class="r-en">{{ q.qEn }}</p>
        <p v-if="ui.showZh" class="r-zh">{{ q.qZh }}</p>
      </li>
    </ul>

    <div v-if="ready && !hits.length" class="empty card">没有匹配的题目</div>
  </div>
</template>

<style scoped>
.wrap { max-width: 940px; margin: 0 auto; padding: 24px 20px 60px; }
h1 { font-size: 24px; margin-bottom: 14px; }

.boxx { display: flex; gap: 9px; padding: 10px; margin-bottom: 14px; }
.boxx input {
  flex: 1; border: none; outline: none; background: none;
  padding: 0 10px; font-size: 15px;
}
.boxx input::placeholder { color: var(--text-3); }

.filters { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 14px; }
.sp { flex: 1; }
.f {
  padding: 5px 11px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text-2);
}
.f.on { background: var(--text); color: #fff; border-color: var(--text); }
.chk, .rng { font-size: 13px; color: var(--text-2); display: flex; align-items: center; gap: 6px; }
.rng b { font-family: var(--mono); color: var(--text); }
.rng input { width: 88px; }

.count { font-size: 13px; color: var(--text-3); margin-bottom: 10px; }
.count span { color: var(--warn); }

.res { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.r { padding: 14px 17px; }
.r-h { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; }
.grow { flex: 1; }
.rid { font-family: var(--mono); font-size: 13.5px; font-weight: 600; color: var(--gen); }
.rid:hover { text-decoration: underline; }
.imgtag { background: var(--accent-soft); color: #a06a00; }
.diff { display: inline-flex; gap: 3px; }
.diff i { width: 5px; height: 5px; border-radius: 50%; background: var(--line-2); }
.diff i.on { background: var(--star); }
.ans { font-size: 12.5px; color: var(--text-3); }
.ans b { color: var(--text); font-family: var(--mono); }
/* 与题目卡片一致：英文为主，中文为辅 */
.r-en { font-size: 15px; font-weight: 550; line-height: 1.6; color: var(--text); }
.r-zh {
  font-size: 13.5px; line-height: 1.6; color: var(--text-2);
  margin-top: 3px; padding-left: 9px; border-left: 2px solid var(--line-2);
}

.empty { padding: 50px; text-align: center; color: var(--text-3); }
</style>
