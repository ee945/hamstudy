import { defineStore } from 'pinia'

const K = 'hamstudy:ui'

/** 界面偏好（跨会话保留） */
export const useUI = defineStore('ui', {
  state: () => ({
    /**
     * 是否显示中文辅助译文。
     * 真实 FCC 考试为英文出题，因此默认关闭——首屏即考试视角，
     * 需要看中文时手动开启（按钮或回车键）。
     * 关闭时仅显示英文，不存在「纯中文」模式。
     */
    showZh: false,
    /** 背题时是否即时显示答案 */
    revealAnswer: false,
    /** 是否显示解析 */
    showExpl: true,
    navOpen: false,
  }),
  actions: {
    load() {
      try {
        const raw = localStorage.getItem(K)
        if (!raw) return
        const d = JSON.parse(raw)
        // 迁移：旧版本存的是 langMode 三态（both/zh/en），只有 both 与 zh 含中文
        if (d.langMode !== undefined) {
          this.showZh = d.langMode === 'both' || d.langMode === 'zh'
        }
        if (d.showZh !== undefined) this.showZh = !!d.showZh
        if (d.revealAnswer !== undefined) this.revealAnswer = !!d.revealAnswer
        if (d.showExpl !== undefined) this.showExpl = !!d.showExpl
      } catch {}
    },
    save() {
      try {
        localStorage.setItem(K, JSON.stringify({
          showZh: this.showZh, revealAnswer: this.revealAnswer, showExpl: this.showExpl,
        }))
      } catch {}
    },
    setZh(v) { this.showZh = !!v; this.save() },
    toggleZh() { this.setZh(!this.showZh) },
  },
})
