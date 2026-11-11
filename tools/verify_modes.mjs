#!/usr/bin/env node
/**
 * 回归：四种练习模式的进度口径 + 错题本/收藏夹的循环练习规则。
 *
 * 验证：
 *   · 刷题 / 模考 / 错题本 / 收藏夹（含历史 browse）的作答进入同一套完成度，
 *     且不同模式之间没有任何权重差异 —— 换一种入口刷，读数完全一致；
 *   · 只读浏览 / 显示答案 / 跳过 / 模考未作答不计分、不计「已做」；
 *   · 循环翻页、整轮判定、每题每轮只判一次的规则。
 *
 * 用法: node tools/verify_modes.mjs
 */
import {
  DRILL_MODE, EXAM_MODE, WRONG_MODE, FAV_MODE, EXAM_BLANK_MODE,
  countsForScore, replayDrill, summarize,
} from '../src/lib/drill.js'
import { wrapIndex, atLast, isDone, isRoundDone } from '../src/lib/practice.js'

const results = []
const ok = (name, cond, detail = '') => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? `  (${detail})` : ''))
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const entries = (m) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))

const IDS = ['T4A01', 'T4A02', 'T4A03', 'T4A04']

/* ───────── 1. 四种模式共用一套分数 ───────── */
console.log('──── 全模式计分口径 ────')
/** 同一串对错，只换 mode 标签，重放结果必须逐题完全一致 */
const EVENTS = [
  ['T4A01', true], ['T4A02', false], ['T4A01', true], ['T4A03', true],
  ['T4A02', true], ['T4A04', false], ['T4A01', false], ['T4A03', true],
]
const build = (mode) => EVENTS.map(([qid, ok], k) => ({ qid, ok, mode, ts: 1000 + k }))
const canonical = replayDrill(build(DRILL_MODE), IDS)
for (const mode of [DRILL_MODE, EXAM_MODE, WRONG_MODE, FAV_MODE, 'browse']) {
  const got = replayDrill(build(mode), IDS)
  ok(`${mode} 与刷题口径逐题一致`, eq(entries(got.score), entries(canonical.score)) &&
    eq([...got.seen].sort(), [...canonical.seen].sort()),
    `Σs=${summarize(IDS, got.score, got.seen).sum.toFixed(4)}`)
}
ok('混合模式序列 = 全部按单一模式重放', (() => {
  const mixed = EVENTS.map(([qid, isOk], k) => ({
    qid, ok: isOk, ts: 1000 + k,
    mode: [DRILL_MODE, EXAM_MODE, WRONG_MODE, FAV_MODE][k % 4],
  }))
  const got = replayDrill(mixed, IDS)
  return eq(entries(got.score), entries(canonical.score))
})())
ok('四种模式都计入完成度读数', [DRILL_MODE, EXAM_MODE, WRONG_MODE, FAV_MODE].every(countsForScore))

/* ───────── 2. 非作答记录被排除 ───────── */
console.log('──── 只读 / 未作答排除 ────')
for (const mode of ['read', 'reveal', 'skip', EXAM_BLANK_MODE]) {
  ok(`${mode} 不计分`, !countsForScore(mode))
}
const excluded = [
  ...build(DRILL_MODE),
  { qid: 'T4A01', ok: true, mode: 'read', ts: 2000 },
  { qid: 'T4A01', ok: true, mode: 'reveal', ts: 2001 },
  { qid: 'T4A02', ok: true, mode: 'skip', ts: 2002 },
  { qid: 'T4A04', ok: true, mode: EXAM_BLANK_MODE, ts: 2003 },
]
const afterExcluded = replayDrill(excluded, IDS)
ok('只读类记录不改变掌握分', eq(entries(afterExcluded.score), entries(canonical.score)))
ok('只读类记录不改变已做集合', eq([...afterExcluded.seen].sort(), [...canonical.seen].sort()))
const onlyBlank = replayDrill(
  [{ qid: 'T4A01', ok: false, mode: EXAM_BLANK_MODE, ts: 1 }], ['T4A01']
)
ok('模考未作答不把没见过的题算成已做', onlyBlank.seen.size === 0 && onlyBlank.score.size === 0)
ok('未作答的题不会拉低尚未开始的范围', summarize(IDS, onlyBlank.score, onlyBlank.seen).aptitude === 0)

/* ───────── 3. 循环翻页与整轮规则 ───────── */
console.log('──── 循环练习规则 ────')
ok('末题往右回第一题', wrapIndex(3, 1, 4) === 0)
ok('首题往左回末题', wrapIndex(0, -1, 4) === 3)
ok('中间正常前后翻', wrapIndex(1, 1, 4) === 2 && wrapIndex(1, -1, 4) === 0)
ok('越界下标被夹回合法范围', wrapIndex(99, 1, 4) === 0 && wrapIndex(-5, -1, 4) === 3)
ok('空列表恒为 0', wrapIndex(5, 1, 0) === 0)
ok('atLast 只在末题为真', atLast(3, 4) && !atLast(2, 4) && !atLast(0, 0))
ok('空列表不算「整轮完成」', !isRoundDone([], {}, {}))
ok('全部题作过答才算整轮完成', isRoundDone(IDS, { T4A01: 'A', T4A02: 'B', T4A03: 'C', T4A04: 'D' }, {}))
ok('少一题就不算完成', !isRoundDone(IDS, { T4A01: 'A', T4A02: 'B', T4A03: 'C' }, {}))
ok('看过答案也算处理过本题', isRoundDone(IDS,
  { T4A01: 'A', T4A02: 'B', T4A03: 'C' }, { T4A04: true }))
ok('isDone 同时认作答与看答案', isDone('X', {}, { X: true }) && isDone('X', { X: 'A' }, {}) && !isDone('X', {}, {}))

const pass = results.filter(Boolean).length
console.log(`\n${pass}/${results.length} 项通过`)
if (pass !== results.length) process.exit(1)
