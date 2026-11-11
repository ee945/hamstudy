/**
 * 题库修订层的数据整形。
 *
 * 一条修订记录对应一道题，只保存「被改过的字段」——
 * 空串 / 空数组 / 0 都表示「沿用题库原文」，不占空间也不会覆盖原文。
 *
 * 三级角色的字段边界也定义在这里：编辑员只能提交「中文翻译 / 要点 / 解析」，
 * 英文原题（qen / opten）与难度（diff）只归管理员。提案集合 hs_pending
 * 干脆不放这几个字段，越权写入在结构上就不成立，而不是只靠界面隐藏输入框。
 */
export const EDITOR_FIELDS = ['qzh', 'optzh', 'mnem', 'expl']

/** 字段 -> 中文名（审核台与修订日志共用） */
export const FIELD_LABELS = {
  qzh: '中文题干', qen: '英文题干', optzh: '中文选项', opten: '英文选项',
  mnem: '记忆要点', expl: '题目解析', diff: '难度',
}

/** 修订日志的动作名 */
export const ACTION_LABELS = {
  submit: '提交提案', withdraw: '撤下提案', direct: '直接修订',
  approve: '审核通过', assist: '协助修改', reject: '驳回', revert: '还原',
}

export const ROLE_LABELS = { admin: '管理员', editor: '编辑员', '': '普通用户' }

const clean = (v) => String(v ?? '').trim()
const arr = (v) => (Array.isArray(v) ? v.map((x) => clean(x)) : [])

/** 修订记录的文本字段 -> 题目字段 */
export const SCALAR_FIELDS = [
  ['qzh', 'qZh'],
  ['qen', 'qEn'],
  ['mnem', 'mnem'],
  ['expl', 'expl'],
]

/** 修订记录的数组字段 -> 题目字段 */
export const ARRAY_FIELDS = [
  ['optzh', 'optZh'],
  ['opten', 'optEn'],
]

/** 记录里这个字段是否真有内容。空串 / 全空数组 / 0 都算「没改」 */
export function hasEdit(v) {
  if (v == null) return false
  if (Array.isArray(v)) return v.some((x) => clean(x))
  if (typeof v === 'number') return v > 0
  return !!clean(v)
}

/** 一条修订覆盖了多少个字段 */
export function editedCount(e) {
  if (!e) return 0
  const keys = [...SCALAR_FIELDS, ...ARRAY_FIELDS].map(([k]) => k).concat('diff')
  return keys.filter((k) => hasEdit(e[k])).length
}

/** 一条修订是否为「空壳」（没有任何实质改动） */
export function isBlank(e) {
  return editedCount(e) === 0 && !clean(e?.note)
}

/** 把一条修订叠到题目上，返回新对象（不改原对象） */
export function applyEdit(q, e) {
  if (!q || !e) return q
  const out = { ...q }
  let n = 0
  for (const [k, qk] of SCALAR_FIELDS) {
    if (hasEdit(e[k])) {
      out[qk] = clean(e[k])
      n += 1
    }
  }
  for (const [k, qk] of ARRAY_FIELDS) {
    const v = arr(e[k])
    if (v.length) {
      out[qk] = v
      n += 1
    }
  }
  if (hasEdit(e.diff)) {
    out.diff = Number(e.diff)
    n += 1
  }
  out._rev = n > 0
  out._revCount = n
  return out
}

const pick = (edited, original) => (hasEdit(edited) ? clean(edited) : clean(original))

/** 编辑表单的初始值：有修订用修订，否则用题库原文 */
export function toForm(q, e) {
  const b = q || {}
  const zh = arr(e?.optzh)
  const en = arr(e?.opten)
  return {
    qzh: pick(e?.qzh, b.qZh),
    qen: pick(e?.qen, b.qEn),
    optzh: zh.length ? zh : arr(b.optZh),
    opten: en.length ? en : arr(b.optEn),
    mnem: pick(e?.mnem, b.mnem),
    expl: pick(e?.expl, b.expl),
    diff: hasEdit(e?.diff) ? Number(e.diff) : Number(b.diff) || 0,
    note: clean(e?.note),
  }
}

const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * 表单值 -> 待保存的记录体。
 * 只保留与题库原文不同的字段，改回原文即视为撤消该字段。
 */
export function toRecord(form, q) {
  const b = q || {}
  const out = { qzh: '', qen: '', mnem: '', expl: '', optzh: [], opten: [], diff: 0, note: clean(form?.note) }

  for (const [k, qk] of SCALAR_FIELDS) {
    const v = clean(form?.[k])
    if (v && v !== clean(b[qk])) out[k] = v
  }
  for (const [k, qk] of ARRAY_FIELDS) {
    const v = arr(form?.[k])
    if (v.length && v.some((x) => clean(x)) && !sameArr(v, arr(b[qk]))) out[k] = v
  }
  const d = Number(form?.diff) || 0
  if (d > 0 && d !== (Number(b.diff) || 0)) out.diff = d

  return out
}

/** 表单值相对原文改了多少个字段（用于界面上的「已改 n 处」） */
export function formChanged(form, q) {
  if (!q) return 0
  const r = toRecord(form, q)
  return editedCount(r)
}

/* ------------------------------------------------------------------ *
 * 编辑员提案（hs_pending）
 * ------------------------------------------------------------------ */

/**
 * 表单 -> 提案的差分。注意比较基准是「当前生效题面」（可能已叠加管理员的修订），
 * 不是题库原文 —— 编辑员没碰的字段不该被算成他改的，管理员此前的改动也不能
 * 被一次无关的提案悄悄覆盖。
 */
export function toProposal(form, effective) {
  const r = toRecord(form, effective)
  const out = { note: clean(form?.note) }
  const fields = []
  for (const k of EDITOR_FIELDS) {
    out[k] = r[k]                  // 空串 / 空数组 = 未改
    if (hasEdit(r[k])) fields.push(k)
  }
  out.fields = fields
  return out
}

const QKEY = { qzh: 'qZh', optzh: 'optZh', mnem: 'mnem', expl: 'expl' }

/**
 * 把一份提案合并成 hs_edits 的记录体（相对「题库原文」的差分）。
 *   - 提案改了的字段：写进去；若新值恰好等于题库原文，则清空（等于撤消该字段）
 *   - 提案没提的字段：保留现有修订（管理员改过的英文原题、难度不受影响）
 */
export function mergeProposal(existing, proposal, orig) {
  const out = {
    qzh: clean(existing?.qzh), qen: clean(existing?.qen),
    optzh: arr(existing?.optzh), opten: arr(existing?.opten),
    mnem: clean(existing?.mnem), expl: clean(existing?.expl),
    diff: Number(existing?.diff) || 0,
    note: clean(existing?.note),
    at: new Date().toISOString(),
  }
  for (const k of EDITOR_FIELDS) {
    if (!(proposal?.fields || []).includes(k)) continue
    const v = proposal[k]
    const ov = orig?.[QKEY[k]]
    if (k === 'optzh') {
      const a = arr(v)
      out[k] = JSON.stringify(a) === JSON.stringify(arr(ov)) ? [] : a
    } else {
      const s = clean(v)
      out[k] = s === clean(ov) ? '' : s
    }
  }
  if (clean(proposal?.note)) out.note = clean(proposal.note)
  return out
}

/** 字段名数组 -> 中文短描述，日志与审核台用 */
export function fieldSummary(fields) {
  return (fields || []).map((k) => FIELD_LABELS[k] || k).join('、') || '仅备注'
}
