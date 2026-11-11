<script setup>
import { computed, ref, onMounted } from 'vue'
import { useBank } from '../stores/bank'
import { useEdits } from '../stores/edits'
import { usePending } from '../stores/pending'
import { useUser } from '../stores/user'
import {
  toForm, toProposal, EDITOR_FIELDS, FIELD_LABELS, fieldSummary,
} from '../lib/edits'

const bank = useBank()
const edits = useEdits()
const pending = usePending()
const user = useUser()

const ready = ref(false)
const tab = ref('waiting')
const openId = ref('')
const forms = ref({})        // 提案 id -> 协助修改表单
const inits = ref({})        // 展开时的快照，用来判断是否「协助修改过」
const notes = ref({})        // 提案 id -> 审核意见
const msg = ref(null)

onMounted(async () => {
  await bank.ensureLoadedAll()
  await pending.load()
  ready.value = true
})

const list = computed(() => (tab.value === 'waiting' ? pending.waiting : pending.done))
const QK = { qzh: 'qZh', optzh: 'optZh', mnem: 'mnem', expl: 'expl' }

function qOf(p) {
  return bank.effective(p.qid) || bank.original(p.qid) || {}
}
function effVal(p, k) {
  return qOf(p)[QK[k]]
}
function show(v) {
  if (Array.isArray(v)) return v.join(' / ')
  return v === undefined || v === null || v === '' ? '（空）' : String(v)
}
function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const rowsFor = (v) => Math.max(2, Math.ceil(String(v || '').length / 40))
const LETTERS = ['A', 'B', 'C', 'D']

function toggle(p) {
  msg.value = null
  if (openId.value === p.id) {
    openId.value = ''
    return
  }
  openId.value = p.id
  if (user.isAdmin) {
    // 表单初值 = 当前生效题面，再叠上提案里改过的字段（提案存的是最终值）
    const f = toForm(qOf(p), null)
    for (const k of EDITOR_FIELDS) {
      if ((p.fields || []).includes(k)) f[k] = p[k]
    }
    f.note = p.note || ''
    forms.value = { ...forms.value, [p.id]: f }
    inits.value = { ...inits.value, [p.id]: JSON.stringify(f) }
  }
  notes.value = { ...notes.value, [p.id]: notes.value[p.id] || '' }
}

function others(p) {
  return pending.waiting.filter((x) => x.qid === p.qid && x.id !== p.id).length
}

async function approve(p) {
  msg.value = null
  const f = forms.value[p.id]
  if (!f) return
  const proposal = toProposal(f, qOf(p))
  if (!proposal.fields.length && !proposal.note) {
    msg.value = { ok: false, text: '这份提案没有任何改动，无法生效；请驳回或先协助修改' }
    return
  }
  const assisted = JSON.stringify(f) !== inits.value[p.id]
  const r = await pending.approve(p, proposal, {
    assisted, reviewNote: notes.value[p.id] || '',
  })
  if (r.ok) {
    msg.value = { ok: true, text: assisted ? '已协助修改并生效，全站题面已更新' : '已通过，全站题面已更新' }
    openId.value = ''
  } else {
    msg.value = { ok: false, text: r.error }
  }
}

async function reject(p) {
  msg.value = null
  const r = await pending.reject(p, notes.value[p.id] || '')
  msg.value = r.ok ? { ok: true, text: '已驳回，题面保持不变' } : { ok: false, text: r.error }
  if (r.ok) openId.value = ''
}

async function withdraw(p) {
  msg.value = null
  const r = await pending.withdraw(p)
  msg.value = r.ok ? { ok: true, text: '提案已撤下' } : { ok: false, text: r.error }
  if (r.ok) openId.value = ''
}

const statusText = (p) => ({ approved: '已通过', rejected: '已驳回' }[p.status] || '待审')
</script>

<template>
  <div class="wrap">
    <div class="hd">
      <h1>待审修订<span class="badge">{{ user.roleLabel }}</span></h1>
      <p class="sub">
        编辑员提交的中文译文 / 要点 / 解析改动会先停在这里。
        管理员可直接通过，也可先在表单里协助修改再提交生效；提案通过前刷题页看到的仍是原题面。
      </p>
      <div class="hd-links">
        <RouterLink to="/edits" class="lk">← 题库维护</RouterLink>
        <RouterLink to="/edit-log" class="lk">修订日志</RouterLink>
      </div>
    </div>

    <div class="tabs">
      <button class="f" :class="{ on: tab === 'waiting' }" @click="tab = 'waiting'; openId = ''">
        待审 <b>{{ pending.count }}</b>
      </button>
      <button class="f" :class="{ on: tab === 'done' }" @click="tab = 'done'; openId = ''">
        已处理 <b>{{ pending.done.length }}</b>
      </button>
    </div>

    <div v-if="msg" class="flash card" :class="msg.ok ? 'ok' : 'no'">{{ msg.text }}</div>

    <div v-if="!ready" class="empty card">正在载入…</div>
    <template v-else>
      <div v-if="!list.length" class="empty card">
        {{ tab === 'waiting' ? '暂无待审提案' : '还没有处理记录' }}
      </div>

      <ul class="list">
        <li v-for="p in list" :key="p.id" class="item card" :class="{ open: openId === p.id }">
          <button class="head" @click="toggle(p)">
            <span class="qid">#{{ p.qid }}</span>
            <span class="tag">{{ p.sec || p.level }}</span>
            <span class="who">{{ p.authorName || '编辑员' }}</span>
            <span class="st" :class="p.status || 'pending'">{{ statusText(p) }}</span>
            <span class="sm">{{ fieldSummary(p.fields) }}</span>
            <span class="grow"></span>
            <span class="tm">{{ when(p.at) }}</span>
            <span class="caret">{{ openId === p.id ? '收起' : '查看' }}</span>
          </button>

          <div v-if="openId === p.id" class="body fade-up">
            <div v-if="user.isAdmin && tab === 'waiting' && others(p)" class="hint">
              注意：这道题另有 {{ others(p) }} 条待审提案，通过后其余提案仍按各自内容合并。
            </div>

            <!-- 提案内容对照 -->
            <div class="diffs">
              <div class="dh">提案改动（{{ (p.fields || []).length }} 处）</div>
              <div v-if="!(p.fields || []).length" class="dim">这份提案只改了修订说明</div>
              <div v-for="k in (p.fields || [])" :key="k" class="df">
                <span class="dk">{{ FIELD_LABELS[k] }}</span>
                <div class="dv"><em>当前生效</em>{{ show(effVal(p, k)) }}</div>
                <div class="dv new"><em>提案值</em>{{ show(p[k]) }}</div>
              </div>
            </div>

            <template v-if="user.isAdmin && tab === 'waiting' && forms[p.id]">
              <div class="dh2">协助修改（可先改内容再提交；不改直接点「通过并生效」）</div>
              <div class="fld">
                <div class="lb">中文题干</div>
                <textarea v-model="forms[p.id].qzh" rows="2"></textarea>
              </div>
              <div class="fld">
                <div class="lb">中文选项</div>
                <div v-for="n in 4" :key="n" class="opt-row">
                  <b>{{ LETTERS[n - 1] }}</b>
                  <textarea v-model="forms[p.id].optzh[n - 1]" :rows="rowsFor(forms[p.id].optzh[n - 1])"></textarea>
                </div>
              </div>
              <div class="fld">
                <div class="lb">记忆要点</div>
                <textarea v-model="forms[p.id].mnem" rows="2"></textarea>
              </div>
              <div class="fld">
                <div class="lb">题目解析</div>
                <textarea v-model="forms[p.id].expl" rows="4"></textarea>
              </div>
              <div class="fld">
                <div class="lb">修订说明</div>
                <input v-model="forms[p.id].note" placeholder="给自己看的备注，审核通过后记入修订日志">
              </div>
              <div class="fld">
                <div class="lb">审核意见<span class="lb-dim">驳回时建议写明原因，会记入修订日志</span></div>
                <input v-model="notes[p.id]" placeholder="选填">
              </div>
              <div class="acts">
                <button class="btn btn-primary" :disabled="pending.saving" @click="approve(p)">
                  {{ pending.saving ? '提交中…' : '通过并生效' }}
                </button>
                <button class="btn danger" :disabled="pending.saving" @click="reject(p)">驳回</button>
                <span class="grow"></span>
                <RouterLink class="lk" :to="`/edits?q=${p.qid}`">去题库维护看全文</RouterLink>
              </div>
            </template>

            <template v-else>
              <div v-if="p.note" class="pn"><b>修订说明：</b>{{ p.note }}</div>
              <div v-if="p.reviewNote" class="pn"><b>审核意见：</b>{{ p.reviewNote }}</div>
              <div v-if="user.isEditor && tab === 'waiting'" class="acts">
                <button class="btn" :disabled="pending.saving" @click="withdraw(p)">撤下这份提案</button>
              </div>
              <div v-else-if="tab === 'done'" class="pn dim">处理状态：{{ statusText(p) }}</div>
            </template>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.wrap { max-width: 1000px; margin: 0 auto; padding: 24px 20px 80px; }
.hd { margin-bottom: 16px; }
.sub { font-size: 13.5px; color: var(--text-2); margin-top: 5px; line-height: 1.7; }
.badge {
  display: inline-block; margin-left: 10px; padding: 3px 9px; border-radius: 999px;
  background: var(--gen-soft); color: var(--gen); font-size: 11.5px;
  font-weight: 600; vertical-align: middle;
}
.hd-links { display: flex; gap: 16px; margin-top: 10px; }
.lk { font-size: 13px; color: var(--gen); text-decoration: none; }
.lk:hover { text-decoration: underline; }

.tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.f {
  padding: 6px 13px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text-2);
}
.f b { font-family: var(--mono); margin-left: 3px; }
.f.on { background: var(--text); color: #fff; border-color: var(--text); }

.flash { padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
.flash.ok { background: var(--ok-soft); color: var(--ok); border-color: #bfe6d3; }
.flash.no { background: var(--err-soft); color: var(--err); border-color: #f6cccc; }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.item { padding: 12px 15px; }
.item.open { border-color: var(--gen); box-shadow: var(--sh-2); }
.head { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; padding: 0; flex-wrap: wrap; }
.grow { flex: 1; }
.qid { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--gen); }
.who { font-size: 12.5px; color: var(--text-2); }
.sm, .tm { font-size: 11.5px; color: var(--text-3); }
.st { font-size: 11px; padding: 2px 7px; border-radius: 5px; }
.st.pending { background: var(--accent-soft); color: #8a6100; }
.st.approved { background: var(--ok-soft); color: var(--ok); }
.st.rejected { background: var(--err-soft); color: var(--err); }
.caret { font-size: 12.5px; color: var(--gen); }

.body { margin-top: 12px; padding-top: 13px; border-top: 1px dashed var(--line-2); }
.hint { font-size: 12.5px; color: #8a6100; background: var(--accent-soft); padding: 8px 11px; border-radius: 8px; margin-bottom: 12px; }
.dh { font-size: 12.5px; font-weight: 600; color: var(--text-2); margin-bottom: 8px; }
.dh2 { font-size: 12.5px; font-weight: 600; color: var(--text-2); margin: 16px 0 10px; padding-top: 12px; border-top: 1px dashed var(--line-2); }
.diffs { display: flex; flex-direction: column; gap: 8px; }
.df { display: grid; grid-template-columns: 76px 1fr 1fr; gap: 8px; align-items: start; font-size: 12.5px; }
.dk { color: var(--text-3); font-size: 12px; padding-top: 3px; }
.dv { line-height: 1.65; color: var(--text-2); word-break: break-word; }
.dv.new { color: var(--text); }
.dv em { display: block; font-style: normal; font-size: 11px; color: var(--text-3); margin-bottom: 2px; }
.dim { color: var(--text-3); font-size: 12.5px; }

.fld { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; }
.lb { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--text-2); }
.lb-dim { font-weight: 400; color: var(--text-3); font-size: 11.5px; }
.opt-row { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 5px; }
.opt-row b { flex: none; width: 18px; text-align: center; padding-top: 7px; font-family: var(--mono); font-size: 12px; color: var(--text-3); }
textarea, input { border: 1px solid var(--line-2); border-radius: 8px; padding: 7px 10px; font-size: 13px; line-height: 1.6; background: var(--surface-2); outline: none; width: 100%; }
textarea { resize: vertical; }
textarea:focus, input:focus { border-color: var(--gen); box-shadow: var(--ring); background: var(--surface); }
::placeholder { color: var(--text-3); }

.pn { font-size: 12.5px; color: var(--text-2); margin-top: 10px; line-height: 1.6; }
.pn b { color: var(--text-3); }
.acts { display: flex; align-items: center; gap: 10px; margin-top: 15px; flex-wrap: wrap; }
.btn.danger { color: var(--err); border-color: #f0cccc; }
.empty { padding: 50px; text-align: center; color: var(--text-3); }
@media (max-width: 620px) { .df { grid-template-columns: 1fr; } }
</style>
