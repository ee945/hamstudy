/**
 * 题库原文文件（三个 q_*.json + meta.json）的直写与备份。
 *
 * 这三个 JSON 是本站唯一权威数据源，不再与任何 Excel 总表关联。
 * 保存由 PocketBase 的 /bank/write 路由落盘（仅站点 admin / 超管可用），
 * 同时更新 public/data 与 dist/data，因此点保存线上立即生效。
 *
 * 这一层不写 hs_edits / hs_edit_logs / hs_pending，不产生修订记录与历史版本；
 * 编辑员的正常修订仍走题库维护的提案审核流，独立叠加在原文之上并保留日志。
 */
import { pb } from './pb'

const BASE = import.meta.env.BASE_URL || '/'
export const BANK_SCHEMA = 'hamstudy-bank-backup'
export const BANK_FILES = [
  'meta.json', 'q_technician.json', 'q_general.json', 'q_extra.json',
]

async function post(payload) {
  const r = await fetch(`${pb.baseURL}/bank/write`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: pb.authStore.token || '',
    },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data.ok) {
    throw new Error(data.error || data.message || `保存失败 (${r.status})`)
  }
  return data
}

/** 把一道题的原文写回 q_*.json。fields 只接受 qZh/qEn/optZh/optEn/mnem/expl/diff */
export function saveBankQuestion(qid, fields) {
  return post({ qid, fields })
}

/** 用导出的备份覆盖服务端题库文件（不可撤销，调用前必须二次确认） */
export function restoreBankBackup(backup) {
  return post({ action: 'restore', kind: backup.kind, files: backup.files })
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 导出题库备份：把四个权威 JSON 原样打包成单个文件。
 * 站点 / 数据库故障后，用「从题库备份恢复」上传即可重建；
 * 也可以把 files 里的对象分别放回 public/data 再 npm run build。
 */
export async function exportBankBackup() {
  const files = {}
  for (const name of BANK_FILES) {
    const r = await fetch(`${BASE}data/${name}`, { cache: 'no-cache' })
    if (!r.ok) throw new Error(`${name} 读取失败 (${r.status})`)
    files[name] = await r.json()
  }
  const payload = {
    kind: BANK_SCHEMA,
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'HamStudy 题库原文备份。三个 q_*.json 与 meta.json 是唯一权威数据源，' +
      '与任何 Excel 总表无关。可在「进度 → 数据管理」里用本文件一键恢复，' +
      '或把 files 内各对象分别放回 public/data 后执行 npm run build。',
    files,
  }
  const name = `hamstudy-bank-${stamp()}.json`
  download(name, JSON.stringify(payload))
  return name
}

/** 校验并读取备份文件，返回可交给 restoreBankBackup 的对象 */
export async function parseBankBackup(file) {
  let data
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('文件不是合法的 JSON')
  }
  if (data?.kind !== BANK_SCHEMA || !data.files || typeof data.files !== 'object') {
    throw new Error('不是有效的题库备份文件')
  }
  return data
}

/** 备份里实际包含的权威文件名，用于恢复前的二次确认文案 */
export function backupFileNames(backup) {
  return BANK_FILES.filter((n) => Object.prototype.hasOwnProperty.call(backup.files, n))
}
