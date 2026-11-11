import { defineStore } from 'pinia'
import {
  loadLocal, saveLocal, merge, pullRemote, pushNew, removeFavRemote,
  loadGuest, clearGuest, wipeRemote, newId, EMPTY,
} from '../lib/records'
import { WRONG_TARGET, replay } from '../lib/wrongScore'

export { WRONG_TARGET }

/** 推送队列。并发推送会让同一批未同步记录被发出好几次，
 * 所以这里把所有推送串成一条链：上一次彻底结束后才开始下一次。 */
let flushChain = Promise.resolve()

/** 学习数据：答题流水 / 收藏 / 考试记录 / 错题本。
 * 未登录时纯本地；登录后本地为缓存、云端为真相源，写入后增量推送。
 */
export const useStudy = defineStore('study', {
  state: () => ({
    uid: null,
    hydrated: false,
    syncing: false,
    lastSyncAt: 0,
    d: { ...EMPTY },
    /** 最近一次「游客进度并入账号」的结果，用于界面提示 */
    lastMerge: null,
    /** 最近一次清空的结果 */
    lastWipe: null,
    /** 最近一次导入备份的结果 */
    lastImport: null,
  }),

  getters: {
    attempts: (s) => s.d.attempts,
    favs: (s) => s.d.favs,
    sessions: (s) => s.d.sessions,

    /** 各类数据的条数，用于清空/导入前后的对比提示 */
    counts: (s) => ({
      attempts: s.d.attempts.length,
      favs: s.d.favs.length,
      sessions: s.d.sessions.length,
      cleared: s.d.cleared.length,
    }),

    /** qid -> 最近一条 attempt */
    lastOf(s) {
      const m = new Map()
      for (const a of s.d.attempts) {
        const cur = m.get(a.qid)
        if (!cur || a.ts >= cur.ts) m.set(a.qid, a)
      }
      return m
    },

    isFav: (s) => (qid) => s.d.favs.some((f) => f.qid === qid),

    /** qid -> 掌握积分（0…WRONG_TARGET） */
    wrongScore(s) {
      return replay(s.d.attempts).score
    },

    /** 错题本：曾答错、尚未积满 WRONG_TARGET 次，且未手动标记掌握 */
    wrongList(s) {
      const { score, wrongSeen, last } = replay(s.d.attempts)
      const cleared = new Set(s.d.cleared)
      const out = []
      for (const qid of wrongSeen) {
        if (cleared.has(qid)) continue
        const sc = score.get(qid) || 0
        if (sc >= WRONG_TARGET) continue
        const a = last.get(qid)
        out.push({
          qid,
          level: a.level,
          sec: a.sec,
          ts: a.ts,
          score: sc,
          need: WRONG_TARGET,
          wrongCount: s.d.attempts.filter((x) => x.qid === qid && !x.ok).length,
        })
      }
      return out.sort((x, y) => y.ts - x.ts)
    },

    /** sec -> { done, correct, rate } */
    mastery(s) {
      const m = new Map()
      for (const a of s.d.attempts) {
        const o = m.get(a.sec) || { done: 0, correct: 0, last: 0 }
        o.done += 1
        if (a.ok) o.correct += 1
        if (a.ts > o.last) o.last = a.ts
        m.set(a.sec, o)
      }
      for (const [, v] of m) v.rate = v.done ? v.correct / v.done : 0
      return m
    },

    /** 总体统计 */
    stats(s) {
      const n = s.d.attempts.length
      let ok = 0
      const days = new Set()
      for (const a of s.d.attempts) {
        if (a.ok) ok++
        days.add(new Date(a.ts).toDateString())
      }
      // 连续天数
      let streak = 0
      const cur = new Date()
      for (let i = 0; i < 400; i++) {
        const key = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - i).toDateString()
        if (days.has(key)) streak++
        else if (i > 0) break
      }
      return {
        total: n,
        correct: ok,
        accuracy: n ? Math.round((ok / n) * 100) : 0,
        days: days.size,
        streak,
        wrongCount: s.d.attempts.filter((a) => !a.ok).length,
        favCount: s.d.favs.length,
        examCount: s.d.sessions.length,
      }
    },
  },

  actions: {
    /** 切换数据源（登录/登出时调用）。
     * 登录时会把未登录期间攒下的进度并入账号，再推上云端。 */
    async hydrate(uid) {
      this.uid = uid || null
      this.d = loadLocal(this.uid)
      this.hydrated = true

      if (!this.uid) return
      const guest = loadGuest()
      if (guest) {
        this.d = merge(this.d, guest)
        this.persist()
        this.lastMerge = {
          attempts: guest.attempts.length,
          favs: guest.favs.length,
          sessions: guest.sessions.length,
          ts: Date.now(),
        }
        // 数据已落进账号的本地缓存，后续同步会推上云端；游客副本可以清掉了
        clearGuest()
      }
      await this.sync()
    },

    async sync() {
      if (!this.uid || this.syncing) return
      this.syncing = true
      try {
        const remote = await pullRemote(this.uid)
        const merged = merge(this.d, remote)
        // 远端已存在的记录打上已同步标记
        const remoteIds = new Set(remote.attempts.map((r) => r.id))
        for (const a of merged.attempts) if (remoteIds.has(a.id)) a._synced = true
        const remoteFavIds = new Set(remote.favs.map((r) => r.qid))
        for (const f of merged.favs) if (remoteFavIds.has(f.qid)) f._synced = true

        this.d = merged
        this.persist()
        await this.flush()
        this.lastSyncAt = Date.now()
      } finally {
        this.syncing = false
      }
    },

    persist() {
      saveLocal(this.uid, this.d)
    },

    /** 把未同步的记录推上云端（串行，重复调用不会重复发） */
    flush() {
      if (!this.uid) return Promise.resolve()
      flushChain = flushChain
        .then(() => pushNew(this.uid, this.d))
        .then(() => this.persist())
        .catch(() => {})
      return flushChain
    },

    /** 记录一次作答。silent=true 时只写本地，稍后由调用方统一 flush */
    record(q, ok, mode = 'browse', silent = false) {
      const rec = {
        id: newId(),
        qid: q.id,
        level: q.level,
        sec: q.sec,
        ok: !!ok,
        mode,
        ts: Date.now(),
        _synced: false,
      }
      this.d.attempts.push(rec)
      // 又答错了：把手动标记过「已掌握」的题重新拉回错题本
      if (!ok && this.d.cleared.includes(q.id)) {
        this.d.cleared = this.d.cleared.filter((x) => x !== q.id)
      }
      this.persist()
      if (!silent) this.flush()
      return rec
    },

    /** 批量记录（交卷时用）：只推一次，避免 N 条记录触发 N 轮同步 */
    recordMany(items) {
      for (const it of items) this.record(it.q, it.ok, it.mode || 'browse', true)
      this.flush()
    },

    async toggleFav(q) {
      const exist = this.d.favs.find((f) => f.qid === q.id)
      if (exist) {
        this.d.favs = this.d.favs.filter((f) => f.qid !== q.id)
        if (this.uid) removeFavRemote(this.uid, q.id)
      } else {
        this.d.favs.push({
          id: newId(), qid: q.id, level: q.level, sec: q.sec, ts: Date.now(), _synced: false,
        })
      }
      this.persist()
      this.flush()
      return !exist
    },

    /** 标记为已掌握，移出错题本 */
    markCleared(qid) {
      if (!this.d.cleared.includes(qid)) this.d.cleared.push(qid)
      this.persist()
    },

    async saveSession(payload) {
      const rec = {
        id: newId(),
        level: payload.level,
        total: payload.total,
        correct: payload.correct,
        durationSec: payload.durationSec,
        mode: payload.mode || 'exam',
        detail: payload.detail || [],
        ts: Date.now(),
        _synced: false,
      }
      this.d.sessions.push(rec)
      this.persist()
      this.flush()
      return rec
    },

    /** 清空学习数据，从头再来。
     * 未登录只清本机；已登录连云端记录一起删，避免下次同步又被拉回来。 */
    async wipeAll() {
      const uid = this.uid
      this.d = { ...EMPTY }
      this.persist()
      let remote = 0
      if (uid) remote = await wipeRemote(uid)
      this.lastWipe = { remote, ts: Date.now() }
      return this.lastWipe
    },

    /** 从备份 JSON 恢复。与现有数据合并：同 id 保留较新的一份，不覆盖不删除。 */
    async importBackup(data) {
      const inc = {
        attempts: Array.isArray(data?.attempts) ? data.attempts : [],
        favs: Array.isArray(data?.favs) ? data.favs : [],
        sessions: Array.isArray(data?.sessions) ? data.sessions : [],
        cleared: Array.isArray(data?.cleared) ? data.cleared : [],
      }
      const before = { ...this.counts }
      for (const a of inc.attempts) a._synced = !!a._synced
      this.d = merge(this.d, inc)
      this.persist()
      if (this.uid) await this.flush()
      const after = this.counts
      this.lastImport = {
        ts: Date.now(),
        got: inc.attempts.length + inc.favs.length + inc.sessions.length + inc.cleared.length,
        added:
          after.attempts - before.attempts + after.favs - before.favs +
          after.sessions - before.sessions,
      }
      return this.lastImport
    },
  },
})
