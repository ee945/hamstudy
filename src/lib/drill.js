/**
 * 刷题模式计分内核（纯函数，不依赖 Vue / Pinia，可被 Node 直接 import 做回归）。
 *
 * ── 口径：HamStudy 官方 study mode 的指数加权骨架 ──────────────────────
 * 官方 FAQ 说明：aptitude 是组内每题掌握分的平均；每题看最近 10 次作答，
 * 越近的一次权重越大（50%、25%、12.5%……），未答满 10 次时其余权重由
 * 首次作答的群体正确率估计补齐；因此一题要连续答对约 10 次才能拿满，
 * 而「最近一次」永远占一半话语权。
 *
 * 把「几何加权平均」写成递推就是 EWMA：新结果以 50% 权重注入，
 * 历史占剩下 50%。令掌握分 s ∈ [0, 2]（= 归一化正确率 × 2）：
 *
 *   答对  s ← 0.5·s + 0.5·2  =  s + (2 − s)/2
 *   答错  严格 EWMA 是 s ← 0.5·s（一次失手腰斩）
 *
 * 但用官方程序实测的 120 次作答序列核对，答错侧的腰斩与真实读数明显不符：
 * 连对十几次后错一次，完成率只温和回落，并不会掉一半。故答错侧采用
 * 实测校准过的温和固定回退 s ← max(0, s − 0.5)。这也是用户反复验证过的口径。
 *
 *   完成度 aptitude = Math.round(100 × Σs / (2 × N))   N 为范围内题数
 *   已做题目占比     = min(100, Math.round(100 × 去重作答数 / N))
 *   官方显示值为四舍五入后的整数（JS Math.round，非银行家舍入）。
 *
 * 用官方实测序列（夹具 tools/_official_study.json）验证，T3A 12 题 / T3B 12 题 / T3C 11 题：
 *   · 第 100 次：A 79 / B 75 / C 80 / 总 78 —— 四个读数全中
 *   · 第 120 次：A 71 / B 76 / C 80       —— 三个分组读数全中
 *   · 已做占比 114/114 行全中，完成度逐行 91/114 完全相等，其余 23 行均为 −1
 *     （表中缺 83–88 共 6 条作答记录，且官方对未答满 10 次的题还有先验估计，
 *      这部分是取整边界上的累计误差，不影响分组读数与趋势）
 */

/** 写入 hs_attempts.mode 的场景标记。四种练习模式共用一套完成度体系 */
export const DRILL_MODE = 'drill'
export const EXAM_MODE = 'exam'
export const WRONG_MODE = 'wrong'
export const FAV_MODE = 'fav'
/** 模考里未作答的题：成绩单计错、错题本收录，但不是一次真实作答，不计完成度 */
export const EXAM_BLANK_MODE = 'exam-blank'

/**
 * 不计入完成度的场景。采用「排除法」而不是白名单：
 * 今后新增任何练习入口，默认都会计入，避免又漏掉一种模式。
 *  · read  只读浏览（原首页下面的阅读链路，压根不写记录）
 *  · reveal 主动「显示答案」（只亮答案，没作答）
 *  · skip  刷题里跳过这题
 *  · exam-blank 模考未作答（提交时按错题记录，但没见过这道题，不该算「已做」）
 * 历史数据里 mode='browse' 是改造前浏览页的真实作答，按有效作答计入。
 */
export const NON_SCORING_MODES = ['read', 'reveal', 'skip', EXAM_BLANK_MODE]
export function countsForScore(mode) {
  return !NON_SCORING_MODES.includes(String(mode || ''))
}

/** 单题满分 */
export const MAX_SCORE = 2
/** 指数加权：最近一次作答的权重（再往前依次 25%、12.5%……） */
export const NEW_WEIGHT = 0.5
/** 答错温和回退量（实测校准） */
export const WRONG_PENALTY = 0.5

/** 题号 → 级别 slug。刻意不 import stores/bank：本模块要能在 Node 里裸跑 */
export function slugOfQid(id = '') {
  const c = String(id).charAt(0).toUpperCase()
  return c === 'T' ? 'technician' : c === 'G' ? 'general' : c === 'E' ? 'extra' : ''
}

/**
 * 一个题号同时属于三层范围：整级、子单元、小节。
 * 任一层被「重置进度」都会把它划入重置范围，因此重置时间戳取三者中最大值。
 */
export function scopeKeysOf(id = '') {
  const slug = slugOfQid(id)
  if (!slug) return []
  const s = String(id).toUpperCase()
  return [`${slug}:all`, `${slug}:${s.slice(0, 2)}`, `${slug}:${s.slice(0, 3)}`]
}

/** 该题的重置截止时间戳：早于它的作答不计入当前掌握分 */
export function cutoffOf(id, resets = {}) {
  let t = 0
  for (const k of scopeKeysOf(id)) t = Math.max(t, resets[k] || 0)
  return t
}

/**
 * 重放全部练习作答流水，得到每题掌握分与已做集合。
 * 进度只有一份真相源（hs_attempts）：刷题 / 模考 / 错题本 / 收藏夹的作答
 * 统一进入同一套完成度，登录云同步、备份导出、跨设备都自动对齐，不必另存一份。
 * 只读浏览、显示答案、跳过、模考未作答不算真实作答，由 countsForScore 排除。
 *
 * @param {{qid:string, ok:boolean, ts:number, mode?:string}[]} attempts
 * @param {string[]} ids 只关心这些题号（通常是一个级别或小节）
 * @param {Record<string, number>} resets scopeKey → 重置时间戳
 * @returns {{ score: Map<string,number>, seen: Set<string> }}
 */
export function replayDrill(attempts, ids, resets = {}) {
  const want = new Set(ids)
  const cutoffs = new Map()
  for (const id of want) cutoffs.set(id, cutoffOf(id, resets))

  // 同一毫秒内连答两题时，用原数组顺序兜底，保证刷新前后结果一致
  const rows = []
  for (let i = 0; i < (attempts || []).length; i++) {
    const a = attempts[i]
    if (a && countsForScore(a.mode) && want.has(a.qid) && a.ts >= cutoffs.get(a.qid)) {
      rows.push({ a, i })
    }
  }
  rows.sort((x, y) => x.a.ts - y.a.ts || x.i - y.i)

  const score = new Map()
  const seen = new Set()
  for (const { a } of rows) {
    const s = score.get(a.qid) || 0
    // 答对：新结果以 50% 权重注入，等价于 s + (2−s)/2
    // 答错：温和回退，避免一次失手抹掉长期积累
    score.set(a.qid, a.ok
      ? s + (MAX_SCORE - s) * NEW_WEIGHT
      : Math.max(0, s - WRONG_PENALTY))
    seen.add(a.qid)
  }
  return { score, seen }
}

/** 一组题目的完成度读数（组内平均，分母恒为 2 × 题数） */
export function summarize(ids, score, seen) {
  const n = ids.length
  if (!n) return { n: 0, done: 0, sum: 0, aptitude: 0, seenPct: 0 }
  let sum = 0
  let done = 0
  for (const id of ids) {
    sum += score.get(id) || 0
    if (seen.has(id)) done++
  }
  return {
    n,
    done,
    sum,
    aptitude: Math.round((100 * sum) / (2 * n)),
    seenPct: Math.min(100, Math.round((100 * done) / n)),
  }
}

/**
 * 抽下一题：仿官方 study 的「先上新题，再按掌握度回炉」。
 * 全部题目见过之后，按缺失分 (2 − s) 加权抽取，越不熟越常出现；
 * 保留一点基础权重，避免满分题永远不再出现（也允许刷满后继续练）。
 * 最近 3 题不会连着重复。
 *
 * @param {{id:string}[]} pool
 * @param {Map<string,number>} score
 * @param {Set<string>} seen
 * @param {string[]} recent 最近出过的题号
 * @param {() => number} rnd 可注入的随机源，便于测试
 */
export function chooseNext(pool, score, seen, recent = [], rnd = Math.random) {
  if (!pool.length) return null
  const avoid = new Set(recent.slice(-3))
  let cand = pool.filter((q) => !avoid.has(q.id))
  if (!cand.length) cand = pool

  const fresh = cand.filter((q) => !seen.has(q.id))
  if (fresh.length) return fresh[Math.min(fresh.length - 1, Math.floor(rnd() * fresh.length))]

  // 加权轮盘：底噪 0.08 让满分题仍有极低概率被抽到
  const weights = cand.map((q) => Math.max(0, MAX_SCORE - (score.get(q.id) || 0)) + 0.08)
  let total = 0
  for (const w of weights) total += w
  let r = rnd() * total
  for (let i = 0; i < cand.length; i++) {
    r -= weights[i]
    if (r <= 0) return cand[i]
  }
  return cand[cand.length - 1]
}
