import { defineStore } from 'pinia'
import { pb } from '../lib/pb'
import { useUser } from './user'

const COL = 'hs_edit_logs'

/** 当前账号在日志里的展示名：昵称 > 呼号 > 邮箱前缀 */
export function displayName(u) {
  if (!u) return '未知用户'
  return u.nickname || u.callsign || String(u.email || '').split('@')[0] || '用户'
}

/**
 * 修订日志：记录编辑员与管理员的每一次修订操作。
 * 公开给所有登录用户读取（贡献榜），写入由 API 规则限制：
 * 只能记在自己名下、编辑员只能写 submit、管理员只能写管理类动作。
 */
export const useLogs = defineStore('logs', {
  state: () => ({
    items: [],
    loaded: false,
    loading: false,
    error: '',
  }),

  getters: {
    /** 按时间倒序 */
    sorted: (s) => [...s.items].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))),
  },

  actions: {
    async load() {
      if (this.loading) return
      this.loading = true
      try {
        const all = []
        let page = 1
        for (;;) {
          const r = await pb.collection(COL).getList(page, 500, { sort: '-at' })
          all.push(...r.items)
          if (page >= r.totalPages || !r.items.length) break
          page += 1
        }
        this.items = all
        this.error = ''
      } catch (e) {
        this.error = String(e?.message || e)
        console.warn('[logs] 修订日志加载失败', e)
      } finally {
        this.loading = false
        this.loaded = true
      }
    },

    /**
     * 写一条日志。刻意不抛错 —— 日志是附属记录，绝不能因为写日志失败
     * 就让已经成功的「提交 / 审核 / 保存」看起来像失败了。
     * @param {object} e { qid, level, sec, action, fields, note, contributor, contributorName, pendingId }
     */
    async add(e = {}) {
      const u = useUser().user
      if (!u) return null
      const body = {
        qid: e.qid || '',
        level: e.level || '',
        sec: e.sec || '',
        userId: u.id,
        userName: displayName(u),
        userRole: u.role || '',
        action: e.action || '',
        fields: e.fields || [],
        summary: e.summary || '',
        note: e.note || '',
        contributor: e.contributor || '',
        contributorName: e.contributorName || '',
        pendingId: e.pendingId || '',
        at: new Date().toISOString(),
      }
      try {
        const rec = await pb.collection(COL).create(body)
        this.items = [rec, ...this.items]
        return rec
      } catch (err) {
        console.warn('[logs] 写入失败（不影响主操作）', err)
        return null
      }
    },
  },
})
