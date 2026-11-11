<script setup>
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBank } from '../stores/bank'
import QuestionCard from '../components/QuestionCard.vue'

const route = useRoute()
const router = useRouter()
const bank = useBank()

const slug = computed(() => route.params.slug)
const secCode = computed(() => (route.params.sec || '').toUpperCase())
const list = ref([])
const i = ref(0)
const loading = ref(true)

/* ---- 小节导航：宽屏双栏 / 窄屏抽屉 ----
   窄屏时侧栏是 position:fixed 的浮层，若默认展开会整片盖住题目。
   因此两套状态分开记：宽屏记「用户是否手动收起」，窄屏记「抽屉是否打开」，
   跨断点缩放时互不干扰，也不会在缩窄的一瞬间弹出遮住内容。
   必须声明在 load() / immediate watch 之前，否则首次加载会踩到 TDZ。 */
const NARROW = '(max-width: 900px)'
const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia(NARROW).matches)
const wideCollapsed = ref(false)
const drawerOpen = ref(false)
let mq = null
const sideVisible = computed(() => isNarrow.value ? drawerOpen.value : !wideCollapsed.value)
function closeSide() {
  if (isNarrow.value) drawerOpen.value = false
  else wideCollapsed.value = true
}
function openSide() {
  if (isNarrow.value) drawerOpen.value = true
  else wideCollapsed.value = false
}
function onBreakpoint(e) {
  isNarrow.value = e.matches
  if (e.matches) drawerOpen.value = false   // 缩到窄屏时不自动弹出抽屉
}

const info = computed(() => bank.levelBySlug(slug.value))
const cur = computed(() => list.value[i.value])
/** 排序后的相邻小节，用于连续刷题 */
const navSecs = computed(() => {
  const blocks = info.value?.blocks || []
  const flat = blocks.flatMap((b) => b.secs)
  return flat
})
const prevSec = computed(() => {
  const k = navSecs.value.findIndex((s) => s.code === secCode.value)
  return k > 0 ? navSecs.value[k - 1] : null
})
const nextSec = computed(() => {
  const k = navSecs.value.findIndex((s) => s.code === secCode.value)
  return k >= 0 && k < navSecs.value.length - 1 ? navSecs.value[k + 1] : null
})

async function load() {
  // 选完小节（或浏览器前进/后退）后自动收起窄屏抽屉，别让它继续盖住新页面
  drawerOpen.value = false
  loading.value = true
  i.value = 0
  if (!bank.meta) await bank.fetchMeta()
  await bank.loadLevel(slug.value)
  list.value = await bank.getSection(slug.value, secCode.value)
  loading.value = false
  const h = route.hash?.slice(1)
  if (h) {
    const k = list.value.findIndex((q) => q.id === h)
    if (k >= 0) i.value = k
  }
  await nextTick()
}

watch(() => [slug.value, secCode.value], load, { immediate: true })

function go(d) {
  const n = i.value + d
  if (n < 0) {
    if (prevSec.value) router.push(`/l/${slug.value}/${prevSec.value.code}`)
    return
  }
  if (n >= list.value.length) {
    if (nextSec.value) router.push(`/l/${slug.value}/${nextSec.value.code}`)
    else window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  i.value = n
  nextTick(() => {
    document.querySelector('.stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

// 本题只管翻页：作答交给 QuestionCard 的数字键 1-4
// 字母键一律不用（含原先的 a-d 作答与 j/k 翻页），避免与浏览器/插件快捷键冲突
function onKey(e) {
  if (e.key === 'Escape' && drawerOpen.value) { drawerOpen.value = false; return }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'ArrowRight') go(1)
  else if (e.key === 'ArrowLeft') go(-1)
}

onMounted(() => {
  mq = window.matchMedia(NARROW)
  isNarrow.value = mq.matches
  if (mq.addEventListener) mq.addEventListener('change', onBreakpoint)
  else mq.addListener(onBreakpoint)   // 老版 Safari
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  if (mq?.removeEventListener) mq.removeEventListener('change', onBreakpoint)
  else mq?.removeListener(onBreakpoint)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="wrap">
    <!-- 窄屏抽屉打开时，点空白处收起；放在 grid 之外，避免占掉一个列轨道 -->
    <div v-if="isNarrow && drawerOpen" class="mask" @click="drawerOpen = false"></div>
    <div class="layout" :class="{ 'no-side': !sideVisible }">
      <!-- 小节导航 -->
      <aside class="side" :class="{ hide: !sideVisible, drawer: isNarrow }">
        <div class="side-h">
          <RouterLink :to="`/l/${slug}`" class="back">← {{ info?.en }}</RouterLink>
          <button class="btn btn-sm btn-ghost" @click="closeSide" title="收起">×</button>
        </div>
        <div class="side-body">
          <template v-for="b in info?.blocks || []" :key="b.code">
            <div class="grp">{{ b.code }} · {{ b.name }}</div>
            <RouterLink
              v-for="s in b.secs" :key="s.code"
              :to="`/l/${slug}/${s.code}`" class="si"
              :class="{ on: s.code === secCode }"
              @click="isNarrow && (drawerOpen = false)"
            >
              <span>{{ s.code }}</span><em>{{ s.count }}</em>
            </RouterLink>
          </template>
        </div>
      </aside>

      <!-- 主区 -->
      <main class="stage">
        <div class="bar card">
          <div class="bar-l">
            <h2>{{ secCode }}</h2>
            <span class="read-tag">浏览模式</span>
            <span class="cnt">{{ list.length }} 题</span>
          </div>
          <div class="bar-r">
            <button v-if="!sideVisible" class="btn btn-sm side-toggle" @click="openSide">小节导航</button>
            <button class="btn btn-sm" :disabled="i === 0" @click="go(-1)">上一题</button>
            <button class="btn btn-sm" @click="go(1)">下一题</button>
          </div>
        </div>

        <!-- 浏览模式只用来读题：答案、记忆要点、解析默认展开，不作答也不计分 -->
        <div class="read-note">
          <span>浏览模式：默认显示正确答案与解析，仅供阅读学习，不记录练习进度。</span>
          <RouterLink to="/study">要计分练习，去刷题模式 →</RouterLink>
        </div>

        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="!list.length" class="loading">该小节暂无题目</div>

        <template v-else>
          <QuestionCard
            v-if="cur"
            :key="cur.id"
            :q="cur" :idx="i" :total="list.length" mode="read"
          />

          <div class="nav-row">
            <RouterLink v-if="prevSec" :to="`/l/${slug}/${prevSec.code}`" class="link-nav">← {{ prevSec.code }}</RouterLink>
            <span class="grow"></span>
            <RouterLink v-if="nextSec" :to="`/l/${slug}/${nextSec.code}`" class="link-nav">{{ nextSec.code }} →</RouterLink>
            <RouterLink v-else :to="`/l/${slug}`" class="link-nav done">完成该级别 →</RouterLink>
          </div>

          <!-- 题号跳转：只读浏览，不再标对错状态 -->
          <div class="thumbs">
            <button
              v-for="(q, k) in list" :key="q.id"
              class="th" :class="{ cur: k === i }"
              :title="q.id"
              @click="i = k"
            >{{ k + 1 }}</button>
          </div>
        </template>

        <p class="tip">
          快捷键：<kbd>←</kbd> <kbd>→</kbd> 切换上下题 ·
          <kbd>Enter</kbd> 显示/隐藏中文译文 ·
          选项顺序与 FCC 官方题库一致，从不打乱
        </p>
      </main>
    </div>
  </div>
</template>

<style scoped>
.wrap { max-width: 1220px; margin: 0 auto; padding: 20px 20px 60px; }
.layout { display: grid; grid-template-columns: 216px 1fr; gap: 20px; align-items: start; }
/* 收起边栏时必须同时把栅格切成单列。display:none 只是让 aside 退出布局，
   显式声明的 216px 列轨道依然存在，剩下唯一的 .stage 会被自动放置到第一列
   （216px 窄列）并跑到左边，看起来就像「缩到边栏里、无法全宽」。 */
.layout.no-side { grid-template-columns: 1fr; }

.side {
  position: sticky; top: 74px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-lg); max-height: calc(100vh - 100px); overflow: auto;
}
/* 无论宽窄，.hide 都必须真正把侧栏移出布局；窄屏下它还要撤掉 fixed 浮层 */
.side.hide { display: none; }
/* 窄屏抽屉的遮罩：放在 .layout 之外，不参与 grid 自动放置 */
.mask {
  position: fixed; inset: 0; z-index: 55;
  background: rgba(15, 23, 42, .28);
}
.side-h {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid var(--line);
}
.back { font-size: 13px; font-weight: 600; color: var(--text-2); }
.back:hover { color: var(--tech); }
.side-body { padding: 8px; }
.grp {
  font-size: 11.5px; color: var(--text-3); padding: 9px 8px 4px;
  font-weight: 600; letter-spacing: .02em;
}
.si {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 9px; border-radius: 7px; font-size: 13px; color: var(--text-2);
}
.si:hover { background: var(--surface-sunken); }
.si.on { background: var(--tech-soft); color: var(--tech); font-weight: 600; }
.si em { font-style: normal; font-size: 11.5px; font-family: var(--mono); opacity: .6; }

.stage { min-width: 0; }
.bar {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 12px 18px; margin-bottom: 14px;
}
.bar-l { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.bar-l h2 { font-size: 19px; font-family: var(--mono); letter-spacing: .02em; }
.read-tag {
  font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 6px;
  background: var(--gen-soft); color: var(--gen);
}
.cnt { font-size: 13px; color: var(--text-3); }
.read-note {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
  padding: 9px 14px; margin-bottom: 14px; border-radius: var(--r);
  border: 1px dashed var(--line-2); background: var(--surface-2);
  font-size: 12.5px; color: var(--text-2);
}
.read-note a { color: var(--tech); font-weight: 600; white-space: nowrap; }
.read-note a:hover { text-decoration: underline; }
.bar-r { margin-left: auto; display: flex; gap: 8px; }

.nav-row { display: flex; align-items: center; gap: 12px; margin: 18px 2px 14px; }
.grow { flex: 1; }
.link-nav { font-size: 13.5px; color: var(--text-2); }
.link-nav:hover { color: var(--tech); }
.link-nav.done { color: var(--tech); font-weight: 600; }

.thumbs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.th {
  width: 32px; height: 32px; border-radius: 8px; font-size: 12.5px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text-2);
  font-family: var(--mono); transition: .13s;
}
.th:hover { border-color: var(--text-3); }
.th.ok { background: var(--ok-soft); border-color: var(--ok); color: var(--ok); }
.th.no { background: var(--err-soft); border-color: var(--err); color: var(--err); }
.th.cur { outline: 2px solid var(--gen); outline-offset: 1px; font-weight: 700; }

.tip { margin-top: 16px; font-size: 12px; color: var(--text-3); }
kbd {
  display: inline-block; padding: 1px 6px; margin: 0 2px;
  border: 1px solid var(--line-2); border-radius: 5px;
  background: var(--surface); font-family: var(--mono); font-size: 11px;
}
.loading { padding: 60px; text-align: center; color: var(--text-3); }

/* 窄屏：题目区独占一行，小节导航改抽屉。
   抽屉默认收起（sideVisible 由 drawerOpen 决定），只有点「小节导航」才浮出，
   不会再出现「宽度一缩小，边栏放大盖住题目」。
   断点与脚本里的 NARROW 常量必须一致。 */
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .side.drawer {
    position: fixed; z-index: 60; left: 12px; right: 12px; top: 70px;
    max-height: 60vh; box-shadow: var(--sh-3); overscroll-behavior: contain;
  }
}
</style>
