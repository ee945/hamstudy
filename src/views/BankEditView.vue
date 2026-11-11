<script setup>
/**
 * 题库原文编辑（仅站点 admin）。
 *
 * 这里改的是 public/data/q_*.json 里的出厂原文，通过 /bank/write 直接落盘，
 * 不产生 hs_edits / hs_edit_logs 记录，也不留历史版本。
 * 编辑员的修订流完全不变：仍走题库维护的提案审核，叠加在本页原文之上并留痕。
 *
 * 注意：本页表单读的是 bank.rawIndex（出厂原文），不是叠加修订后的题面。
 * 若某题存在已通过的人工修订，前台显示仍以修订为准 —— 这是刻意保留的分层。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useBank, slugOf } from '../stores/bank'
import { saveBankQuestion } from '../lib/bankFiles'

const LETTERS = ['A', 'B', 'C', 'D']
const LEVEL_NAME = { technician: '技术级', general: '通用级', extra: '业余特级' }

const bank = useBank()
const route = useRoute()

const qidInput = ref('')
const current = ref('')
const form = ref(null)
const msg = ref(null)
const saving = ref(false)

const slug = computed(() => slugOf(current.value))
const raw = computed(() => bank.rawIndex[slug.value]?.get(current.value) || null)
const ids = computed(() => bank.loaded[slug.value]?.qs?.map((q) => q.id) || [])
const pos = computed(() => ids.value.indexOf(current.value))
const levelName = computed(() => LEVEL_NAME[slug.value] || '')
const ansIdx = computed(() => Number(raw.value?.ansIdx) || 0)

function toast(okFlag, text) {
  msg.value = { ok: okFlag, text }
  clearTimeout(toast._t)
  toast._t = setTimeout(() => (msg.value = null), 5000)
}

async function load(id) {
  const qid = String(id || '').trim().toUpperCase()
  const s = slugOf(qid)
  if (!s) { toast(false, '题号需以 T / G / E 开头，例如 T1A01'); return }
  try {
    await bank.loadLevel(s)
  } catch (e) {
    toast(false, `题库加载失败：${e?.message || e}`)
    return
  }
  const q = bank.rawIndex[s]?.get(qid)
  if (!q) { toast(false, `题库中找不到 ${qid}`); return }
  current.value = qid
  qidInput.value = qid
  form.value = {
    qZh: q.qZh || '',
    qEn: q.qEn || '',
    optZh: [...(q.optZh || ['', '', '', ''])],
    optEn: [...(q.optEn || ['', '', '', ''])],
    mnem: q.mnem || '',
    expl: q.expl || '',
    diff: Number(q.diff) || 0,
  }
  msg.value = null
}

function jump() { load(qidInput.value) }

function step(d) {
  const list = ids.value
  const i = pos.value + d
  if (i < 0 || i >= list.length) return
  load(list[i])
}

async function save() {
  const f = form.value
  if (!current.value || !f) return
  if (!String(f.qZh).trim() || !String(f.qEn).trim()) {
    toast(false, '中英文题干不能为空')
    return
  }
  if (f.optZh.some((x) => !String(x).trim()) || f.optEn.some((x) => !String(x).trim())) {
    toast(false, '四个中文与四个英文选项都必须填写')
    return
  }
  saving.value = true
  try {
    const r = await saveBankQuestion(current.value, {
      qZh: f.qZh,
      qEn: f.qEn,
      optZh: f.optZh.map(String),
      optEn: f.optEn.map(String),
      mnem: f.mnem,
      expl: f.expl,
      diff: Number(f.diff) || 0,
    })
    await bank.refreshAll()
    toast(true, r.distSynced
      ? `已写入 ${r.file}，public/data 与 dist/data 已同步，线上立即生效`
      : `已写入 ${r.file}，但 dist/data 未同步，请执行 npm run build`)
  } catch (e) {
    toast(false, e?.message || String(e))
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await bank.fetchMeta()
  await load(String(route.query.q || '').trim() || 'T1A01')
})
</script>

<template>
  <div class="be">
    <section class="card be-head">
      <h2>题库原文编辑</h2>
      <p>
        直接改写 <code>public/data/q_*.json</code> 的出厂原文。三个 JSON 是本站唯一权威数据源，
        保存后同时写入 <code>dist/data</code>，线上立即生效，无需重新构建。
      </p>
      <p class="be-warn">
        本页修改不写入修订日志、不进审核流、不产生历史版本；编辑员的正常修订仍按原流程留痕。
        若某题已有通过的人工修订，前台题面仍以修订为准，本页编辑的是被叠加的底层原文。
        题号、小节、正确答案与选项顺序不可修改。
      </p>
    </section>

    <section class="card be-bar">
      <div class="be-search">
        <input
          v-model="qidInput" class="be-in" placeholder="输入题号，如 T1A01 / G5A11 / E5B02"
          @keydown.enter="jump"
        >
        <button class="btn btn-primary" @click="jump">定位题目</button>
      </div>
      <div class="be-nav">
        <button class="btn btn-sm" :disabled="pos <= 0" @click="step(-1)">← 上一题</button>
        <span class="be-pos">
          {{ current || '—' }} · {{ levelName }} 第 {{ pos + 1 }} / {{ ids.length }} 题
        </span>
        <button class="btn btn-sm" :disabled="pos < 0 || pos >= ids.length - 1" @click="step(1)">
          下一题 →
        </button>
      </div>
    </section>

    <section v-if="form && raw" class="card be-form">
      <div class="be-meta">
        <span class="be-qid">{{ raw.id }}</span>
        <span>{{ levelName }}</span>
        <span>小节 {{ raw.sec }}</span>
        <span>正确答案 {{ raw.ans }} · {{ raw.optZh?.[ansIdx] }}</span>
      </div>

      <div class="be-grid">
        <label class="be-f">
          <span>中文题干</span>
          <textarea v-model="form.qZh" class="be-ta" />
        </label>
        <label class="be-f">
          <span>英文题干</span>
          <textarea v-model="form.qEn" class="be-ta" />
        </label>
      </div>

      <div class="be-opts">
        <div v-for="(letter, i) in LETTERS" :key="letter" class="be-opt">
          <div class="be-opt-h">{{ letter }} 选项</div>
          <input v-model="form.optZh[i]" class="be-in" placeholder="中文选项">
          <input v-model="form.optEn[i]" class="be-in" placeholder="英文选项">
        </div>
      </div>

      <div class="be-grid">
        <label class="be-f">
          <span>记忆要点</span>
          <textarea v-model="form.mnem" class="be-ta" />
        </label>
        <label class="be-f">
          <span>题目解析</span>
          <textarea v-model="form.expl" class="be-ta" />
        </label>
      </div>

      <label class="be-f be-diff">
        <span>难度（0–10）</span>
        <input v-model.number="form.diff" type="number" min="0" max="10" class="be-in">
      </label>

      <div class="be-actions">
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存到题库原文' }}
        </button>
        <button class="btn" :disabled="saving" @click="load(current)">放弃修改</button>
        <span class="be-hint">保存即刻写入文件，不记录任何修订日志</span>
      </div>
      <p v-if="msg" class="msg" :class="msg.ok ? 'ok' : 'no'">{{ msg.text }}</p>
    </section>

    <section v-else class="card be-empty">请输入题号定位要编辑的题目。</section>
  </div>
</template>

<style scoped>
.be {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 64px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.be-head, .be-bar, .be-form, .be-empty { padding: 20px 22px; }
.be h2 { margin: 0 0 10px; font-size: 19px; }
.be p { font-size: 13.5px; line-height: 1.75; color: var(--text-2); }
.be code {
  font-family: var(--mono, monospace);
  font-size: 12.5px;
  background: var(--surface-sunken);
  padding: 1px 5px;
  border-radius: 5px;
}
.be-warn {
  margin-top: 10px;
  padding: 11px 13px;
  border-left: 3px solid var(--accent);
  background: var(--accent-soft);
  color: var(--text-2);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
}
.be-bar { display: flex; flex-direction: column; gap: 14px; }
.be-search { display: flex; gap: 9px; }
.be-search .be-in { flex: 1; max-width: 320px; }
.be-nav { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.be-pos { font-size: 13px; color: var(--text-2); font-family: var(--mono, monospace); }
.be-meta {
  display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center;
  padding-bottom: 16px; margin-bottom: 18px;
  border-bottom: 1px dashed var(--line-2);
  font-size: 13px; color: var(--text-2);
}
.be-qid {
  font-family: var(--mono, monospace); font-weight: 600; font-size: 15px;
  color: var(--text); background: var(--surface-sunken);
  padding: 3px 9px; border-radius: 6px;
}
.be-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
.be-f { display: flex; flex-direction: column; gap: 7px; font-size: 13px; color: var(--text-2); }
.be-f > span { font-weight: 500; }
.be-in, .be-ta {
  width: 100%; padding: 9px 11px;
  border: 1px solid var(--line-2); border-radius: var(--r-sm);
  background: var(--surface); color: var(--text);
  font-size: 14px; line-height: 1.65;
}
.be-in:focus, .be-ta:focus {
  outline: none; border-color: var(--gen); box-shadow: var(--ring);
}
.be-ta { min-height: 82px; resize: vertical; }
.be-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
.be-opt {
  display: flex; flex-direction: column; gap: 7px;
  padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--surface-2);
}
.be-opt-h { font-size: 13px; font-weight: 500; color: var(--text-2); }
.be-diff { max-width: 200px; margin-bottom: 20px; }
.be-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.be-hint { font-size: 12.5px; color: var(--text-3); }
.be-empty { color: var(--text-3); font-size: 14px; }
.msg { margin-top: 12px; font-size: 13px; }
.msg.ok { color: var(--ok); }
.msg.no { color: var(--err); }
@media (max-width: 760px) {
  .be-grid, .be-opts { grid-template-columns: 1fr; }
  .be-search .be-in { max-width: none; }
}
</style>
