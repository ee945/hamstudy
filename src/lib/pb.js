import PocketBase from 'pocketbase'

// 生产由 nginx 把 /pb 反代到 PocketBase；开发由 vite proxy 转发
export const pb = new PocketBase(
  import.meta.env.VITE_PB_URL || `${location.origin}/pb`
)

pb.autoCancellation(false)

/** 解析 token 的过期时间（毫秒）。解析不出来返回 0，交给服务端裁定 */
function tokenExpiry() {
  const t = pb.authStore.token
  if (!t) return 0
  try {
    const seg = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = seg + '='.repeat((4 - (seg.length % 4)) % 4)
    return (JSON.parse(atob(padded)).exp || 0) * 1000
  } catch {
    return 0
  }
}

/**
 * 登录态是否「看起来还有效」。
 *
 * SDK 自带的 authStore.isValid 只判断 token 非空、不校验 exp，
 * 于是过期的 token 照样被发出去，服务端回 401/404，界面却仍显示已登录。
 * 这里补上过期判断，留 30 秒余量避免边界抖动。
 */
export const isLive = () => {
  const s = pb.authStore
  if (!s.token || !s.record) return false
  const exp = tokenExpiry()
  return exp ? exp - Date.now() > 30_000 : true
}

/** 当前登录用户，未登录或登录态已失效时返回 null */
export const currentUser = () => (isLive() ? pb.authStore.record : null)
export const isLogin = () => isLive()

/**
 * 向服务端确认登录态仍然成立，成功时顺带刷新本地 record。
 * 用于启动时自检 —— 账号在别处被删除后，本地 authStore 是无从得知的。
 */
export async function refreshAuth() {
  return pb.collection('users').authRefresh()
}

/**
 * 这个错误是不是意味着「登录态没了」。
 * 401/403 一定是；404 只在操作「自己这条账号记录」时才是，
 * 删一条本来就不存在的答题记录也返回 404，那种情况不该把人踢下线。
 */
export function isAuthGone(e, { selfRecord = false } = {}) {
  const s = e?.status
  if (s === 401 || s === 403) return true
  return s === 404 && selfRecord
}

/** 邮箱登录 */
export async function login(email, password) {
  await pb.collection('users').authWithPassword(email, password)
  return pb.authStore.record
}

/** 注册：email / password + passwordConfirm，昵称与呼号选填 */
export async function register(email, password, nickname, callsign) {
  await pb.collection('users').create({
    email,
    password,
    passwordConfirm: password,
    nickname: nickname || email.split('@')[0],
    callsign: callsign || '',
  })
  return login(email, password)
}

export function logout() {
  pb.authStore.clear()
}
