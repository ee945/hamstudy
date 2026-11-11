#!/usr/bin/env node
/**
 * 学习进度页 / 模考回顾 端到端回归。
 *
 * 覆盖：
 *  · 近 14 天活跃度 = 每日答题流水条数、峰值归一化、窗口外不计、数值可见
 *  · 各级别掌握情况 = 整级完成度（与 replayDrill + summarize 独立复算一致），
 *    不再出现「小节覆盖」，薄弱小节按完成度排序并链到刷题页对应范围
 *  · 模考记录默认 5 条、标题右侧「更多」进完整页、时间/级别可点进回顾
 *  · 历史回顾页与交卷结果页结构完全一致，逐题 chip 能展开题目解析
 *  · 窄屏无横向溢出、无运行时报错
 *
 * 用法: node tools/verify_progress.mjs [baseURL]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, sleep } from './_cdp.mjs'
import { replayDrill, summarize, countsForScore } from '../src/lib/drill.js'

const BASE = process.argv[2] || 'http://127.0.0.1:8091'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/meta.json'), 'utf8'))
const tqs = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/q_technician.json'), 'utf8')).qs

let passed = 0
const fails = []
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✓', name) }
  else { fails.push(name); console.log('  ✗', name, extra ? `— ${extra}` : '') }
}

/* ───────── 造数据 ───────── */
const day = (off, hour = 10) => {
  const d = new Date()
  d.setHours(hour, 15, 0, 0)
  d.setDate(d.getDate() - off)
  return d.getTime()
}
let seq = 0
const attempts = []
const add = (qid, okFlag, mode, off, hour) => attempts.push({
  id: `vp${String(++seq).padStart(12, '0')}`,
  qid, level: '技术级', sec: qid.slice(0, 3).toUpperCase(),
  ok: okFlag, mode, ts: day(off, hour), _synced: true,
})
// 今天 5 条 / 昨天 2 条 / 3 天前 3 条（含 1 条 exam-blank）/ 10 天前 1 条 / 20 天前 2 条（窗口外）
add('T1A01', true, 'drill', 0, 9)
add('T1A01', true, 'drill', 0, 10)
add('T1A02', false, 'drill', 0, 11)
add('T4A01', true, 'exam', 0, 12)
add('T1A03', true, 'wrong', 0, 13)
add('T1A01', true, 'fav', 1, 10)
add('T1A02', true, 'wrong', 1, 11)
add('T1A04', true, 'drill', 3, 10)
add('T1A05', false, 'drill', 3, 11)
add('T1B01', false, 'exam-blank', 3, 12)   // 活跃度计入、完成度排除
add('T1A06', true, 'browse', 10, 10)
add('T1A07', true, 'drill', 20, 10)
add('T1A08', false, 'drill', 20, 11)

const idsOfLevel = (slug) => {
  const l = meta.levels.find((x) => x.slug === slug)
  return l.blocks.flatMap((b) => b.secs.flatMap((s) => s.ids))
}
const techIds = idsOfLevel('technician')
const { score, seen } = replayDrill(attempts, techIds, {})
const expectTech = summarize(techIds, score, seen).aptitude
const expectSeen = summarize(techIds, score, seen).seenPct

// 35 题真实答案，前 28 题答对、后 7 题未作答
const examQs = techIds.slice(0, 35).map((id) => tqs.find((q) => q.id === id)).filter(Boolean)
const detail = examQs.map((q, i) => ({
  qid: q.id, sec: q.sec || q.id.slice(0, 3),
  chosen: i < 28 ? q.ans : '',
  ok: i < 28,
}))
const FIRST_ID = 'vpreview000001'
const sessions = Array.from({ length: 8 }, (_, k) => ({
  id: `vpreview${String(k + 1).padStart(6, '0')}`,
  level: k % 2 ? '通用级' : '技术级',
  total: 35, correct: 28, durationSec: 900 + k * 60,
  mode: 'exam:random', detail,
  ts: day(k, 8 + k), _synced: true,
}))
const payload = { attempts, favs: [], sessions, cleared: [] }

const RESULT_STRUCT = `(() => ({
  res: !!document.querySelector('.res.card'),
  score: document.querySelector('.res .score b')?.textContent.trim(),
  verdict: document.querySelector('.res .verdict h2')?.textContent.trim(),
  facts: document.querySelectorAll('.facts-row .f').length,
  secT: document.querySelector('.sec-t')?.textContent.trim(),
  chips: document.querySelectorAll('.chips .chip').length,
  acts: [...document.querySelectorAll('.res .acts a, .res .acts button')]
    .map(e => e.textContent.trim()).join('|'),
}))()`

const b = await launch(BASE, { port: 9491, quiet: true })
try {
  /* ───────── 1. 先走一次真实交卷，记录结果页结构 ───────── */
  console.log('\n【一】交卷结果页基准结构')
  await b.goto('/exam/technician', 2600)
  await b.waitFor('.b-r .btn-primary', 10000)
  await b.click('.b-r .btn-primary', 500)
  const hasDlg = await b.eval(`!!document.querySelector('.dlg')`)
  ok('未作答时弹出确认框', hasDlg)
  if (hasDlg) await b.click('.dlg-acts .btn-primary', 900)
  await b.waitFor('.res.card', 10000)
  const live = await b.eval(RESULT_STRUCT)
  console.log('   结果页结构:', JSON.stringify(live))
  ok('交卷结果页：分数卡 / 四项统计 / 逐题回顾 / 操作按钮齐全',
    live.res && live.facts === 4 && live.chips === 35 && live.secT.includes('逐题回顾'))

  /* ───────── 2. 注入数据后看进度页 ───────── */
  console.log('\n【二】近 14 天活跃度口径')
  await b.goto('/progress', 1800)
  await b.eval(`localStorage.setItem('hamstudy:v1:guest', ${JSON.stringify(JSON.stringify(payload))})`)
  await b.goto('/progress', 2600)
  await b.waitFor('.lvs .lv', 10000)

  const sub = await b.eval(`document.querySelector('.pn-sub')?.textContent || ''`)
  ok('明确写出按「每天的作答条数」而非时长', sub.includes('每天的作答条数') && sub.includes('不是练习时长'), sub.slice(0, 60))
  ok('明确写出柱高是窗口内相对归一化', sub.includes('相对归一化') && sub.includes('满格'))
  ok('说明哪些模式计入 / 不计入', sub.includes('刷题') && sub.includes('模考') && sub.includes('只读浏览'))

  const bars = await b.eval(`(() => ({
    n: document.querySelectorAll('.bars .b').length,
    labels: [...document.querySelectorAll('.bars .b .b-n')].map(e => e.textContent.trim()),
    heights: [...document.querySelectorAll('.bars .b i')].map(e => Math.round(parseFloat(e.style.height))),
    peak: document.querySelector('.pn-note')?.textContent || '',
    foot: document.querySelector('.pn-foot')?.textContent || '',
  }))()`)
  console.log('   柱数', bars.n, ' 数值', JSON.stringify(bars.labels), ' 峰值说明', bars.peak.trim())
  ok('14 根柱子', bars.n === 14, String(bars.n))
  ok('今日柱子显示真实条数 5', bars.labels[13] === '5', bars.labels[13])
  ok('峰值说明写出满格题数 5', bars.peak.includes('峰值 5 次'), bars.peak)
  ok('合计 11 次：窗口外 20 天前的 2 条不计入', bars.foot.includes('11 次作答'), bars.foot)
  ok('有练习 4 天', bars.foot.includes('有练习 4 天'), bars.foot)
  ok('最高柱按满格 58px，其余按比例', Math.max(...bars.heights) === 58 && Math.min(...bars.heights) === 2,
    JSON.stringify(bars.heights))

  /* ───────── 3. 级别完成度 ───────── */
  console.log('\n【三】各级别整体完成度')
  const lv = await b.eval(`(() => [...document.querySelectorAll('.lvs .lv')].map(e => ({
    text: e.querySelector('.lv-t .pct')?.textContent.replace(/\\s+/g, ' ').trim(),
    apt: parseInt(e.querySelector('.lv-t .pct b')?.textContent || '', 10),
    bar: e.querySelector('.pbar i')?.style.width,
    weak: [...e.querySelectorAll('.w')].map(a => ({ code: a.textContent.trim(), href: a.getAttribute('href') })),
  })))()`)
  console.log('   级别读数:', JSON.stringify(lv.map(x => x.text)))
  ok('不再出现「小节覆盖」', !JSON.stringify(lv).includes('小节覆盖'))
  ok('三个级别都显示「完成度」', lv.length === 3 && lv.every((x) => x.text.includes('完成度')))
  ok(`技术级完成度 = ${expectTech}%（与 replayDrill 独立复算一致）`, lv[0].apt === expectTech, `页面 ${lv[0].apt} / 期望 ${expectTech}`)
  ok('进度条宽度取完成度', lv[0].bar === `${expectTech}%`, lv[0].bar)
  ok(`已做占比 = ${expectSeen}%`, lv[0].text.includes(`已做 ${expectSeen}%`), lv[0].text)
  ok('通用级 / 业余特级没有练习记录时为 0%', lv[1].apt === 0 && lv[2].apt === 0, JSON.stringify(lv.map(x => x.apt)))
  ok('薄弱小节按完成度列出并链到刷题页对应范围',
    lv[0].weak.length > 0 && lv[0].weak.every((w) => w.href.startsWith('/study?level=technician&set=')),
    JSON.stringify(lv[0].weak))
  ok('exam-blank 不计完成度但按流水计入活跃度',
    !countsForScore('exam-blank') && countsForScore('drill') && countsForScore('exam') && countsForScore('browse'))

  /* ───────── 4. 模考记录 5 条 + 更多 ───────── */
  console.log('\n【四】模考记录与「更多」')
  const ex = await b.eval(`(() => ({
    rows: document.querySelectorAll('.ex li').length,
    count: document.querySelector('.pn-count')?.textContent.trim(),
    more: document.querySelector('.pn-h .more')?.getAttribute('href'),
    links: [...document.querySelectorAll('.ex li:first-child a')].map(a => a.getAttribute('href')),
  }))()`)
  console.log('   ', JSON.stringify(ex))
  ok('默认只显示最近 5 场', ex.rows === 5, String(ex.rows))
  ok('标注「最近 5 / 共 8 场」', ex.count.includes('5') && ex.count.includes('8'), ex.count)
  ok('标题最右侧有「更多」并指向完整记录页', ex.more === '/progress/exams', ex.more)
  ok('时间、级别都是回顾链接', ex.links.length === 2 && ex.links.every((h) => h.startsWith('/exam/review/')), JSON.stringify(ex.links))

  await b.click('.pn-h .more', 1800)
  await b.waitFor('.ex li', 10000)
  const full = await b.eval(`(() => ({ path: location.pathname, rows: document.querySelectorAll('.ex li').length }))()`)
  ok('点「更多」进入完整记录页', full.path === '/progress/exams', full.path)
  ok('完整页列出全部 8 场', full.rows === 8, String(full.rows))

  /* ───────── 5. 回顾页与结果页一致 ───────── */
  console.log('\n【五】模考回顾页')
  await b.click(`.ex li:first-child a.d`, 2600)
  await b.waitFor('.res.card', 10000)
  const rev = await b.eval(RESULT_STRUCT)
  const path = await b.eval('location.pathname')
  console.log('   ', path, JSON.stringify(rev))
  ok('链接跳到 /exam/review/:id', path === `/exam/review/${FIRST_ID}`, path)
  ok('成绩单结构与交卷结果页完全一致',
    rev.res === live.res && rev.facts === live.facts && rev.chips === live.chips &&
    rev.secT === live.secT && rev.acts === live.acts,
    `${JSON.stringify(rev)} vs ${JSON.stringify(live)}`)
  ok('分数 / 判定来自历史明细（28 分、通过）', rev.score === '28' && rev.verdict === '通过', JSON.stringify(rev))
  const facts = await b.eval(`[...document.querySelectorAll('.facts-row .f b')].map(e => e.textContent.trim())`)
  ok('四项统计：28 对 / 7 错 / 7 未答 / 平均每题', facts[0] === '28' && facts[1] === '7' && facts[2] === '7', JSON.stringify(facts))

  await b.click('.chips .chip:first-child', 900)
  await b.waitFor('.review .qc', 10000)
  const card = await b.eval(`(() => ({
    qid: document.querySelector('.review .qc .qid')?.textContent.trim(),
    right: document.querySelectorAll('.review .qc .opt.right').length,
    picked: document.querySelectorAll('.review .qc .opt.wrong').length,
    expl: !!document.querySelector('.review .qc .expl'),
    verdict: document.querySelector('.review .qc .verdict')?.textContent.trim(),
  }))()`)
  console.log('   展开题目:', JSON.stringify(card))
  ok('点题号展开与结果页相同的题目卡片', card.qid.includes(examQs[0].id) && card.right === 1, JSON.stringify(card))
  ok('展开后显示解析区', card.expl)
  ok('回顾模式只读，不出现数字键提示', await b.eval(`document.querySelectorAll('.review .kbd-hint').length`) === 0)

  /* ───────── 6. 薄弱小节链接落到刷题范围 ───────── */
  console.log('\n【六】薄弱小节 → 刷题模式')
  await b.goto('/progress', 2400)
  await b.waitFor('.lvs .lv .w', 10000)
  const weakHref = await b.eval(`document.querySelector('.lvs .lv .w')?.getAttribute('href')`)
  await b.goto(weakHref, 2600)
  await b.waitFor('.qc, .picker', 10000)
  const scope = await b.eval(`(() => ({
    path: location.pathname, search: location.search,
    qid: document.querySelector('.qc .qid')?.textContent.trim(),
    running: !!document.querySelector('.qc'),
  }))()`)
  console.log('   ', weakHref, JSON.stringify(scope))
  const sec = new URL('http://x' + weakHref).searchParams.get('set')
  ok('链接带上 level / set 参数', scope.search.includes('level=technician') && scope.search.includes(`set=${sec}`))
  ok('直接进入该小节刷题', scope.running && scope.qid.includes(sec), JSON.stringify(scope))

  /* ───────── 7. 窄屏与运行时错误 ───────── */
  console.log('\n【七】窄屏与控制台')
  for (const w of [375, 320]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(260)
    await b.goto('/progress', 1800)
    const ov = await b.eval(`document.documentElement.scrollWidth - window.innerWidth`)
    ok(`${w}px 进度页无横向溢出`, ov <= 1, `overflow=${ov}`)
  }
  await b.send('Emulation.clearDeviceMetricsOverride')
  ok('没有运行时错误', b.errors.length === 0, b.errors.slice(0, 3).join(' | '))
} finally {
  await b.close()
}

console.log(`\n──────── ${passed} 项通过，${fails.length} 项失败 ────────`)
if (fails.length) {
  for (const f of fails) console.log('  失败:', f)
  process.exit(1)
}
