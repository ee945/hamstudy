/**
 * 错题本 / 收藏夹「一轮练习」的纯函数规则。
 * 不依赖 Vue，方便 Node 直接跑回归。
 */

/** 循环翻页：末题往右回第一题，首题往左回末题；空列表恒为 0 */
export function wrapIndex(from, d, n) {
  if (!n) return 0
  const i = Math.max(0, Math.min(n - 1, from))
  return ((i + d) % n + n) % n
}

/** 是否处于列表末尾（用于判断「整轮答完后再往右」） */
export function atLast(from, n) {
  return n > 0 && from === n - 1
}

/** 本题这一轮是否处理过：作过答或主动看过答案都算 */
export function isDone(qid, picked = {}, revealed = {}) {
  return !!(picked[qid] || revealed[qid])
}

/** 整轮是否全部处理完。空列表不算完成，避免一进来就触发新一轮 */
export function isRoundDone(ids = [], picked = {}, revealed = {}) {
  return ids.length > 0 && ids.every((id) => isDone(id, picked, revealed))
}
