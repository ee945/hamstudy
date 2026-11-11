#!/usr/bin/env node
/**
 * 刷题模式计分口径回归。
 *
 * 夹具 tools/_official_study.json 是站内自带的官方实测数据 ——
 * 在 HamStudy 官方 study mode 里刷 T3 章节时手工记录的 114 条作答
 * （原题号 1–82、89–120，83–88 六条当时漏记），每行带官方显示的
 * 「完成率 / 查看率」两个整数读数。
 *
 * 验证目标：
 *   · 指数加权递推与官方逐行读数一致
 *   · 用户口述的分组读数 A/B/C 与总完成度全部能复现
 *   · 刷题 / 模考 / 错题本 / 收藏夹统一计入完成度，只读类记录被排除
 *   · 重置范围、抽题策略的行为符合预期
 *
 * 用法: node tools/verify_study.mjs
 */
import fs from 'node:fs'
import {
  DRILL_MODE, MAX_SCORE, NON_SCORING_MODES, countsForScore,
  replayDrill, summarize, chooseNext, scopeKeysOf, cutoffOf,
} from '../src/lib/drill.js'

const results = []
const ok = (name, cond, detail = '') => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? `  (${detail})` : ''))
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const FIX = JSON.parse(fs.readFileSync(new URL('./_official_study.json', import.meta.url), 'utf8'))
const GROUPS = FIX.groups
const IDS = []
for (const [g, n] of Object.entries(GROUPS)) {
  for (let i = 1; i <= n; i++) IDS.push(`T3${g}${String(i).padStart(2, '0')}`)
}
const idsOf = (g) => IDS.filter((id) => id[2] === g)

/* ───────── 1. 单题递推 ───────── */
console.log('──── 指数加权递推 ────')
const one = (events) => replayDrill(
  events.map((ok, i) => ({ qid: 'T3A01', ok, mode: DRILL_MODE, ts: i + 1 })),
  ['T3A01']
).score.get('T3A01') || 0

ok('第一题答错得 0 分', one([false]) === 0, `s=${one([false])}`)
ok('首次答对 = 1（新结果占 50% 权重）', one([true]) === 1, `s=${one([true])}`)
ok('连续答对增量减半：1 → 1.5 → 1.75 → 1.875',
  [1, 1.5, 1.75, 1.875].every((v, i) => Math.abs(one(Array(i + 1).fill(true)) - v) < 1e-9))
const ten = one(Array(10).fill(true))
ok('连对 10 次逼近满分但取不到', ten > 1.995 && ten < MAX_SCORE, `s=${ten.toFixed(5)}`)
const afterMiss = one([...Array(10).fill(true), false])
ok('满分后答错是温和回退（−0.5），不是腰斩到 1',
  Math.abs(afterMiss - (ten - 0.5)) < 1e-6 && afterMiss > 1.4,
  `${ten.toFixed(5)} → ${afterMiss.toFixed(5)}`)
ok('分数下限为 0', one([false, false, false, false]) === 0)

/* ───────── 2. 官方序列逐行 ───────── */
console.log('──── 官方实测 114 条逐行 ────')
const attempts = []
let seenHit = 0
let pctHit = 0
let maxDiff = 0
const misses = []
for (const r of FIX.rows) {
  attempts.push({ qid: r.qid, ok: r.ok, mode: DRILL_MODE, ts: r.n })
  const { score, seen } = replayDrill(attempts, IDS)
  const s = summarize(IDS, score, seen)
  if (s.seenPct === r.seen) seenHit++
  if (s.aptitude === r.pct) pctHit++
  const d = Math.abs(s.aptitude - r.pct)
  if (d > maxDiff) maxDiff = d
  if (d > 0) misses.push({ n: r.n, official: r.pct, model: s.aptitude })
}
ok('已做题目占比逐行全中', seenHit === FIX.rows.length, `${seenHit}/${FIX.rows.length}`)
ok('完成度逐行命中 ≥ 88', pctHit >= 88, `${pctHit}/${FIX.rows.length}`)
ok('未命中行偏差不超过 1（仅取整边界）', maxDiff <= 1,
  `最大偏差 ${maxDiff}，未命中 ${misses.length} 行`)
ok('未命中行全部是模型比官方低 1（漏记 6 条 + 官方先验估计）',
  misses.every((m) => m.official - m.model === 1),
  `反向偏差 ${misses.filter((m) => m.model > m.official).length} 行`)

/* ───────── 3. 用户口述的分组读数 ───────── */
console.log('──── 分组读数 ────')
const at100 = replayDrill(attempts.filter((a) => a.ts <= 100), IDS)
const g100 = Object.fromEntries(Object.keys(GROUPS).map((g) => [
  g, summarize(idsOf(g), at100.score, at100.seen).aptitude,
]))
ok('第 100 次 A/B/C = 79 / 75 / 80', eq([g100.A, g100.B, g100.C], [79, 75, 80]),
  `${g100.A}/${g100.B}/${g100.C}`)
ok('第 100 次总完成度 = 78', summarize(IDS, at100.score, at100.seen).aptitude === 78,
  `${summarize(IDS, at100.score, at100.seen).aptitude}%`)

const final = replayDrill(attempts, IDS)
const gEnd = Object.fromEntries(Object.keys(GROUPS).map((g) => [
  g, summarize(idsOf(g), final.score, final.seen).aptitude,
]))
ok('末态 A/B/C = 71 / 76 / 80', eq([gEnd.A, gEnd.B, gEnd.C], [71, 76, 80]),
  `${gEnd.A}/${gEnd.B}/${gEnd.C}`)
const totalEnd = summarize(IDS, final.score, final.seen).aptitude
ok('末态总完成度 75–76（表中漏记 83–88 六条，差 1 属数据缺口）',
  totalEnd === 75 || totalEnd === 76, `${totalEnd}%`)

/* ───────── 4. 四种练习模式统一计入完成度 ───────── */
console.log('──── 模式口径 / 重置 / 抽题 ────')
/** Map 直接 JSON.stringify 恒为 {}，必须转成有序数组再比 */
const entries = (m) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
const base = replayDrill(attempts, IDS)
const baseScore = base.score.get('T3A01') || 0

// 刷题 / 模考 / 错题本 / 收藏夹 / 改造前浏览页的历史真实作答
for (const mode of ['drill', 'exam', 'wrong', 'fav', 'browse']) {
  const one = replayDrill([...attempts, { qid: 'T3A01', ok: true, mode, ts: 999 }], IDS)
  ok(`${mode} 的一次作答会推高完成度`, (one.score.get('T3A01') || 0) > baseScore,
    `${baseScore.toFixed(5)} → ${(one.score.get('T3A01') || 0).toFixed(5)}`)
}
for (const mode of NON_SCORING_MODES) {
  const one = replayDrill([...attempts, { qid: 'T3A01', ok: true, mode, ts: 999 }], IDS)
  ok(`${mode} 不计入完成度`, eq(entries(one.score), entries(base.score)) && !countsForScore(mode))
}
ok('countsForScore 对缺省 mode 的老记录按有效作答处理', countsForScore('') && countsForScore(undefined))
const blank = replayDrill([{ qid: 'T3A01', ok: false, mode: 'exam-blank', ts: 1 }], ['T3A01'])
ok('模考未作答既不扣分也不算「已做」', blank.score.size === 0 && blank.seen.size === 0)
ok('scopeKeysOf 覆盖整级 / 子单元 / 小节三层',
  eq(scopeKeysOf('T3A01'), ['technician:all', 'technician:T3', 'technician:T3A']))
ok('cutoffOf 取三层中最近的重置',
  cutoffOf('T3A01', { 'technician:all': 10, 'technician:T3': 50, 'technician:T3C': 99 }) === 50)

const resets = { 'technician:T3C': 110 }
const afterReset = replayDrill(attempts, IDS, resets)
ok('重置 T3C 后该组进度归零',
  Object.keys(GROUPS).filter((g) => g === 'C').every((g) =>
    summarize(idsOf(g), afterReset.score, afterReset.seen).aptitude === 0))
ok('重置 T3C 不影响 A / B 组',
  summarize(idsOf('A'), afterReset.score, afterReset.seen).aptitude === gEnd.A &&
  summarize(idsOf('B'), afterReset.score, afterReset.seen).aptitude === gEnd.B)
ok('重置后 110 之后的作答仍计入',
  afterReset.seen.has('T3B01') && afterReset.seen.has('T3A10'))

const pool = IDS.map((id) => ({ id }))
const liveSeen = new Set()
const liveScore = new Map()
let recent = []
const drawn = []
for (let i = 0; i < IDS.length; i++) {
  const q = chooseNext(pool, liveScore, liveSeen, recent, () => 0.37)
  drawn.push(q.id)
  // 模拟真实作答：出手过的题随即进入已做集合
  liveSeen.add(q.id)
  liveScore.set(q.id, 1)
  recent = [...recent, q.id].slice(-6)
}
ok('新题优先：前 N 次把所有题各出一遍且不重复',
  drawn.length === IDS.length && new Set(drawn).size === IDS.length,
  `${new Set(drawn).size}/${IDS.length}`)

const seenAll = new Set(IDS)
const hiScore = new Map(IDS.map((id) => [id, 1.99]))
let bad = 0
recent = []
for (let i = 0; i < 60; i++) {
  const q = chooseNext(pool, hiScore, seenAll, recent, () => ((i * 0.6180339) % 1))
  if (recent.slice(-3).includes(q.id)) bad++
  recent = [...recent, q.id].slice(-6)
}
ok('已全见过时仍可出题，且最近 3 题不连续重复', bad === 0, `违例 ${bad} 次`)
ok('summarize 空范围返回 0，不产生 NaN',
  summarize([], new Map(), new Set()).aptitude === 0)
ok('summarize 分母恒为 2 × 题数（满分时读数 100）',
  summarize(IDS, new Map(IDS.map((id) => [id, 2])), new Set(IDS)).aptitude === 100)

/* ───────── 汇总 ───────── */
const pass = results.filter(Boolean).length
console.log(`\n${pass}/${results.length} 项通过`)
if (pass !== results.length) process.exit(1)
