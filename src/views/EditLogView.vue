<script setup>
import { computed, ref, onMounted } from 'vue'
import { useLogs } from '../stores/logs'
import { useUser } from '../stores/user'
import { ACTION_LABELS, ROLE_LABELS } from '../lib/edits'

const logs = useLogs()
const user = useUser()

const ready = ref(false)
const tab = ref('rank')
const userKey = ref('')
const actionKey = ref('')
const levelKey = ref('')
const kw = ref('')
const page = ref(0)
const PER = 20

onMounted(async () => {
  await logs.load()
  ready.value = true
})

const LEVELS = [
  ['', '全部级别'], ['技术级', '技术级'], ['通用级', '通用级'], ['业余特级', '业余特级'],
]
const ACTIONS = [['', '全部动作'], ...Object.entries(ACTION_LABELS)]

const effectiveActions = ['direct', 'approve', 'assist']

const stats = computed(() => {
  const a = logs.items
  return {
    ops: a.length,
    effective: a.filter((l) => effectiveActions.includes(l.action)).length,
    submit: a.filter((l) => l.action === 'submit').length,
    people: people.value.length,
  }
})

/**
 * 贡献榜：谁的内容真正生效了，就算谁的修订贡献。
 *   direct（管理员直接改）→ 记在操作人
 *   approve / assist（提案生效）→ 记在提案人 contributor
 * 管理员的审核与协助另列两栏，不会被埋没。
 */
const people = computed(() => {
  const m = new Map()
  const touch = (id, name, role) => {
    if (!id) return null
    if (!m.has(id)) {
      m.set(id, {
        id, name: name || '未知用户', role: role || '',
        effective: 0, submit: 0, review: 0, assist: 0, ops: 0,
      })
    }
    const p = m.get(id)
    if (role === 'admin' || role === 'editor') p.role = role
    if (name && p.name === '未知用户') p.name = name
    return p
  }
  for (const l of logs.items) {
    const me = touch(l.userId, l.userName, l.userRole)
    if (!me) continue
    me.ops += 1
    if (l.action === 'submit') me.submit += 1
    if (['approve', 'assist', 'reject'].includes(l.action)) me.review += 1
    if (l.action === 'assist') me.assist += 1
    if (l.action === 'direct') me.effective += 1
    if (['approve', 'assist', 'reject'].includes(l.action) && l.contributor) {
      const c = touch(l.contributor, l.contributorName, 'editor')
      if (c && l.action !== 'reject') c.effective += 1
    }
  }
  return [...m.values()].sort(
    (a, b) => b.effective - a.effective || b.submit - a.submit || b.ops - a.ops
  )
})

const userOptions = computed(() => [
  ['', '全部用户'],
  ...people.value.map((p) => [p.id, p.name]),
])

const filtered = computed(() => {
  let a = logs.sorted
  if (userKey.value) {
    a = a.filter((l) => l.userId === userKey.value || l.contributor === userKey.value)
  }
  if (actionKey.value) a = a.filter((l) => l.action === actionKey.value)
  if (levelKey.value) a = a.filter((l) => l.level === levelKey.value)
  const k = kw.value.trim().toLowerCase()
  if (k) {
    a = a.filter((l) =>
      [l.qid, l.note, l.summary, l.userName, l.contributorName]
        .some((v) => String(v || '').toLowerCase().includes(k))
    )
  }
  return a
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PER)))
const rows = computed(() => filtered.value.slice(page.value * PER, page.value * PER + PER))

function resetPage() { page.value = 0 }

function when(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const roleOf = (r) => ROLE_LABELS[r] || '普通用户'
</script>

<template>
  <div class="wrap">
    <div class="hd">
      <h1>修订日志</h1>
      <p class="sub">
        记录编辑员与管理员的每一次修订操作：提交提案、审核通过、协助修改、驳回、直接修订与还原。
        审核通过生效后的改动都会留在这里，按账号统计贡献。
      </p>
      <div v-if="user.canMaintain" class="hd-links">
        <RouterLink to="/edits" class="lk">题库维护</RouterLink>
        <RouterLink to="/reviews" class="lk">待审修订</RouterLink>
      </div>
    </div>

    <div class="stats">
      <div class="s card"><b>{{ stats.ops }}</b><span>累计操作</span></div>
      <div class="s card hi"><b>{{ stats.effective }}</b><span>生效修订</span></div>
      <div class="s card"><b>{{ stats.submit }}</b><span>提案提交</span></div>
      <div class="s card"><b>{{ stats.people }}</b><span>参与人数</span></div>
    </div>

    <div class="tabs">
      <button class="f" :class="{ on: tab === 'rank' }" @click="tab = 'rank'">贡献排行</button>
      <button class="f" :class="{ on: tab === 'detail' }" @click="tab = 'detail'">操作明细</button>
    </div>

    <div v-if="!ready" class="empty card">正在载入…</div>

    <template v-else-if="tab === 'rank'">
      <div v-if="!people.length" class="empty card">还没有任何修订记录</div>
      <div v-else class="card tbl">
        <table>
          <thead>
            <tr>
              <th>#</th><th>参与者</th><th>角色</th>
              <th>生效修订</th><th>提交提案</th><th>审核处理</th><th>协助修改</th><th>操作合计</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in people" :key="p.id" :class="{ me: p.id === user.user?.id }">
              <td class="rk">{{ i + 1 }}</td>
              <td><b>{{ p.name }}</b><span v-if="p.id === user.user?.id" class="me-tag">我</span></td>
              <td><span class="role" :class="p.role">{{ roleOf(p.role) }}</span></td>
              <td class="num big">{{ p.effective }}</td>
              <td class="num">{{ p.submit }}</td>
              <td class="num">{{ p.review }}</td>
              <td class="num">{{ p.assist }}</td>
              <td class="num">{{ p.ops }}</td>
            </tr>
          </tbody>
        </table>
        <p class="foot">「生效修订」按内容归属统计：管理员直接修订记管理员，编辑员提案通过（含协助修改）记编辑员。</p>
      </div>
    </template>

    <template v-else>
      <div class="filters">
        <select v-model="userKey" @change="resetPage"><option v-for="[v, t] in userOptions" :key="v" :value="v">{{ t }}</option></select>
        <select v-model="actionKey" @change="resetPage"><option v-for="[v, t] in ACTIONS" :key="v" :value="v">{{ t }}</option></select>
        <select v-model="levelKey" @change="resetPage"><option v-for="[v, t] in LEVELS" :key="v" :value="v">{{ t }}</option></select>
        <input v-model="kw" class="kw" placeholder="搜题号 / 说明 / 人名" @input="resetPage">
      </div>
      <div class="count">命中 {{ filtered.length }} 条</div>

      <div v-if="!filtered.length" class="empty card">没有符合条件的记录</div>
      <div v-else class="card tbl">
        <table>
          <thead>
            <tr><th>时间</th><th>操作人</th><th>动作</th><th>题目</th><th>改动字段</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in rows" :key="l.id">
              <td class="tm">{{ when(l.at) }}</td>
              <td>
                <b>{{ l.userName }}</b>
                <span class="role" :class="l.userRole">{{ roleOf(l.userRole) }}</span>
                <span v-if="l.contributorName && l.contributorName !== l.userName" class="from">提案人：{{ l.contributorName }}</span>
              </td>
              <td><span class="act" :class="l.action">{{ ACTION_LABELS[l.action] || l.action }}</span></td>
              <td class="mono">#{{ l.qid }}<span v-if="l.sec" class="dim"> · {{ l.sec }}</span></td>
              <td class="flds">{{ l.summary || '—' }}</td>
              <td class="note">{{ l.note || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pages > 1" class="pager">
        <button class="btn btn-sm" :disabled="page === 0" @click="page = 0">首页</button>
        <button class="btn btn-sm" :disabled="page === 0" @click="page--">上一页</button>
        <span class="pi">{{ page + 1 }} / {{ pages }}</span>
        <button class="btn btn-sm" :disabled="page >= pages - 1" @click="page++">下一页</button>
        <button class="btn btn-sm" :disabled="page >= pages - 1" @click="page = pages - 1">末页</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wrap { max-width: 1040px; margin: 0 auto; padding: 24px 20px 80px; }
.hd { margin-bottom: 16px; }
.sub { font-size: 13.5px; color: var(--text-2); margin-top: 5px; line-height: 1.7; }
.hd-links { display: flex; gap: 16px; margin-top: 10px; }
.lk { font-size: 13px; color: var(--gen); text-decoration: none; }
.lk:hover { text-decoration: underline; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
@media (max-width: 620px) { .stats { grid-template-columns: repeat(2, 1fr); } }
.s { padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
.s b { font-size: 22px; font-family: var(--mono); line-height: 1.2; }
.s span { font-size: 12.5px; color: var(--text-3); }
.s.hi b { color: var(--gen); }

.tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.f { padding: 6px 13px; border-radius: 8px; font-size: 13px; border: 1px solid var(--line); background: var(--surface); color: var(--text-2); }
.f.on { background: var(--text); color: #fff; border-color: var(--text); }

.filters { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 10px; }
.filters select { height: 30px; padding: 0 8px; border-radius: 8px; font-size: 13px; border: 1px solid var(--line-2); background: var(--surface); color: var(--text-2); }
.kw { flex: 1; min-width: 180px; height: 30px; padding: 0 10px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); font-size: 13px; outline: none; }
.kw:focus { border-color: var(--gen); box-shadow: var(--ring); }
.count { font-size: 13px; color: var(--text-3); margin-bottom: 10px; }

.tbl { overflow-x: auto; padding: 0; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-size: 11.5px; font-weight: 600; color: var(--text-3); padding: 10px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 10px 12px; border-bottom: 1px solid var(--line); color: var(--text-2); vertical-align: top; line-height: 1.55; }
tr:last-child td { border-bottom: none; }
tr.me { background: var(--gen-soft); }
.rk { font-family: var(--mono); color: var(--text-3); width: 34px; }
.num { font-family: var(--mono); text-align: right; white-space: nowrap; }
.num.big { color: var(--gen); font-weight: 700; font-size: 15px; }
.me-tag { margin-left: 6px; font-size: 10.5px; color: var(--gen); background: var(--surface); padding: 1px 5px; border-radius: 4px; }
.role { margin-left: 6px; font-size: 10.5px; padding: 1px 6px; border-radius: 5px; background: var(--surface-sunken); color: var(--text-3); white-space: nowrap; }
.role.admin { background: var(--accent-soft); color: #8a6100; }
.role.editor { background: var(--gen-soft); color: var(--gen); }
.from { display: block; font-size: 11px; color: var(--text-3); margin-top: 2px; }
.act { font-size: 11.5px; padding: 2px 7px; border-radius: 5px; white-space: nowrap; background: var(--surface-sunken); color: var(--text-2); }
.act.submit { background: var(--gen-soft); color: var(--gen); }
.act.approve, .act.direct { background: var(--ok-soft); color: var(--ok); }
.act.assist { background: var(--accent-soft); color: #8a6100; }
.act.reject, .act.revert, .act.withdraw { background: var(--err-soft); color: var(--err); }
.mono { font-family: var(--mono); font-size: 12px; white-space: nowrap; }
.dim { color: var(--text-3); }
.flds { max-width: 220px; }
.note { max-width: 260px; color: var(--text-3); word-break: break-word; }
.foot { font-size: 11.5px; color: var(--text-3); padding: 10px 12px; margin: 0; border-top: 1px solid var(--line); line-height: 1.6; }

.empty { padding: 50px; text-align: center; color: var(--text-3); }
.pager { display: flex; align-items: center; gap: 8px; justify-content: center; margin-top: 18px; }
.pi { font-size: 13px; color: var(--text-2); font-family: var(--mono); min-width: 60px; text-align: center; }
</style>
