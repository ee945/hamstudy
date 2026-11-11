/** 学习数据的导出备份与导入恢复。
 * 备份是完整的 JSON（可原样导入恢复），CSV 是供表格软件查看的流水。
 */
import { EMPTY } from './records'

const SCHEMA = 'hamstudy-backup'
const VERSION = 1

/** 20261031-0932 这种紧凑时间戳，用作文件名的一部分 */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 触发浏览器下载 */
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 导出完整备份 JSON。
 * @param {object} d  study.d（attempts / favs / sessions / cleared）
 * @param {object} [who] { email, nickname, callsign }
 */
export function exportBackup(d, who = {}) {
  const payload = {
    schema: SCHEMA,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    owner: { email: who.email || '', nickname: who.nickname || '', callsign: who.callsign || '' },
    data: {
      attempts: d.attempts || [],
      favs: d.favs || [],
      sessions: d.sessions || [],
      cleared: d.cleared || [],
    },
  }
  const name = `hamstudy-backup-${stamp()}.json`
  download(name, JSON.stringify(payload, null, 2), 'application/json')
  return name
}

const CSV_ESC = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 导出答题流水 CSV：一行一次作答 */
export function exportAttemptsCsv(attempts = []) {
  const head = ['时间', '题号', '级别', '小节', '结果', '模式']
  const rows = [...attempts]
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map((a) => [
      new Date(a.ts).toLocaleString('zh-CN', { hour12: false }),
      a.qid, a.level, a.sec, a.ok ? '正确' : '错误', a.mode || 'browse',
    ])
  const csv = `﻿${[head, ...rows].map((r) => r.map(CSV_ESC).join(',')).join('\r\n')}`
  const name = `hamstudy-attempts-${stamp()}.csv`
  download(name, csv, 'text/csv;charset=utf-8')
  return name
}

/** 导出模考记录 CSV：一行一场考试 */
export function exportExamsCsv(sessions = []) {
  const head = ['时间', '级别', '得分', '总题', '正确率', '用时(分)', '模式']
  const rows = [...sessions]
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map((s) => [
      new Date(s.ts).toLocaleString('zh-CN', { hour12: false }),
      s.level,
      s.correct,
      s.total,
      s.total ? `${Math.round((s.correct / s.total) * 100)}%` : '-',
      Math.round((s.durationSec || 0) / 60),
      s.mode || 'exam',
    ])
  const csv = `﻿${[head, ...rows].map((r) => r.map(CSV_ESC).join(',')).join('\r\n')}`
  const name = `hamstudy-exams-${stamp()}.csv`
  download(name, csv, 'text/csv;charset=utf-8')
  return name
}

/**
 * 解析备份文件。
 * @returns {Promise<{ok:boolean, data?:object, error?:string}>}
 */
export function parseBackup(file) {
  return new Promise((resolve) => {
    const fr = new FileReader()
    fr.onerror = () => resolve({ ok: false, error: '文件读取失败' })
    fr.onload = () => {
      try {
        const j = JSON.parse(String(fr.result))
        if (j?.schema !== SCHEMA) {
          resolve({ ok: false, error: '这不是 HamStudy 的备份文件' })
          return
        }
        const d = { ...EMPTY, ...(j.data || {}) }
        for (const k of ['attempts', 'favs', 'sessions', 'cleared']) {
          if (!Array.isArray(d[k])) d[k] = []
        }
        d.cleared = d.cleared.filter((x) => typeof x === 'string')
        resolve({ ok: true, data: d, exportedAt: j.exportedAt, owner: j.owner })
      } catch {
        resolve({ ok: false, error: 'JSON 解析失败，文件可能已损坏' })
      }
    }
    fr.readAsText(file)
  })
}
