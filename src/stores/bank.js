import { defineStore } from 'pinia'
import { applyEdit } from '../lib/edits'
import { useEdits } from './edits'

const CDN = import.meta.env.BASE_URL || '/'

/**
 * 题库 JSON 一律「先校验再用」。
 * nginx 早期给 /data/ 设了 1 小时强缓存，题库修正发布后，浏览器在缓存有效期内
 * 根本不会来问服务器，页面继续显示旧题面（出现过「说修好了但页面没变」）。
 * no-cache 会带 ETag 走条件请求：没变回 304 不费流量，变了立刻拿新文件。
 */
const DATA_FETCH = { cache: 'no-cache' }

/**
 * 题库数据仓库。
 * meta.json 描述结构树；每个级别的题目单独一个 JSON，进入该级别时才加载。
 *
 * raw / rawIndex 保存三个 q_*.json 的出厂原文（也是唯一权威源），
 * loaded 保存叠加修订后的结果 —— 修订是随时可能到位的异步数据，
 * 留着原文才能在它到达后重算出正确结果。
 *
 * 题面只有两层叠加，顺序不能乱：
 *   q_*.json 题库原文（管理员可直接在「题库原文编辑」里改写文件）
 *            → hs_edits 人工修订（管理员 / 编辑员提案，走审核与日志）
 * 原文就是修订表单、审核台、提案差分和「还原为题库原文」的基准。
 */
export const useBank = defineStore('bank', {
  state: () => ({
    meta: null,
    loading: false,
    error: '',
    /** slug -> 原始 JSON（未经修订） */
    raw: {},
    /** slug -> Map(qid -> 题库原文)，永久不变，仅用于重新计算 */
    rawIndex: {},
    /** slug -> { level, qs: [...] } 叠加人工修订后的结果 */
    loaded: {},
    /** slug -> Map(qid -> question) */
    index: {},
    /** slug -> Set(qid) 全局布尔倒排，用于搜索时的字段命中 */
    readySlugs: new Set(),
  }),

  getters: {
    levels: (s) => (s.meta ? s.meta.levels : []),
    totalCount: (s) => (s.meta ? s.meta.levels.reduce((n, l) => n + l.count, 0) : 0),
    /** 按 slug 取级别元信息 */
    levelBySlug: (s) => (slug) => (s.meta ? s.meta.levels.find((l) => l.slug === slug) : null),
    /** 已加载的全部题目（按级别顺序） */
    allQuestions(s) {
      if (!s.meta) return []
      return s.meta.levels.flatMap((l) => s.loaded[l.slug]?.qs || [])
    },
    /** 按题号取题库原文（未叠加人工修订），修订表单 / 审核台 / 提案差分以此为准 */
    original: (s) => (id) => s.rawIndex[slugOf(id)]?.get(id) || null,
    /** 按题号取当前生效题面（已叠加修订），提案的差分以它为基准 */
    effective: (s) => (id) => s.index[slugOf(id)]?.get(id) || null,
  },

  actions: {
    async fetchMeta() {
      if (this.meta || this.loading) return
      this.loading = true
      try {
        const r = await fetch(`${CDN}data/meta.json`, DATA_FETCH)
        if (!r.ok) throw new Error(`meta.json ${r.status}`)
        this.meta = await r.json()
      } catch (e) {
        this.error = String(e.message || e)
      } finally {
        this.loading = false
      }
    },

    /** 加载某个级别的题目；返回 false 表示该级别不存在 */
    async loadLevel(slug) {
      if (this.loaded[slug]) return true
      const info = this.levelBySlug(slug)
      if (!info) return false
      const r = await fetch(`${CDN}data/q_${slug}.json`, DATA_FETCH)
      if (!r.ok) throw new Error(`题库加载失败 (${r.status})`)
      const data = await r.json()
      this.raw = { ...this.raw, [slug]: data }
      this.rawIndex = { ...this.rawIndex, [slug]: new Map(data.qs.map((q) => [q.id, q])) }
      this.applyLevel(slug)
      return true
    },

    /**
     * 用当前修订数据重算某个级别的题目（loadLevel 与修订到位后都会走这里）。
     * 顺带把 level / slug 补进每题 —— 题库 JSON 只在文件顶层写了级别，
     * 而收藏夹分组、错题本统计、模考「只考错题」都按 q.level 取值。
     */
    applyLevel(slug) {
      const src = this.raw[slug]
      if (!src) return
      const edits = useEdits()
      const level = src.level || this.levelBySlug(slug)?.key || ''
      // 人工修订覆盖在题库原文之上
      const qs = src.qs.map((q) => applyEdit({ ...q, level, slug }, edits.map[q.id]))
      // 刷题页 / 模考 / 收藏夹把题目对象存进了自己的数组（list.value 等）。
      // 重算时若整数组替换，这些页面仍持有旧对象，会继续显示旧题面。
      // 题号序列不变时原地写回字段，既触发响应式更新，又不打断作答状态。
      const prevQs = this.loaded[slug]?.qs
      const sameShape = prevQs && prevQs.length === qs.length &&
        prevQs.every((q, i) => q.id === qs[i].id)
      let finalQs = qs
      if (sameShape) {
        for (let i = 0; i < prevQs.length; i++) {
          const old = prevQs[i], nw = qs[i]
          for (const k of Object.keys(old)) if (!(k in nw)) delete old[k]
          Object.assign(old, nw)
        }
        finalQs = prevQs
      }
      this.loaded = { ...this.loaded, [slug]: { ...src, qs: finalQs } }
      this.index = { ...this.index, [slug]: new Map(finalQs.map((q) => [q.id, q])) }
      this.readySlugs = new Set(this.readySlugs).add(slug)
    },

    /**
     * 修订数据发生变化时刷新所有已加载的级别。
     * 页面往往比修订先就绪，没有这一步新改的译文就不会显示出来。
     */
    reapplyAll() {
      for (const slug of Object.keys(this.raw)) this.applyLevel(slug)
    },

    /**
     * 切回前台标签页时重新校验已加载的题库。
     * 单页应用长开不刷新时，题库 JSON 只在首次进入级别时读一次；
     * 后台改了题面，用户会一直盯着旧数据，甚至以为「修复没生效」。
     * 只在文件确实变化时重算，不打扰正在进行的答题/考试状态。
     */
    async refreshAll() {
      await Promise.all(Object.keys(this.loaded).map(async (slug) => {
        try {
          const r = await fetch(`${CDN}data/q_${slug}.json`, DATA_FETCH)
          if (!r.ok) return
          const data = await r.json()
          if (JSON.stringify(data) === JSON.stringify(this.raw[slug])) return
          this.raw = { ...this.raw, [slug]: data }
          this.rawIndex = { ...this.rawIndex, [slug]: new Map(data.qs.map((q) => [q.id, q])) }
          this.applyLevel(slug)
        } catch (e) {
          console.warn('[bank] 题库刷新失败', e?.message)
        }
      }))
    },

    async ensureLoaded(ids) {
      const need = new Set()
      for (const id of ids) {
        const slug = slugOf(id)
        if (slug && !this.loaded[slug]) need.add(slug)
      }
      for (const s of need) await this.loadLevel(s)
    },

    /** 取题（跨级别），自动加载所属级别 */
    async getQuestion(id) {
      const slug = slugOf(id)
      if (!slug) return null
      if (!this.loaded[slug]) await this.loadLevel(slug)
      return this.index[slug]?.get(id) || null
    },

    /** 取某小节的题目列表 */
    async getSection(slug, secCode) {
      if (!this.loaded[slug]) await this.loadLevel(slug)
      const info = this.levelBySlug(slug)
      if (!info) return []
      // 章节码在 meta 里为大写（T1A），用户手输小写也能命中
      const want = String(secCode || '').toUpperCase()
      for (const b of info.blocks) {
        const sec = b.secs.find((x) => x.code.toUpperCase() === want)
        if (sec) {
          const m = this.index[slug]
          return sec.ids.map((id) => m.get(id)).filter(Boolean)
        }
      }
      return []
    },

    /** 全量搜索（需先 ensureLoadedAll） */
    async ensureLoadedAll() {
      if (!this.meta) await this.fetchMeta()
      for (const l of this.meta.levels) await this.loadLevel(l.slug)
    },
  },
})

/** 题号 -> slug：T1A01 -> technician, G7A09 -> general, E5C10 -> extra */
export function slugOf(id = '') {
  const c = id.charAt(0).toUpperCase()
  if (c === 'T') return 'technician'
  if (c === 'G') return 'general'
  if (c === 'E') return 'extra'
  return ''
}
