/**
 * 错题本「掌握积分」规则（纯函数，便于单测）。
 *
 * - 答对 +1，答错 −1
 * - 下限 0（不会负分），上限 WRONG_TARGET（不会无限涨）
 * - 积满 WRONG_TARGET 即视为掌握，自动移出错题本
 * - 计数是全局的：不区分作答场景（背题 / 模拟考试 / 搜索）
 *
 * 副作用：已经积满的题再答错一次会掉回 WRONG_TARGET-1，重新进错题本——这是刻意的，
 * 考场上又错了说明没真正掌握。
 */

export const WRONG_TARGET = 3

/** @param {{ qid:string, ok:boolean, ts:number, level:string, sec:string }[]} attempts */
export function replay(attempts) {
  const order = [...attempts].sort((a, b) => a.ts - b.ts)
  const score = new Map()
  const wrongSeen = new Set()
  const last = new Map()

  for (const a of order) {
    const cur = score.get(a.qid) || 0
    if (a.ok) {
      score.set(a.qid, Math.min(WRONG_TARGET, cur + 1))
    } else {
      wrongSeen.add(a.qid)
      score.set(a.qid, Math.max(0, cur - 1))
    }
    const prev = last.get(a.qid)
    if (!prev || a.ts >= prev.ts) last.set(a.qid, a)
  }
  return { score, wrongSeen, last }
}

/** qid -> 掌握积分 */
export function scoreMap(attempts) {
  return replay(attempts).score
}
