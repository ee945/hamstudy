import { defineStore } from 'pinia'
import { pb } from '../lib/pb'
import { toRecord, editedCount, hasEdit, fieldSummary, FIELD_LABELS } from '../lib/edits'
import { useUser } from './user'
import { useLogs } from './logs'

const COL = 'hs_edits'
const NO_RIGHT = '只有题库管理员能直接改题库。编辑员请提交提案，等管理员审核通过'

/**
 * 题库修订数据（生效层）。
 * 一条记录对应一道题，只保存「被改过的字段」，空表示沿用题库原文。
 * 公开读取（译文属于题面），只有 role = 'admin' 的账号可直接写；
 * 编辑员的改动先落到 hs_pending，审核通过后才由 pending.approve() 合并进来。
 */
export const useEdits = defineStore('edits', {
  state: () => ({
    map: {},        // qid -> PB 记录
    loaded: false,
    saving: false,
    error: '',
    savedAt: 0,     // 最近一次写成功的时间戳（App.vue 据此重算题库）
    savedQid: '',   // 最近一次改过的题号
  }),

  getters: {
    count: (s) => Object.keys(s.map).length,
    revisedIds: (s) => Object.keys(s.map),
    of: (s) => (qid) => s.map[qid] || null,
    countOf: (s) => (qid) => editedCount(s.map[qid]),
  },

  actions: {
    /** 拉全部修订。改动条目很少，分页一次拉完即可 */
    async load() {
      if (this.loading) return
      this.loading = true
      try {
        const all = []
        let page = 1
        for (;;) {
          const r = await pb.collection(COL).getList(page, 500, { sort: 'qid' })
          all.push(...r.items)
          if (page >= r.totalPages || !r.items.length) break
          page += 1
        }
        this.map = Object.fromEntries(all.map((e) => [e.qid, e]))
        this.error = ''
      } catch (e) {
        // 修订是增强层，读不到就让题库照常可用，绝不拖垮刷题
        this.error = String(e?.message || e)
        console.warn('[edits] 修订加载失败', e)
      } finally {
        this.loading = false
        this.loaded = true
      }
    },

    /**
     * 把一条已经算好的差分写入生效层（内部公共实现）。
     * 与原文完全一致 == 不需要修订了，撤掉记录而不是留一条空壳。
     */
    async write(qid, body, opts = {}) {
      const exist = this.map[qid]
      const blank = editedCount(body) === 0 && !body.note
      body.at = new Date().toISOString()

      if (blank) {
        if (exist) await pb.collection(COL).delete(exist.id)
        this.map = omit(this.map, qid)
      } else {
        const rec = exist
          ? await pb.collection(COL).update(exist.id, body)
          : await pb.collection(COL).create({
              qid, level: opts.level || '', sec: opts.sec || '', ...body,
            })
        this.map = { ...this.map, [qid]: rec }
      }
      this.savedQid = qid
      this.savedAt = Date.now()
      return { ok: true, cleared: blank, existed: !!exist }
    },

    /** 管理员直接修订：立即生效，并记一条直接修订日志 */
    async save(qid, form, opts = {}) {
      if (!useUser().isAdmin) {
        this.error = NO_RIGHT
        return { ok: false, error: NO_RIGHT }
      }
      this.saving = true
      this.error = ''
      try {
        const body = toRecord(form, opts.q)
        const exist = this.map[qid]
        const r = await this.write(qid, body, opts)
        if (r.existed || !r.cleared) {
          const fields = Object.keys(FIELD_LABELS).filter((k) => hasEdit(body[k]))
          await useLogs().add({
            qid, level: opts.level, sec: opts.sec,
            action: r.cleared ? 'revert' : 'direct',
            fields, summary: fieldSummary(fields), note: body.note,
          })
        }
        return { ok: true, cleared: r.cleared }
      } catch (e) {
        this.error = translate(e)
        return { ok: false, error: this.error }
      } finally {
        this.saving = false
      }
    },

    /**
     * 审核通过时把提案合并进生效层。body 由 lib/edits.mergeProposal() 算好，
     * 日志由 pending.approve() 统一记录（要带上提案作者，才算得清贡献）。
     */
    async merge(qid, body, opts = {}) {
      if (!useUser().isAdmin) {
        this.error = NO_RIGHT
        return { ok: false, error: NO_RIGHT }
      }
      this.saving = true
      this.error = ''
      try {
        return await this.write(qid, body, opts)
      } catch (e) {
        this.error = translate(e)
        return { ok: false, error: this.error }
      } finally {
        this.saving = false
      }
    },

    /** 撤消一题的全部修订，回到题库原文 */
    async revert(qid) {
      if (!useUser().isAdmin) {
        this.error = NO_RIGHT
        return { ok: false, error: NO_RIGHT }
      }
      this.saving = true
      this.error = ''
      try {
        const exist = this.map[qid]
        if (exist) await pb.collection(COL).delete(exist.id)
        this.map = omit(this.map, qid)
        this.savedQid = qid
        this.savedAt = Date.now()
        await useLogs().add({ qid, action: 'revert', fields: [], summary: '还原为题库原文' })
        return { ok: true }
      } catch (e) {
        this.error = translate(e)
        return { ok: false, error: this.error }
      } finally {
        this.saving = false
      }
    },
  },
})

function omit(map, qid) {
  const rest = { ...map }
  delete rest[qid]
  return rest
}

/** 写失败的文案要说清下一步该做什么 */
function translate(e) {
  const msg = String(e?.message || e)
  const s = e?.status
  if (s === 401 || s === 403 || /not authorized|missing auth/i.test(msg)) {
    return '需要登录才能修改题库'
  }
  if (s === 404) return '这条修订已不存在，刷新后再试'
  if (/unique/i.test(msg)) return '该题已有修订记录，刷新页面后再改'
  if (s === 0 || /failed to fetch|networkerror/i.test(msg)) return '连不上后端，修订没保存上去'
  if (s === 400) return '提交的内容有问题，请检查后重试'
  return msg || '保存失败'
}
