<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUser } from './stores/user'
import { useStudy } from './stores/study'
import { useDrill } from './stores/drill'
import { useUI } from './stores/ui'
import { onKey, enterIsNative } from './lib/keys'
import { useBank } from './stores/bank'
import { useEdits } from './stores/edits'
import { usePending } from './stores/pending'
import UserAvatar from './components/UserAvatar.vue'

const route = useRoute()
const router = useRouter()
const user = useUser()
const study = useStudy()
const drill = useDrill()
const ui = useUI()
const bank = useBank()
const edits = useEdits()
const pending = usePending()

const navs = [
  { to: '/', label: '首页', match: (p) => p === '/' },
  { to: '/study', label: '刷题模式', match: (p) => p.startsWith('/study') },
  { to: '/exam', label: '模拟考试', match: (p) => p.startsWith('/exam') },
  { to: '/wrong', label: '错题本', match: (p) => p === '/wrong' },
  { to: '/fav', label: '收藏夹', match: (p) => p === '/fav' },
  { to: '/progress', label: '进度', match: (p) => p === '/progress' },
]

const q = ref('')

// 头像菜单
const menuOpen = ref(false)
const menuRef = ref(null)
function onDocClick(e) {
  if (menuOpen.value && menuRef.value && !menuRef.value.contains(e.target)) menuOpen.value = false
}
function doLogout() {
  menuOpen.value = false
  user.logout()
  router.push('/')
}

// 登录态变化时切换数据源（学习流水与刷题偏好都要跟着换账号）
watch(
  () => user.user?.id || null,
  (uid) => {
    study.hydrate(uid)
    drill.hydrate(uid)
  }
)

// 题库修订：题库原文常常先于修订到位，取到后要重算已加载的题目
watch(
  () => edits.loaded,
  (v) => v && bank.reapplyAll()
)
// 自己刚保存的修订同样要立刻生效
watch(
  () => edits.savedAt,
  () => bank.reapplyAll()
)
// 管理员 / 编辑员登录后把待审数量取回来，菜单上给个角标
watch(
  () => user.canMaintain,
  (v) => v && pending.load(),
  { immediate: true }
)

// 一次性回执：右下角浮出，几秒后消失
const toast = ref(null)   // { text, kind: 'ok' | 'warn' }
let toastTimer = null
function showToast(text, kind = 'ok', ms = 6000) {
  toast.value = { text, kind }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), ms)
}

// 游客进度并入账号后给一次明确回执，否则用户以为数据丢了
watch(
  () => study.lastMerge?.ts || 0,
  () => {
    const m = study.lastMerge
    if (!m || !m.ts) return
    const parts = []
    if (m.attempts) parts.push(`${m.attempts} 次作答`)
    if (m.favs) parts.push(`${m.favs} 条收藏`)
    if (m.sessions) parts.push(`${m.sessions} 场模考`)
    showToast(
      parts.length ? `已把未登录期间的 ${parts.join('、')}并入你的账号` : '本机进度已并入你的账号'
    )
  }
)

// 登录态失效（token 过期 / 账号已不存在）时说清楚发生了什么，别让人反复重试。
// immediate：失效可能在 main.js 里就已判定，那时本组件的监听器还没注册
watch(
  () => user.sessionLost?.ts || 0,
  () => {
    const s = user.sessionLost
    if (!s?.ts) return
    showToast(s.reason || '登录状态已失效，请重新登录', 'warn', 8000)
  },
  { immediate: true }
)

// 回车键在站内无其它用途（已全项目核查），指派为「中文译文」开关
let offKey = null
// 切回前台标签页自动校验题库 JSON：管理员在「题库原文编辑」里改完存盘后，
// 长开的页面不必手动按 F5 就能看到新题面
function onVisible() {
  if (document.visibilityState === 'visible') bank.refreshAll()
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('visibilitychange', onVisible)
  edits.load()
  offKey = onKey((e) => {
    if (e.key !== 'Enter') return
    // 焦点在按钮/链接上时回车有原生语义（激活该控件），不抢
    if (enterIsNative(document.activeElement)) return
    e.preventDefault()
    ui.toggleZh()
  })
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('visibilitychange', onVisible)
  offKey && offKey()
})
</script>

<template>
  <div class="shell">
    <header class="hdr">
      <div class="hdr-in">
        <RouterLink to="/" class="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="2.6" fill="currentColor"/>
            <circle cx="16" cy="16" r="7.4" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/>
            <circle cx="16" cy="16" r="12.6" fill="none" stroke="currentColor" stroke-width="2" opacity=".28"/>
          </svg>
          <span class="brand-t">HamStudy</span>
        </RouterLink>

        <nav class="nav">
          <RouterLink
            v-for="n in navs" :key="n.to" :to="n.to"
            class="nav-i" :class="{ on: n.match(route.path) }">{{ n.label }}</RouterLink>
        </nav>

        <div class="hdr-r">
          <form class="search" @submit.prevent="router.push({ name: 'search', query: { q } })">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="7" cy="7" r="4.6"/><path d="M10.5 10.5 14 14"/>
            </svg>
            <input v-model="q" placeholder="搜索题号或关键词" aria-label="搜索">
          </form>

          <!-- 中文译文开关：默认关闭（灰色），开启后恢复饱和并加主色描边 -->
          <button
            class="btn btn-sm zh-btn"
            :class="{ on: ui.showZh, off: !ui.showZh }"
            :title="ui.showZh ? '关闭中文译文（回车 Enter）' : '显示中文译文（回车 Enter）'"
            :aria-pressed="ui.showZh"
            @click="ui.toggleZh()"
          >
            <span class="dot" aria-hidden="true"></span>
            中文
            <kbd>⏎</kbd>
          </button>

          <RouterLink v-if="!user.logged" to="/login" class="btn btn-sm btn-primary">登录</RouterLink>

          <div v-else class="user-menu" ref="menuRef">
            <button
              class="avatar-btn" :class="{ open: menuOpen }"
              :title="user.name" :aria-expanded="menuOpen" aria-haspopup="menu"
              @click="menuOpen = !menuOpen"
            >
              <UserAvatar :user="user.user" :size="32" />
            </button>

            <div v-if="menuOpen" class="menu card" role="menu">
              <div class="menu-h">
                <UserAvatar :user="user.user" :size="40" />
                <div class="menu-i">
                  <b class="menu-name">
                    {{ user.name }}
                    <span v-if="user.callsign" class="cs">{{ user.callsign }}</span>
                  </b>
                  <span>{{ user.user.email }}</span>
                </div>
              </div>
              <RouterLink to="/account" class="menu-a" @click="menuOpen = false">账户设置</RouterLink>
              <RouterLink v-if="user.canMaintain" to="/edits" class="menu-a" @click="menuOpen = false">题库维护</RouterLink>
              <RouterLink v-if="user.isAdmin" to="/bank/edit" class="menu-a" @click="menuOpen = false">题库原文编辑</RouterLink>
              <RouterLink v-if="user.canMaintain" to="/reviews" class="menu-a" @click="menuOpen = false">
                待审修订<span v-if="user.isAdmin && pending.count" class="menu-num">{{ pending.count }}</span>
              </RouterLink>
              <RouterLink to="/edit-log" class="menu-a" @click="menuOpen = false">修订日志</RouterLink>
              <button class="menu-a danger" @click="doLogout">退出登录</button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <main class="body">
      <RouterView v-slot="{ Component }">
        <component :is="Component" :key="route.fullPath" />
      </RouterView>
    </main>

    <!-- 一次性回执：游客进度并入、登录态失效等 -->
    <Transition name="toast">
      <div v-if="toast" class="toast card" :class="toast.kind" role="status">{{ toast.text }}</div>
    </Transition>

    <footer class="ftr">
      <span>HamStudy · FCC 业余无线电执照题库</span>
      <span class="dot">·</span>
      <span>共 1431 题，含 44 张电路图</span>
      <span class="dot">·</span>
      <span>数据周期 2026–2030 / 2023–2027 / 2024–2028</span>
    </footer>
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; display: flex; flex-direction: column; }

.hdr {
  position: sticky; top: 0; z-index: 50;
  background: rgba(255,255,255,.86);
  backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--line);
}
.hdr-in {
  max-width: 1220px; margin: 0 auto; height: var(--header-h);
  display: flex; align-items: center; gap: 22px; padding: 0 20px;
}
.brand { display: flex; align-items: center; gap: 8px; color: var(--tech); font-weight: 650; }
.brand-t { color: var(--text); font-size: 16px; letter-spacing: -.02em; }

.nav { display: flex; gap: 2px; }
.nav-i {
  padding: 6px 11px; border-radius: 8px; font-size: 14px; color: var(--text-2); font-weight: 500;
}
.nav-i:hover { background: var(--surface-sunken); color: var(--text); }
.nav-i.on { background: var(--tech-soft); color: var(--tech); }

.hdr-r { margin-left: auto; display: flex; align-items: center; gap: 9px; }

/* 中文开关：关态整体降饱和呈灰，开态回到正常并重描边，两种状态一眼可辨 */
.zh-btn { gap: 7px; padding: 0 9px 0 11px; }
.zh-btn .dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--text-3); transition: .15s ease;
}
.zh-btn kbd {
  font-family: var(--mono); font-size: 10.5px; line-height: 1;
  padding: 2px 4px; border-radius: 4px;
  border: 1px solid var(--line-2); color: var(--text-3);
  background: var(--surface-sunken);
}
/* 关：灰 */
.zh-btn.off {
  color: var(--text-3);
  border-color: var(--line);
  background: var(--surface-sunken);
}
.zh-btn.off .dot { background: #c3cad2; box-shadow: none; }
.zh-btn.off kbd { color: #a8b0b8; border-color: var(--line); }
.zh-btn.off:hover { color: var(--text-2); border-color: var(--line-2); background: var(--surface-sunken); }
/* 开：饱和 */
.zh-btn.on {
  color: var(--gen);
  border-color: var(--gen);
  background: var(--gen-soft);
}
.zh-btn.on .dot { background: var(--gen); box-shadow: 0 0 0 3px rgba(49, 130, 206, .18); }
.zh-btn.on kbd { color: var(--gen); border-color: rgba(49, 130, 206, .35); background: #fff; }
.zh-btn.on:hover { background: #dbeafe; }

.search {
  display: flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--line-2); background: var(--surface); color: var(--text-3);
}
.search:focus-within { border-color: var(--gen); box-shadow: var(--ring); color: var(--text-2); }
.search input { width: 148px; border: none; outline: none; background: none; font-size: 13px; }
.search input::placeholder { color: var(--text-3); }

/* 头像菜单 */
.user-menu { position: relative; }
.avatar-btn {
  display: grid; place-items: center; padding: 0;
  border: 1px solid var(--line); border-radius: 50%;
  background: none; cursor: pointer; line-height: 0;
}
.avatar-btn:hover, .avatar-btn.open { border-color: var(--tech); box-shadow: var(--ring); }
.menu {
  position: absolute; right: 0; top: calc(100% + 8px); z-index: 60;
  min-width: 208px; padding: 6px; box-shadow: var(--sh-3);
}
.menu-h {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 10px 12px; border-bottom: 1px solid var(--line); margin-bottom: 4px;
}
.menu-i { display: flex; flex-direction: column; min-width: 0; }
.menu-name { font-size: 14px; display: flex; align-items: center; gap: 7px; }
/* 呼号 */
.cs {
  font-family: var(--mono); font-size: 11.5px; font-weight: 600; letter-spacing: .04em;
  padding: 2px 7px; border-radius: 6px;
  background: var(--tech-soft); color: var(--tech);
}
.menu-i span {
  font-size: 12px; color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.menu-a {
  display: block; width: 100%; text-align: left;
  padding: 8px 10px; border-radius: 8px; font-size: 13.5px;
  color: var(--text); background: none; border: none; cursor: pointer;
}
.menu-a:hover { background: var(--surface-sunken); }
.menu-a.danger { color: var(--err); }
.menu-a.danger:hover { background: var(--err-soft); }
.menu-num {
  display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px;
  background: var(--accent-soft); color: #8a6100;
  font-family: var(--mono); font-size: 11px; line-height: 17px;
}

.body { flex: 1; }

/* 一次性回执：右下角浮出，几秒后消失 */
.toast {
  position: fixed; right: 18px; bottom: 18px; z-index: 300;
  max-width: 320px; padding: 11px 15px;
  font-size: 13px; color: var(--text); box-shadow: var(--sh-3);
  border-left: 3px solid var(--ok);
}
.toast.warn { border-left-color: var(--warn); }
.toast-enter-active, .toast-leave-active { transition: all .22s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }
.ftr {
  border-top: 1px solid var(--line);
  padding: 20px; text-align: center;
  font-size: 12.5px; color: var(--text-3);
  display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
}
.ftr .dot { opacity: .5; }

@media (max-width: 900px) {
  .search { display: none; }
  .nav { gap: 0; }
  .nav-i { padding: 6px 8px; }
}
@media (max-width: 680px) {
  .brand-t { display: none; }
  .ftr span:nth-child(n+3) { display: none; }
  /* 头部不再把整页撑出横向滚动条：导航自身可横滑，右侧按钮保持完整 */
  .hdr-in { gap: 10px; padding: 0 12px; }
  .nav {
    min-width: 0; flex: 1; overflow-x: auto;
    scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .nav::-webkit-scrollbar { display: none; }
  .nav-i { flex: none; white-space: nowrap; padding: 6px 7px; }
  .hdr-r { flex: none; margin-left: 0; gap: 6px; }
}
</style>
