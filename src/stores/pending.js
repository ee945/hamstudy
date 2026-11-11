import { defineStore } from 'pinia'
import { pb } from '../lib/pb'
import {
  toProposal, mergeProposal, fieldSummary,
} from '../lib/edits'
import { useUser } from './user'
import { useEdits } from './edits'
import { useBank } from './bank'
import { useLogs, displayName } from './logs'

const COL = 'hs_pending'
const NO_SUBMIT = '只有编辑员或管理员能提交修订提案'
const NO_REVIEW = '只有管理员能审核提案'

/** 状态空串即待审（API 规则靠 status = "" 判定，前端不发这个字段） */
const isPending = (p) => !p.status || p.status === 'pending'

/**
 * 编辑员提案 + 管理员审核。
 * 提案存在 hs_pending，审核通过时才由 mergeProposal 合并进生效层 hs_edits，
 * 所以编辑员的改动在管理员点「通过」之前，全站题面一点都不会变。
 */
export const usePending = defineStore('pending', {
  state: () => ({
    items: [],
    loaded: false,
    loading: false,
    saving: false,
    error: '',
  }),

  getters: {
    /** 待审列表（管理员看全部，编辑员看自己的） */
    waiting: (s) => s.items.filter(isPending).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))),
    /** 已处理的历史 */
    done: (s) => s.items.filter((p) => !isPending(p)).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))),
    count: (s) => s.items.filter(isPending).length,
    /** 某题是否已有我提交的待审提案 */
    of: (s) => (qid) => s.items.find((p) => p.qid === qid && isPending(p)) || null,
  },

  actions: {
    async load() {
      if (!useUser().canMaintain || this.loading) return
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
        console.warn('[pending] 待审列表加载失败', e)
      } finally {
        this.loading = false
        this.loaded = true
      }
    },

    /**
     * 编辑员提交 / 更新提案。同一道题重复提交会更新原有待审项，不堆重复记录。
     * @param {object} opts { q: 当前生效题面（差分基准）, level, sec }
     */
    async submit(qid, form, opts = {}) {
      const u = useUser()
      if (!u.isEditor && !u.isAdmin) {
        this.error = NO_SUBMIT
        return { ok: false, error: NO_SUBMIT }
      }
      this.saving = true
      this.error = ''
      try {
        const proposal = toProposal(form, opts.q)
        if (!proposal.fields.length && !proposal.note) {
          return { ok: false, error: '没有改动可提交，先把要改的内容填上' }
        }
        const body = {
          qzh: proposal.qzh, optzh: proposal.optzh,
          mnem: proposal.mnem, expl: proposal.expl,
          fields: proposal.fields, note: proposal.note,
          at: new Date().toISOString(),
        }
        const mine = this.items.find(
          (p) => p.qid === qid && isPending(p) && p.author === u.user.id
        )
        const rec = mine
          ? await pb.collection(COL).update(mine.id, body)
          : await pb.collection(COL).create({
              qid, level: opts.level || '', sec: opts.sec || '',
              author: u.user.id, authorName: displayName(u.user),
              ...body,
            })
        this.items = [rec, ...this.items.filter((p) => p.id !== rec.id)]
        await useLogs().add({
          qid, level: opts.level, sec: opts.sec,
          action: 'submit', fields: proposal.fields,
          summary: fieldSummary(proposal.fields), note: proposal.note,
          pendingId: rec.id,
        })
        return { ok: true, record: rec }
      } catch (e) {
        this.error = translate(e)
        return { ok: false, error: this.error }
      } finally {
        this.saving = false
      }
    },

    /**
     * 管理员审核通过：合并进 hs_edits（此刻才生效）→ 标记提案 → 记日志。
     * @param {object} item hs_pending 记录
     * @param {object} proposal 最终的提案差分（管理员协助修改后重算过）
     * @param {object} opts { assisted: 是否协助修改过, reviewNote }
     */
    async approve(item, proposal, opts = {}) {
      if (!useUser().isAdmin) {
        this.error = NO_REVIEW
        return { ok: false, error: NO_REVIEW }
      }
      this.saving = true
      this.error = ''
      try {
        const bank = useBank()
        const edits = useEdits()
        const orig = bank.original(item.qid)
        const body = mergeProposal(edits.map[item.qid], proposal, orig)
        const r = await edits.merge(item.qid, body, { level: item.level, sec: item.sec })
        if (!r.ok) {
          this.error = r.error
          return r
        }

        const patch = {
          qzh: proposal.qzh || '', optzh: proposal.optzh || [],
          mnem: proposal.mnem || '', expl: proposal.expl || '',
          fields: proposal.fields, note: proposal.note,
          status: 'approved',
          reviewer: useUser().user.id,
          reviewNote: opts.reviewNote || '',
        }
        const rec = await pb.collection(COL).update(item.id, patch)
        this.items = this.items.map((p) => (p.id === item.id ? rec : p))

        await useLogs().add({
          qid: item.qid, level: item.level, sec: item.sec,
          action: opts.assisted ? 'assist' : 'approve',
          fields: proposal.fields, summary: fieldSummary(proposal.fields),
          note: proposal.note,
          contributor: item.author, contributorName: item.authorName,
          pendingId: item.id,
        })
        return { ok: true, cleared: r.cleared }
      } catch (e) {
        this.error = translate(e)
        return { ok: false, error: this.error }
      } finally {
        this.saving = false
      }
    },

    /** 管理员驳回：题面不动，提案留档 */
    async reject(item, reviewNote = '') {
      if (!useUser().isAdmin) {
        this.error = NO_REVIEW
        return { ok: false, error: NO_REVIEW }
      }
      this.saving = true
      this.error = ''
      try {
        const rec = await pb.collection(COL).update(item.id, {
          status: 'rejected', reviewer: useUser().user.id, reviewNote,
        })
        this.items = this.items.map((p) => (p.id === item.id ? rec : p))
        await useLogs().add({
          qid: item.qid, level: item.level, sec: item.sec,
          action: 'reject', fields: item.fields || [],
          summary: fieldSummary(item.fields), note: reviewNote,
          contributor: item.author, contributorName: item.authorName,
          pendingId: item.id,
        })
        return { ok: true }
      } catch (e) {
        this.error = translate(e)
        return { ok: false, error: this.error }
      } finally {
        this.saving = false
      }
    },

    /** 编辑员撤下自己尚未审核的提案 */
    async withdraw(item) {
      this.saving = true
      this.error = ''
      try {
        await pb.collection(COL).delete(item.id)
        this.items = this.items.filter((p) => p.id !== item.id)
        await useLogs().add({
          qid: item.qid, level: item.level, sec: item.sec,
          action: 'withdraw', fields: item.fields || [],
          summary: fieldSummary(item.fields), note: item.note,
          pendingId: item.id,
        })
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

function translate(e) {
  const msg = String(e?.message || e)
  const s = e?.status
  if (s === 401 || s === 403) return '登录状态已失效，请重新登录'
  if (s === 404) return '这条提案已不存在，刷新后再试'
  if (s === 0 || /failed to fetch/i.test(msg)) return '连不上后端，提案没提交上去'
  if (s === 400) return '提交的内容有问题，请检查后重试'
  return msg || '操作失败'
}
