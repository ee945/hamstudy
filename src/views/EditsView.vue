<script setup>
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useBank } from '../stores/bank'
import { useEdits } from '../stores/edits'
import { usePending } from '../stores/pending'
import { useUser } from '../stores/user'
import { toForm, toProposal, editedCount, EDITOR_FIELDS } from '../lib/edits'

const bank = useBank()
const edits = useEdits()
const pending = usePending()
const user = useUser()
const route = useRoute()

const ready = ref(false)
// 刷题页点「修订此题」带着 ?q=题号 过来，直接把这道题搜出来展开
const kw = ref(String(route.query.q || ''))
const scope = ref('all')
const secFilter = ref('')
const only = ref('')
const page = ref(0)
const PER = 20

const open = ref('')
const form = ref(null)
const msg = ref(null)

const SLUGKEY = { technician: '技术级', general: '通用级', extra: '业余特级' }

onMounted(async () => {
  await bank.ensureLoadedAll()
  ready.value = true
  // 待审列表：管理员看全部，编辑员看自己提交的。游客不会被加载（服务端也不放行）
  if (user.canMaintain) await pending.load()
  const jump = String(route.query.q || '').trim().toUpperCase()
  if (!jump) return
  await nextTick()
  const q = all.value.find((x) => x.id === jump)
  if (q) toggle(q)
  window.scrollTo({ top: 0, behavior: 'smooth' })
})

const all = computed(() => bank.allQuestions)

const LEVELS = [
  ['all', '全部'],
  ['technician', '技术级'],
  ['general', '通用级'],
  ['extra', '业余特级'],
]

const secs = computed(() => {
  const pool = scope.value === 'all' ? all.value : all.value.filter((q) => q.level === SLUGKEY[scope.value])
  return [...new Set(pool.map((q) => q.sec))].sort()
})

/** 状态筛选下拉的选项 */
const FILTERS = [
  ['', '全部状态'],
  ['revised', '已修订'],
  ['plain', '未修订'],
  ['noMnem', '缺记忆要点'],
  ['noExpl', '缺题目解析'],
]

const filtered = computed(() => {
  let pool = all.value
  if (scope.value !== 'all') pool = pool.filter((q) => q.level === SLUGKEY[scope.value])
  if (secFilter.value) pool = pool.filter((q) => q.sec === secFilter.value)

  const k = kw.value.trim().toLowerCase()
  if (k) {
    pool = pool.filter(
      (q) =>
        q.id.toLowerCase().includes(k) ||
        (q.qEn || '').toLowerCase().includes(k) ||
        (q.qZh || '').toLowerCase().includes(k)
    )
  }
  if (only.value === 'revised') pool = pool.filter((q) => !!edits.map[q.id])
  else if (only.value === 'plain') pool = pool.filter((q) => !edits.map[q.id])
  else if (only.value === 'noMnem') pool = pool.filter((q) => !String(q.mnem || '').trim())
  else if (only.value === 'noExpl') pool = pool.filter((q) => !String(q.expl || '').trim())
  return pool
})

const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PER)))
const rows = computed(() => filtered.value.slice(page.value * PER, page.value * PER + PER))

watch([kw, scope, secFilter, only], () => {
  page.value = 0
  open.value = ''
})

/** 副标题按身份变：管理员讲清改动的后果，编辑员讲清审核流程 */
const subText = computed(() => {
  if (user.isAdmin) {
    return '可修订题库任意部分，保存后全站立即生效；编辑员提交的提案在「待审修订」里由你把关，通过后生效。'
  }
  if (user.isEditor) {
    return '可修改中文译文、记忆要点与题目解析；英文原题与难度仅管理员可改。提交后不立即生效，需管理员审核通过。'
  }
  return '这里记录着题库的人工修订。译文与解析会改掉全站题面，因此只允许管理员与编辑员参与；所有人都可以查看修订内容。'
})

/** 编辑员不可改的字段：英文原题（题干 / 选项）与难度 */
const ro = (key) => user.isEditor && !EDITOR_FIELDS.includes(key) && key !== 'note'
const isEditor = computed(() => user.isEditor)

/** 点「已人工修订」这张卡，直接筛出被修订过的题（再点一次取消） */
function clickRevised() {
  only.value = only.value === 'revised' ? '' : 'revised'
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const stats = computed(() => {
  const pool = all.value
  const empty = (v) => !String(v || '').trim()
  return {
    total: pool.length,
    revised: pool.filter((q) => !!edits.map[q.id]).length,
    noMnem: pool.filter((q) => empty(q.mnem)).length,
    noExpl: pool.filter((q) => empty(q.expl)).length,
  }
})

const origOf = (id) => bank.original(id)

const LETTERS = ['A', 'B', 'C', 'D']

/** 选项最长可达 180+ 字，按字数预留行数，编辑时才不会看不见后半截 */
const rowsFor = (v) => Math.max(2, Math.ceil(String(v || '').length / 40))

/** 表单字段 -> 题目原文字段 */
const KEYMAP = {
  qzh: 'qZh', qen: 'qEn', optzh: 'optZh', opten: 'optEn',
  mnem: 'mnem', expl: 'expl', diff: 'diff',
}

const trimArr = (a) => (Array.isArray(a) ? a : []).map((x) => String(x ?? '').trim())

/** 当前相对原文改了哪些字段 */
const flags = computed(() => {
  if (!open.value || !form.value) return {}
  const orig = origOf(open.value)
  const out = {}
  for (const [k, qk] of Object.entries(KEYMAP)) {
    const a = form.value[k]
    const b = orig?.[qk]
    if (k === 'diff') out[k] = (Number(a) || 0) !== (Number(b) || 0)
    else if (k.startsWith('opt')) out[k] = JSON.stringify(trimArr(a)) !== JSON.stringify(trimArr(b))
    else out[k] = String(a ?? '').trim() !== String(b ?? '').trim()
  }
  return out
})

const changedN = computed(() => Object.values(flags.value).filter(Boolean).length)

function toggle(q) {
  msg.value = null
  if (open.value === q.id) {
    open.value = ''
    form.value = null
    return
  }
  // 正常流程下无权限的人会被路由挡回首页，入口也不可见；
  // 这里只覆盖「人停在页面上时权限被撤」的情形。
  if (!user.canMaintain) {
    msg.value = { ok: false, text: '当前账号没有题库维护权限' }
    return
  }
  open.value = q.id
  const base = toForm(origOf(q.id) || q, edits.map[q.id])
  // 编辑员对这道题已有待审提案时，把提案内容填回表单，方便接着改
  const mine = isEditor.value && pending.items.find(
    (p) => p.qid === q.id && (!p.status || p.status === 'pending') && p.author === user.user.id
  )
  if (mine) {
    for (const k of EDITOR_FIELDS) {
      if ((mine.fields || []).includes(k)) base[k] = mine[k]
    }
    base.note = mine.note || ''
  }
  form.value = base
}

/** 相对当前生效题面，编辑员这次实际改了几个字段 */
const editorChangedN = computed(() => {
  if (!isEditor.value || !open.value || !form.value) return 0
  const eff = bank.effective(open.value) || origOf(open.value) || {}
  return toProposal(form.value, eff).fields.length
})

function revertField(key) {
  const orig = origOf(open.value)
  if (!orig) return
  const v = orig[KEYMAP[key]]
  if (key.startsWith('opt')) form.value[key] = [...(v || [])]
  else if (key === 'diff') form.value.diff = Number(v) || 0
  else form.value[key] = String(v || '')
}

async function save(q) {
  msg.value = null
  const orig = origOf(q.id) || q
  if (isEditor.value) {
    // 提案的差分以「当前生效题面」为基准，编辑员没碰的字段不算他改的
    const eff = bank.effective(q.id) || q
    const r = await pending.submit(q.id, form.value, { q: eff, level: q.level, sec: q.sec })
    msg.value = r.ok
      ? { ok: true, text: '已提交审核，管理员通过后生效；提案在「待审修订」里可查看或撤下' }
      : { ok: false, text: r.error }
    return
  }
  const r = await edits.save(q.id, form.value, { q: orig, level: q.level, sec: q.sec })
  if (r.ok) {
    msg.value = { ok: true, text: r.cleared ? '改动已清空，此题回到题库原文' : '已保存，全站立即生效' }
    form.value = toForm(orig, edits.map[q.id])
  } else {
    msg.value = { ok: false, text: r.error }
  }
}

async function revertAll(q) {
  msg.value = null
  const orig = origOf(q.id) || q
  const r = await edits.revert(q.id)
  if (r.ok) {
    msg.value = { ok: true, text: '已还原为题库原文' }
    form.value = toForm(orig, null)
  } else {
    msg.value = { ok: false, text: r.error }
  }
}

/** 这个 PocketBase 版本不自动加 created/updated，时间统一由前端写进 at */
function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <div class="wrap">
    <div class="hd">
      <h1>题库维护<span v-if="user.canMaintain" class="badge" :class="{ ised: isEditor }">{{ user.roleLabel }}</span></h1>
      <p class="sub">{{ subText }}</p>
      <div v-if="user.canMaintain" class="hd-links">
        <RouterLink to="/reviews" class="lk">待审修订<span v-if="pending.count" class="num">{{ pending.count }}</span></RouterLink>
        <RouterLink to="/edit-log" class="lk">修订日志</RouterLink>
      </div>
    </div>

    <!-- 兜底：正常流程下无权限的人会被路由挡回首页（入口也不可见），
         这里只覆盖「停在页面上时权限被撤」这类边界。-->
    <div v-if="!user.canMaintain" class="warn card">
      <span>
        <b>当前账号没有题库维护权限。</b>
        下面的列表只能浏览，保存不会被接受。
      </span>
      <RouterLink class="btn btn-primary btn-sm" to="/">回首页</RouterLink>
    </div>

    <div v-else-if="isEditor" class="note card">
      <b>编辑员权限说明：</b>可改「中文题干 / 中文选项 / 记忆要点 / 题目解析」，英文原题与难度只读。
      点「提交审核」后改动不会立即生效，管理员在「待审修订」里通过或协助修改后才写入题库；
      每次操作都会记入修订日志。
    </div>

    <div class="stats">
      <div class="s card"><b>{{ stats.total }}</b><span>题目总数</span></div>
      <button
        class="s card hi clickable" :class="{ active: only === 'revised' }"
        :title="only === 'revised' ? '再点一次取消筛选' : '点击只看已修订过的题目'"
        @click="clickRevised"
      >
        <b>{{ stats.revised }}</b>
        <span>已人工修订{{ only === 'revised' ? ' · 已筛选' : ' · 点击筛选' }}</span>
      </button>
      <div class="s card"><b>{{ stats.noMnem }}</b><span>缺记忆要点</span></div>
      <div class="s card"><b>{{ stats.noExpl }}</b><span>缺题目解析</span></div>
    </div>

    <div class="filters">
      <button v-for="[v, t] in LEVELS" :key="v" class="f" :class="{ on: scope === v }" @click="scope = v">
        {{ t }}
      </button>
      <select v-model="secFilter">
        <option value="">全部小节</option>
        <option v-for="s in secs" :key="s" :value="s">{{ s }}</option>
      </select>
      <select v-model="only">
        <option v-for="[v, t] in FILTERS" :key="v" :value="v">{{ t }}</option>
      </select>
      <input v-model="kw" class="kw" placeholder="搜题号或关键词，如 T1A01、SWR、ground">
    </div>

    <div v-if="!ready" class="empty card">正在载入题库…</div>

    <template v-else>
      <div class="count">
        命中 {{ filtered.length }} 题<span v-if="edits.loaded && !edits.count" class="dim"> · 尚无修订记录</span>
      </div>

      <ul class="list">
        <li v-for="q in rows" :key="q.id" class="item card" :class="{ open: open === q.id, rev: !!edits.map[q.id] }">
          <button class="head" @click="toggle(q)">
            <span class="qid">#{{ q.id }}</span>
            <span class="tag">{{ q.sec }}</span>
            <span class="diff" :title="`难度 ${q.diff}/10`">
              <i v-for="n in 10" :key="n" :class="{ on: n <= q.diff }"></i>
            </span>
            <span v-if="q.img" class="tag img">配图</span>
            <span v-if="edits.map[q.id]" class="tag rev-tag">改动 {{ edits.countOf(q.id) }} 处</span>
            <span v-if="isEditor && pending.of(q.id)" class="tag pend-tag">我的提案待审</span>
            <span class="grow"></span>
            <span class="ans">答案 <b>{{ q.ans }}</b></span>
            <span class="caret">{{ open === q.id ? '收起' : '修订' }}</span>
          </button>

          <p class="en">{{ q.qEn }}</p>
          <p class="zh">{{ q.qZh }}</p>
          <p v-if="q.mnem" class="mn"><em>要点</em>{{ q.mnem }}</p>
          <p v-if="q.expl" class="mn"><em>解析</em>{{ q.expl }}</p>
          <!-- 放在 item 层而非编辑器内：未登录时编辑器不展开，提示也要看得见 -->
          <p v-if="msg && open !== q.id" class="msg" :class="msg.ok ? 'ok' : 'no'">{{ msg.text }}</p>

          <div v-if="open === q.id && form" class="ed fade-up">
            <div class="fld">
              <div class="lb">
                英文题干
                <em v-if="ro('qen')" class="ro">仅管理员可改</em>
                <em v-if="flags.qen" class="ch">已改</em>
                <button v-if="flags.qen && !ro('qen')" class="mini" @click="revertField('qen')">还原</button>
              </div>
              <textarea v-model="form.qen" rows="2" :disabled="ro('qen')"></textarea>
              <div v-if="flags.qen" class="orig">题库原文：{{ origOf(q.id)?.qEn }}</div>
            </div>

            <div class="fld">
              <div class="lb">
                中文题干
                <em v-if="flags.qzh" class="ch">已改</em>
                <button v-if="flags.qzh" class="mini" @click="revertField('qzh')">还原</button>
              </div>
              <textarea v-model="form.qzh" rows="2"></textarea>
              <div v-if="flags.qzh" class="orig">题库原文：{{ origOf(q.id)?.qZh }}</div>
            </div>

            <div class="two">
              <div class="fld">
                <div class="lb">
                  英文选项
                  <em v-if="ro('opten')" class="ro">仅管理员可改</em>
                  <em v-if="flags.opten" class="ch">已改</em>
                  <button v-if="flags.opten && !ro('opten')" class="mini" @click="revertField('opten')">还原</button>
                </div>
                <div v-for="n in 4" :key="n" class="opt-row">
                  <b>{{ LETTERS[n - 1] }}</b>
                  <!-- 选项可达 180+ 字，单行输入框会把后半截藏起来，按字数自动增高 -->
                  <textarea v-model="form.opten[n - 1]" :rows="rowsFor(form.opten[n - 1])" :disabled="ro('opten')"></textarea>
                </div>
                <div v-if="flags.opten" class="orig">题库原文：{{ origOf(q.id)?.optEn?.join(' / ') }}</div>
              </div>

              <div class="fld">
                <div class="lb">
                  中文选项
                  <em v-if="flags.optzh" class="ch">已改</em>
                  <button v-if="flags.optzh" class="mini" @click="revertField('optzh')">还原</button>
                </div>
                <div v-for="n in 4" :key="n" class="opt-row">
                  <b>{{ LETTERS[n - 1] }}</b>
                  <textarea v-model="form.optzh[n - 1]" :rows="rowsFor(form.optzh[n - 1])"></textarea>
                </div>
                <div v-if="flags.optzh" class="orig">题库原文：{{ origOf(q.id)?.optZh?.join(' / ') }}</div>
              </div>
            </div>

            <div class="fld">
              <div class="lb">
                难度
                <em v-if="ro('diff')" class="ro">仅管理员可改</em>
                <em v-if="flags.diff" class="ch">已改</em>
                <button v-if="flags.diff && !ro('diff')" class="mini" @click="revertField('diff')">还原</button>
              </div>
              <div class="diff-row">
                <input type="range" min="0" max="10" v-model.number="form.diff" :disabled="ro('diff')">
                <b class="dnum">{{ form.diff || '—' }}</b>
                <span class="hint1">0 表示沿用题库原值（当前 {{ origOf(q.id)?.diff ?? '—' }}）</span>
              </div>
            </div>

            <div class="fld">
              <div class="lb">
                记忆要点
                <em v-if="flags.mnem" class="ch">已改</em>
                <button v-if="flags.mnem" class="mini" @click="revertField('mnem')">还原</button>
              </div>
              <textarea v-model="form.mnem" rows="2" placeholder="一句话助记，例如：SWR 是反射功率的表征，1.5:1 以内才算合格"></textarea>
              <div v-if="flags.mnem" class="orig">题库原文：{{ origOf(q.id)?.mnem || '（空）' }}</div>
            </div>

            <div class="fld">
              <div class="lb">
                题目解析
                <em v-if="flags.expl" class="ch">已改</em>
                <button v-if="flags.expl" class="mini" @click="revertField('expl')">还原</button>
              </div>
              <textarea v-model="form.expl" rows="4" placeholder="讲清为什么选它、其他选项错在哪，比给结论更有用"></textarea>
              <div v-if="flags.expl" class="orig">题库原文：{{ origOf(q.id)?.expl || '（空）' }}</div>
            </div>

            <div class="fld">
              <div class="lb">修订说明<span class="lb-dim">给自己看的备注，不显示在刷题界面；审核通过生效后，将记录入修订日志</span></div>
              <input v-model="form.note" placeholder="例如：原译文把 ground 译成「地面」，应为「接地」">
            </div>

            <div class="acts">
              <button class="btn btn-primary" :disabled="edits.saving || pending.saving" @click="save(q)">
                {{ (edits.saving || pending.saving) ? '提交中…' : (isEditor ? '提交审核' : '保存修订') }}
              </button>
              <button v-if="!isEditor" class="btn" :disabled="edits.saving || !edits.map[q.id]" @click="revertAll(q)">
                还原为原文
              </button>
              <span v-if="isEditor ? editorChangedN : changedN" class="chg">
                相对{{ isEditor ? '当前题面' : '原文' }}改动 {{ isEditor ? editorChangedN : changedN }} 处
              </span>
              <span class="grow"></span>
              <span v-if="msg" class="msg" :class="msg.ok ? 'ok' : 'no'">{{ msg.text }}</span>
            </div>

            <div v-if="edits.map[q.id]" class="rec">
              记录于 {{ when(edits.map[q.id].at) }}
              <span v-if="edits.map[q.id].note"> · 说明：{{ edits.map[q.id].note }}</span>
              <span v-if="editedCount(edits.map[q.id]) === 0"> · 仅备注</span>
            </div>
          </div>
        </li>
      </ul>

      <div v-if="!filtered.length" class="empty card">没有符合条件的题目</div>

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
.wrap { max-width: 1000px; margin: 0 auto; padding: 24px 20px 80px; }
.hd { margin-bottom: 16px; }
.sub { font-size: 13.5px; color: var(--text-2); margin-top: 5px; line-height: 1.6; }
/* 管理员身份标识：改动会影响全站题面，先让操作人确认自己是谁 */
.badge {
  display: inline-block; margin-left: 10px; padding: 3px 9px;
  border-radius: 999px; background: var(--accent-soft);
  font-size: 11.5px; font-weight: 600; color: #8a6100;
  vertical-align: middle; letter-spacing: .3px;
}
.badge.ised { background: var(--gen-soft); color: var(--gen); }
.hd-links { display: flex; gap: 14px; margin-top: 10px; }
.lk { font-size: 13px; color: var(--gen); text-decoration: none; border-bottom: 1px solid transparent; }
.lk:hover { border-bottom-color: var(--gen); }
.lk .num {
  display: inline-block; margin-left: 5px; padding: 0 6px; border-radius: 999px;
  background: var(--accent-soft); color: #8a6100; font-family: var(--mono); font-size: 11px;
}

.note {
  padding: 12px 16px; margin-bottom: 14px; font-size: 13px; line-height: 1.7;
  background: var(--gen-soft); border-color: #cfe3f8; color: var(--text-2);
}
.note b { color: var(--gen); }

.warn {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; margin-bottom: 14px;
  background: var(--accent-soft); border-color: #f0dcae;
  font-size: 13.5px; color: #8a6100;
}
.warn span { flex: 1; }
.warn b { color: #6d4c00; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
@media (max-width: 620px) { .stats { grid-template-columns: repeat(2, 1fr); } }
.s { padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
.s b { font-size: 22px; font-family: var(--mono); line-height: 1.2; }
.s span { font-size: 12.5px; color: var(--text-3); }
.s.hi b { color: var(--gen); }
/* 只有「已人工修订」这张卡可点：点一下把状态筛选切到已修订 */
.s.clickable {
  text-align: left; font: inherit; cursor: pointer; width: 100%;
  transition: border-color .15s, box-shadow .15s;
}
.s.clickable:hover { border-color: var(--gen); box-shadow: var(--sh-2); }
.s.clickable.active { border-color: var(--gen); background: var(--gen-soft); }
.s.clickable.active span { color: var(--gen); }

.filters { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 12px; }
.f {
  padding: 5px 11px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text-2);
}
.f.on { background: var(--text); color: #fff; border-color: var(--text); }
.filters select {
  height: 30px; padding: 0 8px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--line-2); background: var(--surface); color: var(--text-2);
}
.kw {
  flex: 1; min-width: 200px; height: 30px; padding: 0 10px;
  border: 1px solid var(--line-2); border-radius: 8px;
  background: var(--surface); font-size: 13px; outline: none;
}
.kw:focus { border-color: var(--gen); box-shadow: var(--ring); }
.kw::placeholder { color: var(--text-3); }

.count { font-size: 13px; color: var(--text-3); margin-bottom: 10px; }
.count .dim { color: var(--text-3); }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.item { padding: 12px 15px; transition: border-color .15s; }
.item.rev { border-left: 3px solid var(--gen); }
.item.open { border-color: var(--gen); box-shadow: var(--sh-2); }

.head { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; padding: 0; }
.grow { flex: 1; }
.qid { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--gen); }
.diff { display: inline-flex; gap: 3px; }
.diff i { width: 5px; height: 5px; border-radius: 50%; background: var(--line-2); }
.diff i.on { background: var(--star); }
.tag.img { background: var(--accent-soft); color: #a06a00; }
.rev-tag { background: var(--gen-soft); color: var(--gen); }
.pend-tag { background: var(--accent-soft); color: #a06a00; }
.ans { font-size: 12.5px; color: var(--text-3); }
.ans b { color: var(--text); font-family: var(--mono); }
.caret { font-size: 12.5px; color: var(--text-3); }

.en { font-size: 14.5px; font-weight: 550; line-height: 1.6; margin-top: 7px; }
.zh { font-size: 13.5px; color: var(--text-2); line-height: 1.6; margin-top: 2px; }
.mn {
  font-size: 12.5px; color: var(--text-2); line-height: 1.6; margin-top: 4px;
  display: flex; gap: 6px;
}
.mn em {
  flex: none; font-style: normal; font-size: 11.5px; color: var(--text-3);
  background: var(--surface-sunken); padding: 0 6px; border-radius: 5px; height: 19px;
  display: inline-flex; align-items: center;
}

/* ---------- 编辑器 ---------- */
.ed {
  margin-top: 12px; padding-top: 14px; border-top: 1px dashed var(--line-2);
  display: flex; flex-direction: column; gap: 13px;
}
.fld { display: flex; flex-direction: column; gap: 5px; }
.lb { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: var(--text-2); }
.lb-dim { font-weight: 400; color: var(--text-3); font-size: 11.5px; }
.ch {
  font-style: normal; font-size: 11px; font-weight: 500;
  background: var(--accent-soft); color: #a06a00; padding: 1px 6px; border-radius: 5px;
}
.mini {
  font-size: 11.5px; color: var(--text-3); padding: 1px 6px;
  border: 1px solid var(--line); border-radius: 5px; background: var(--surface);
}
.mini:hover { color: var(--text); border-color: var(--text-3); }
.ro {
  font-style: normal; font-size: 11px; font-weight: 400;
  background: var(--surface-sunken); color: var(--text-3); padding: 1px 6px; border-radius: 5px;
}
textarea:disabled, input:disabled { background: var(--surface-sunken); color: var(--text-3); cursor: not-allowed; }

textarea, input[type='text'], .ed input:not([type='range']) {
  border: 1px solid var(--line-2); border-radius: 8px;
  padding: 7px 10px; font-size: 13.5px; line-height: 1.6;
  background: var(--surface-2); outline: none; width: 100%;
}
textarea { resize: vertical; }
textarea:focus, input:focus { border-color: var(--gen); box-shadow: var(--ring); background: var(--surface); }
::placeholder { color: var(--text-3); }

.orig {
  font-size: 12px; color: var(--text-3); line-height: 1.55;
  padding-left: 9px; border-left: 2px solid var(--line-2);
}

.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 620px) { .two { grid-template-columns: 1fr; } }
.opt-row { display: flex; align-items: flex-start; gap: 7px; }
.opt-row b { padding-top: 7px; }
.opt-row b {
  flex: none; width: 18px; text-align: center;
  font-family: var(--mono); font-size: 12px; color: var(--text-3); padding-top: 7px;
}

.diff-row { display: flex; align-items: center; gap: 10px; }
.diff-row input { width: 190px; }
.dnum { font-family: var(--mono); font-size: 14px; min-width: 18px; }
.hint1 { font-size: 11.5px; color: var(--text-3); }

.acts { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.chg { font-size: 12.5px; color: var(--warn); }
.msg { font-size: 12.5px; }
.msg.ok { color: var(--ok); }
.msg.no { color: var(--err); }

.rec { font-size: 11.5px; color: var(--text-3); }

.empty { padding: 50px; text-align: center; color: var(--text-3); }

.pager { display: flex; align-items: center; gap: 8px; justify-content: center; margin-top: 18px; }
.pi { font-size: 13px; color: var(--text-2); font-family: var(--mono); min-width: 60px; text-align: center; }
</style>
