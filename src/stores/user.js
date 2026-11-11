import { defineStore } from 'pinia'
import {
  pb, currentUser, isLive, refreshAuth, isAuthGone,
  login as pbLogin, register as pbReg, logout as pbLogout,
} from '../lib/pb'

/** 用户 / 登录态 */
export const useUser = defineStore('user', {
  state: () => ({
    ready: false,
    user: null,
    loading: false,
    error: '',
    /** 登录态失效的回执：{ ts, reason }，界面据此提示并引导重新登录 */
    sessionLost: null,
  }),
  getters: {
    logged: (s) => !!s.user,
    /**
     * 题库改写权限分三级：
     *   admin  管理员 —— 改任意字段、直接生效、审核编辑员提案
     *   editor 编辑员 —— 只改中文译文 / 要点 / 解析，提交后待审
     *   ''     普通用户 —— 只能浏览
     * 后端 hs_edits / hs_pending 的规则同样只认这个字段，前端隐藏入口只是体验。
     */
    isAdmin: (s) => (s.user?.role || '') === 'admin',
    isEditor: (s) => (s.user?.role || '') === 'editor',
    /** 能进「题库维护 / 待审修订」的人 */
    canMaintain: (s) => ['admin', 'editor'].includes(s.user?.role || ''),
    roleLabel: (s) => ({ admin: '管理员', editor: '编辑员' }[s.user?.role] || '普通用户'),
    /** 业余无线电呼号，未填为空串 */
    callsign: (s) => (s.user?.callsign || '').trim(),
    name: (s) => (s.user ? s.user.nickname || s.user.callsign || s.user.email?.split('@')[0] : '未登录'),
    initial: (s) => (s.user ? (s.user.nickname || s.user.email || 'U').charAt(0).toUpperCase() : '?'),
  },
  actions: {
    init() {
      const hadToken = !!pb.authStore.token
      this.user = currentUser()
      this.ready = true
      pb.authStore.onChange(() => {
        this.user = currentUser()
      })
      // 启动时向服务端确认一次。本地 authStore 是无从得知账号已被删除的，
      // 不校验的话用户会一直卡在「看着已登录、一保存就 404」的状态。
      if (this.user) this.verify()
      // 存着 token 却已过期：也交代一句，免得用户以为是自己掉的线
      else if (hadToken) this.sessionLost = { ts: Date.now(), reason: '登录已过期，请重新登录' }
    },

    /**
     * 校验当前登录态：token 过期或账号已不存在时静默登出。
     * 这样刷新页面就能自动恢复正常，不必让用户手动清浏览器缓存。
     */
    async verify() {
      if (!isLive()) {
        this.dropSession(this.user ? '登录已过期，请重新登录' : '')
        return
      }
      try {
        await refreshAuth()
        this.user = currentUser()
      } catch (e) {
        // selfRecord: authRefresh 操作的就是自己这条记录，404 即账号没了
        if (isAuthGone(e, { selfRecord: true })) {
          this.dropSession('登录状态已失效，请重新登录')
        }
      }
    },

    /** 丢弃失效的登录态。reason 为空表示纯静默清理（启动时发现已过期） */
    dropSession(reason = '') {
      pbLogout()
      this.user = null
      this.sessionLost = reason ? { ts: Date.now(), reason } : null
      if (reason) this.error = reason
    },
    async login(email, password) {
      this.loading = true
      this.error = ''
      try {
        await pbLogin(email, password)
        return true
      } catch (e) {
        this.error = translateErr(e)
        return false
      } finally {
        this.loading = false
      }
    },
    async register(email, password, nickname, callsign) {
      this.loading = true
      this.error = ''
      try {
        await pbReg(email, password, nickname, callsign)
        return true
      } catch (e) {
        this.error = translateErr(e)
        return false
      } finally {
        this.loading = false
      }
    },
    logout() {
      pbLogout()
      this.user = null
    },

    /** 更新昵称 / 呼号 / 头像预设。空串 avatarPreset 表示回到首字母图标 */
    async updateProfile({ nickname, avatarPreset, callsign }) {
      this.loading = true
      this.error = ''
      try {
        if (!isLive()) {
          this.dropSession('登录已过期，请重新登录')
          return false
        }
        const patch = { nickname, avatarPreset }
        if (callsign !== undefined) patch.callsign = callsign
        const rec = await pb.collection('users').update(this.user.id, patch)
        this.user = pb.authStore.record || rec
        return true
      } catch (e) {
        // 这里操作的正是自己这条账号记录，404 说明账号已经不在了
        if (isAuthGone(e, { selfRecord: true })) this.dropSession('登录状态已失效，请重新登录')
        else this.error = translateErr(e)
        return false
      } finally {
        this.loading = false
      }
    },

    /**
     * 修改密码。PocketBase 要求带旧密码；改完后旧 token 会立即失效，
     * 所以这里用新密码静默重新登录，避免用户被踢下线。
     */
    async changePassword(oldPassword, password) {
      this.loading = true
      this.error = ''
      try {
        if (!isLive()) {
          this.dropSession('登录已过期，请重新登录')
          return false
        }
        await pb.collection('users').update(this.user.id, {
          oldPassword,
          password,
          passwordConfirm: password,
        })
        const email = this.user.email
        if (email) await pbLogin(email, password)
        return true
      } catch (e) {
        if (isAuthGone(e, { selfRecord: true })) this.dropSession('登录状态已失效，请重新登录')
        else this.error = translateErr(e)
        return false
      } finally {
        this.loading = false
      }
    },
  },
})

function translateErr(e) {
  const msg = String(e?.message || e)
  const status = e?.status
  if (/Failed to authenticate|invalid login/i.test(msg)) return '邮箱或密码不正确'
  if (status === 400) {
    const d = e?.data?.data
    if (d) {
      // 常见字段错误的中文转写，避免把英文 code 直接丢给用户
      if (d.oldPassword) return '当前密码不正确'
      if (d.password) return /length/i.test(d.password.code || '')
        ? '新密码长度不符合要求（至少 8 位）'
        : '新密码不符合要求'
      if (d.email) return '邮箱格式不正确或已被注册'
      return Object.entries(d)
        .map(([k, v]) => `${k}: ${v?.message || v?.code || v}`)
        .join('；')
    }
    return '提交的信息有误'
  }
  if (status === 404) return '要操作的记录不存在，可能已被删除'
  if (status === 401 || status === 403) return '登录状态已失效，请重新登录'
  // 没有 status 说明请求根本没到服务端（后端没起、网络断了）
  if (!status) return '连接不上后端，请确认服务已启动'
  return msg
}
