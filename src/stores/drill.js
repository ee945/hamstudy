import { defineStore } from 'pinia'

const NS = 'hamstudy:drill:v1'
/** @param {string|null|undefined} uid 用户 id；空表示未登录 */
const keyOf = (uid) => `${NS}:${uid || 'guest'}`

const DEFAULTS = () => ({
  /** 上次刷题的范围，刷新后直接续上：{ level: 'technician', set: 'T3C' } */
  lastScope: null,
  /** scopeKey → 重置时间戳。重放作答流水时忽略该时间之前的记录 */
  resets: {},
  /** 作答后自动进入下一题 */
  autoNext: false,
})

/**
 * 刷题模式的「偏好与重置标记」。
 *
 * 掌握分本身不在这里：它由 hs_attempts 的全部练习流水（刷题 / 模考 /
 * 错题本 / 收藏夹）重放得到，因此天然跟着账号云同步、备份导出走。本 store 只放两类本地状态：
 * 上次选的范围、以及「重置本范围进度」的时间戳（重置只是把旧记录排除在
 * 重放之外，不删除历史答题流水，也不影响错题本与学习统计）。
 */
export const useDrill = defineStore('drill', {
  state: () => ({ uid: null, hydrated: false, ...DEFAULTS() }),

  actions: {
    hydrate(uid) {
      const next = uid || null
      if (this.hydrated && this.uid === next) return
      const own = this.read(keyOf(next))
      // 登录后把未登录期间攒下的偏好也并进来，与答题流水的合并保持一致
      const guest = next ? this.read(keyOf(null)) : null
      const resets = { ...(guest?.resets || {}), ...(own.resets || {}) }
      // 同一范围可能两边都重置过，取最近的那次
      for (const k of Object.keys(resets)) {
        resets[k] = Math.max(guest?.resets?.[k] || 0, own.resets?.[k] || 0)
      }
      this.uid = next
      this.hydrated = true
      this.lastScope = own.lastScope || guest?.lastScope || null
      this.resets = resets
      this.autoNext = own.autoNext ?? guest?.autoNext ?? false
      this.save()
    },

    read(k) {
      try {
        return { ...DEFAULTS(), ...(JSON.parse(localStorage.getItem(k) || '{}') || {}) }
      } catch {
        return DEFAULTS()
      }
    },
    snapshot() {
      return {
        lastScope: this.lastScope,
        resets: { ...this.resets },
        autoNext: this.autoNext,
      }
    },
    save() {
      try {
        localStorage.setItem(keyOf(this.uid), JSON.stringify(this.snapshot()))
      } catch (e) {
        console.warn('[drill] 偏好写入失败', e?.message)
      }
    },

    setScope(level, set) {
      this.lastScope = { level, set }
      this.save()
    },
    setAutoNext(v) {
      this.autoNext = !!v
      this.save()
    },
    /** 重置某范围的刷题掌握分（二次确认后调用） */
    resetScope(scopeKey) {
      this.resets = { ...this.resets, [scopeKey]: Date.now() }
      this.save()
    },
  },
})
