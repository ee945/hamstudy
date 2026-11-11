#!/usr/bin/env node
/**
 * 回归：刷题模式 + 浏览模式的端到端点击链路。
 *
 * 验证：导航位置、范围选择、作答即时判分与完成度变化、显示答案不计分、
 * 浏览模式默认亮出答案且完全不计分、首页/级别页文案，以及全程无运行时报错。
 * 无头浏览器每次使用独立 profile，不会写脏用户的学习数据。
 *
 * 用法: node tools/verify_study_ui.mjs [baseURL]
 */
import { launch, sleep } from './_cdp.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:8091'
const b = await launch(BASE, { port: 9453, quiet: true })
const results = []
const ok = (name, cond, detail = '') => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? `  (${detail})` : ''))
}
/** 长页面底部的按钮先滚到视口中间，再用真实鼠标点击 */
const clickSel = async (sel, wait = 420) => {
  await b.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' }); return !!e })()`)
  await b.click(sel, wait)
}
const metrics = () => b.eval(
  `[...document.querySelectorAll('.metric')].map(e => parseInt(e.querySelector('b').textContent, 10))`
)
const attemptCount = () => b.eval(`(() => {
  try { return (JSON.parse(localStorage.getItem('hamstudy:v1:guest') || '{}').attempts || []).length }
  catch { return -1 }
})()`)

try {
  /* ───── 导航与首页文案 ───── */
  console.log('──── 导航 / 首页 ────')
  await b.goto('/', 2400)
  await b.waitFor('.lv')
  const nav = await b.eval(`[...document.querySelectorAll('.nav-i')].map(e => e.textContent.trim())`)
  ok('导航顺序：首页 · 刷题模式 · 模拟考试 …',
    nav[0] === '首页' && nav[1] === '刷题模式' && nav[2] === '模拟考试', nav.join(' / '))
  const home = await b.eval(`document.body.innerText`)
  ok('首页级别卡片改为「浏览题目」', home.includes('浏览题目') && !home.includes('开始学习'))
  ok('首页说明两种模式的分工', home.includes('浏览模式') && home.includes('刷题模式'))

  /* ───── 范围选择 ───── */
  console.log('──── 选范围 ────')
  await clickSel('.nav-i:nth-child(2)', 2200)
  await b.waitFor('.picker')
  ok('进入 /study 先显示范围选择', await b.eval(`location.pathname === '/study' && !!document.querySelector('.picker')`))
  const tabs = await b.eval(`[...document.querySelectorAll('.lv-tab b')].map(e => e.textContent.trim())`)
  ok('三个级别都可切换', tabs.length === 3, tabs.join('/'))

  const opened = await b.eval(`(() => {
    const x = [...document.querySelectorAll('.blk-main')]
      .find(e => e.querySelector('.r-name b')?.textContent.trim().startsWith('T3 '))
    if (!x) return false
    x.click(); return true
  })()`)
  await sleep(300)
  ok('子单元可展开出小节列表', opened && await b.eval(`document.querySelectorAll('.secs .sec').length > 0`))

  const pickedSec = await b.eval(`(() => {
    const x = [...document.querySelectorAll('.secs .sec')].find(e => e.textContent.includes('T3C'))
    if (!x) return false
    x.click(); return true
  })()`)
  await sleep(300)
  const chosen = await b.eval(`document.querySelector('.chosen')?.textContent || ''`)
  ok('可选中单个小节 T3C（11 题）', pickedSec && chosen.includes('T3C') && chosen.includes('11 题'), chosen.trim())

  /* ───── 答题流程 ───── */
  console.log('──── 答题 / 计分 ────')
  await clickSel('.pk-f .btn', 1600)
  await b.waitFor('.qc')
  ok('点「开始刷题」进入答题界面', await b.eval(`!!document.querySelector('.qc') && !document.querySelector('.picker')`))
  const m0 = await metrics()
  ok('新范围进度从 0 开始', m0[0] === 0 && m0[1] === 0, m0.join('/'))
  const q1 = await b.eval(`document.querySelector('.qc .qid')?.textContent || ''`)
  ok('题目卡片带题号与四个选项',
    q1.startsWith('#T3C') && await b.eval(`document.querySelectorAll('.opts .opt').length === 4`), q1)

  const n0 = await attemptCount()
  await clickSel('.opts .opt:nth-child(1)', 600)
  const m1 = await metrics()
  const n1 = await attemptCount()
  ok('作答后立即判分', await b.eval(`!!document.querySelector('.verdict.ok, .verdict.no')`))
  ok('已做题目占比上升（1/11 → 9%）', m1[1] === 9, `${m0[1]} → ${m1[1]}`)
  ok('作答写入流水（mode=drill）', n1 === n0 + 1, `${n0} → ${n1}`)
  const drillMode = await b.eval(`(() => {
    const a = JSON.parse(localStorage.getItem('hamstudy:v1:guest') || '{}').attempts || []
    return a.length ? a[a.length - 1].mode : ''
  })()`)
  ok('流水的 mode 标记为 drill（浏览/模考不混入）', drillMode === 'drill', drillMode)
  ok('完成度按指数加权更新', m1[0] >= 0 && m1[0] <= 5, `${m1[0]}%`)

  await clickSel('.act-bar .btn-primary', 700)
  const q2 = await b.eval(`document.querySelector('.qc .qid')?.textContent || ''`)
  ok('「下一题」换到另一道题', q2 && q2 !== q1, `${q1} → ${q2}`)

  const beforeReveal = await metrics()
  const beforeCount = await attemptCount()
  await clickSel('.hint-row button', 600)
  const afterReveal = await metrics()
  ok('「显示答案」亮出参考答案', await b.eval(`!!document.querySelector('.verdict.ref')`))
  ok('显示答案不计分、不计入已做',
    afterReveal[0] === beforeReveal[0] && afterReveal[1] === beforeReveal[1] &&
    await attemptCount() === beforeCount,
    `${beforeReveal.join('/')} → ${afterReveal.join('/')}`)
  ok('显示答案后不能再点选项改判', await b.eval(`document.querySelectorAll('.opt.pickable').length === 0`))

  await clickSel('.act-bar .btn-primary', 600)
  ok('可继续下一题', await b.eval(`!!document.querySelector('.qc')`))
  await clickSel('.pg-act .btn:nth-child(1)', 600)
  ok('「切换范围」回到选择面板', await b.eval(`!!document.querySelector('.picker')`))

  /* ───── 浏览模式 ───── */
  console.log('──── 浏览模式（原学习链路）────')
  await b.goto('/l/technician/T1A', 2600)
  await b.waitFor('.qc')
  ok('浏览页标注「浏览模式」', await b.eval(`document.querySelector('.read-tag')?.textContent.includes('浏览模式')`))
  ok('默认显示正确答案（正确项已高亮）',
    await b.eval(`document.querySelectorAll('.opts .opt.right').length === 1`))
  ok('默认展示参考答案与解析区',
    await b.eval(`!!document.querySelector('.verdict.ref') && !!document.querySelector('.expl')`))
  ok('没有「显示答案」按钮与答题快捷键提示',
    await b.eval(`!document.querySelector('.hint-row') && !document.body.innerText.includes('依次作答 A/B/C/D')`))
  ok('题号导航不再标对错', await b.eval(`document.querySelectorAll('.th.ok, .th.no').length === 0`))
  const browseCount = await attemptCount()
  await clickSel('.opts .opt:nth-child(2)', 600)
  ok('点选项不判分、不写流水',
    await b.eval(`!document.querySelector('.verdict.ok, .verdict.no')`) &&
    await attemptCount() === browseCount,
    `attempts=${browseCount}`)
  ok('浏览页给出刷题模式入口',
    await b.eval(`!!document.querySelector('.read-note a[href="/study"]')`))

  /* ───── 级别页 ───── */
  console.log('──── 级别页 ────')
  await b.goto('/l/technician', 2400)
  await b.waitFor('.browse-note')
  const lvText = await b.eval(`document.body.innerText`)
  ok('级别页有「进入刷题模式」与「从头浏览」',
    lvText.includes('进入刷题模式') && lvText.includes('从头浏览') && !lvText.includes('从头背题'))
  ok('级别页说明浏览模式不计分', lvText.includes('仅供阅读学习，不计分'))
  ok('级别页有刷题入口链接', await b.eval(`!!document.querySelector('.h-r a[href="/study"]')`))

  /* ───── 极窄屏 ───── */
  console.log('──── 窄屏 ────')
  for (const w of [375, 320]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(320)
    await b.goto('/study', 2200)
    await b.waitFor('.qc, .picker', 8000)
    const ov = await b.eval(`document.documentElement.scrollWidth - window.innerWidth`)
    ok(`${w}px 刷题答题页无横向溢出`, ov <= 1, `overflow=${ov}`)
    // 清掉上次范围，检查范围选择面板在极窄屏也不撑破页面
    await b.eval('localStorage.clear()', false)
    await b.goto('/study', 2200)
    await b.waitFor('.picker', 8000)
    const ov2 = await b.eval(`document.documentElement.scrollWidth - window.innerWidth`)
    ok(`${w}px 范围选择页无横向溢出`, ov2 <= 1, `overflow=${ov2}`)
  }

  console.log('\n──── 控制台 ────')
  ok('全程无控制台报错', b.errors.length === 0, b.errors.slice(0, 3).join(' | '))
} finally {
  await b.close()
}

const passed = results.filter(Boolean).length
console.log(`\n结果: ${passed}/${results.length} 通过`)
if (passed !== results.length) process.exit(1)
