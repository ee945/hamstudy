#!/usr/bin/env node
/**
 * 回归：模拟考试手动交卷时，有未作答题必须弹确认框。
 *
 * 覆盖：两个交卷入口、未答题号清单（序号 + 题号）、弹窗期间禁止键盘作答、
 * 点遮罩 / ESC / 「返回作答」关闭、点题号跳题、答完一题后数量同步、
 * 「继续提交」真正交卷、全部答完不弹窗、结果页未答数与清单一致。
 *
 * 倒计时归零的自动交卷走 timer → submit()（不经过 requestSubmit），
 * 天然不会弹窗；60/75 分钟的路径无法在合理时间内模拟，由代码路径保证，
 * 不在本脚本断言范围内。
 *
 * 全程游客态：学习数据只写浏览器 localStorage，独立 profile 关闭即销毁，
 * 不会写入 PocketBase。
 */
import { launch, sleep } from './_cdp.mjs'

const BASE = 'http://127.0.0.1:8091'
const QUESTIONS = 35
const b = await launch(BASE, { port: 9461, quiet: true })
let pass = 0
let total = 0
const ok = (name, cond, extra = '') => {
  total++
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''))
  if (cond) pass++
}

/** 弹窗快照；未出现时返回 null */
const dlgInfo = () => b.eval(`(() => {
  const d = document.querySelector('.dlg')
  if (!d) return null
  return {
    title: d.querySelector('h3')?.textContent.trim() || '',
    p: d.querySelector('.dlg-p')?.textContent.trim() || '',
    chips: [...d.querySelectorAll('.blank-chip')].map((x) => ({
      no: x.querySelector('b')?.textContent.trim() || '',
      qid: x.querySelector('span')?.textContent.trim() || '',
    })),
    acts: [...d.querySelectorAll('.dlg-acts button')].map((x) => x.textContent.trim()),
    role: d.getAttribute('role'),
    modal: d.getAttribute('aria-modal'),
  }
})()`)

const page = () => b.eval(`(() => ({
  running: !!document.querySelector('.bar .mono'),
  result: !!document.querySelector('.res'),
  dlg: !!document.querySelector('.dlg'),
  sheet: document.querySelectorAll('.grid .th').length,
  done: document.querySelectorAll('.grid .th.done').length,
  cur: document.querySelector('.grid .th.cur')?.textContent.trim() || '',
  bar: document.querySelector('.bar .b-m')?.innerText.replace(/\\n+/g, ' | ') || '',
  blankCell: [...document.querySelectorAll('.f')].find(
    (f) => f.querySelector('span')?.textContent.trim() === '未答'
  )?.querySelector('b')?.textContent.trim() || '',
  chips: document.querySelectorAll('.chips .chip').length,
}))()`)

const clickText = (sel, re) => b.eval(
  `[...document.querySelectorAll(${JSON.stringify(sel)})].find(x => ${re}.test(x.textContent))?.click()`,
  false,
)
const clickSubmit = (sel) => b.eval(
  `[...document.querySelectorAll(${JSON.stringify(sel)})].find(x => /交卷/.test(x.textContent))?.click()`,
  false,
)

try {
  // ── 一、初始：整卷未答 ──────────────────────────────
  console.log('\n【一】进入技术级模考，整卷未答')
  await b.goto('/exam/technician', 2600)
  await b.waitFor('.grid .th', 12000)
  let p = await page()
  console.log('   ', JSON.stringify(p))
  ok('进入考试页且未出结果', p.running && !p.result)
  ok(`答题卡 ${QUESTIONS} 题`, p.sheet === QUESTIONS, `(${p.sheet})`)
  ok('初始 0 题已答', p.done === 0, `(${p.done})`)

  // ── 二、顶栏「交卷」→ 弹窗与清单 ────────────────────
  console.log('\n【二】顶栏「交卷」弹出未作答确认')
  await clickSubmit('.b-r button')
  await sleep(450)
  const d1 = await dlgInfo()
  console.log('   ', JSON.stringify({ title: d1?.title, p: d1?.p, n: d1?.chips.length, acts: d1?.acts }))
  ok('出现确认弹窗', !!d1)
  ok(`标题为「还有 ${QUESTIONS} 题未作答」`, d1?.title === `还有 ${QUESTIONS} 题未作答`, d1?.title)
  ok('说明含「是否继续提交」', /是否继续提交/.test(d1?.p || ''))
  ok(`列出 ${QUESTIONS} 道未作答题`, d1?.chips.length === QUESTIONS, `(${d1?.chips.length})`)
  ok('清单含序号与题号', d1?.chips[0]?.no === '1' && /^T\d/.test(d1?.chips[0]?.qid || '') &&
    d1?.chips.at(-1)?.no === String(QUESTIONS), JSON.stringify(d1?.chips.slice(0, 2)))
  ok('清单按试卷顺序递增', d1?.chips.every((c, k) => c.no === String(k + 1)))
  ok('提供「返回作答」与「继续提交」',
    d1?.acts.includes('返回作答') && d1?.acts.includes('继续提交'))
  ok('弹窗带 dialog / aria-modal', d1?.role === 'dialog' && d1?.modal === 'true')

  // ── 三、弹窗期间禁止键盘作答 ─────────────────────────
  console.log('\n【三】弹窗期间数字键不应穿透到背后题目')
  await b.press('1', { wait: 200 })
  await sleep(250)
  p = await page()
  const d1b = await dlgInfo()
  ok('按 1 未写出答案', p.done === 0, `(done=${p.done})`)
  ok('未答题清单仍是 35 条', d1b?.chips.length === QUESTIONS)
  // 确认框不是「暂停考试」：计时照常，时间到仍会自动交卷
  const t0 = await b.eval(`document.querySelector('.bar .mono')?.textContent.trim()`)
  await sleep(2200)
  const t1 = await b.eval(`document.querySelector('.bar .mono')?.textContent.trim()`)
  ok('弹窗期间倒计时照常走', !!t0 && t0 !== t1, `${t0} → ${t1}`)

  // ── 四、点遮罩空白处 = 返回作答 ──────────────────────
  console.log('\n【四】点遮罩空白处关闭')
  await b.eval(`document.querySelector('.mask')?.click()`, false)
  await sleep(400)
  p = await page()
  ok('弹窗已关闭', !p.dlg)
  ok('仍在考试页（未交卷）', p.running && !p.result)
  ok('跳到第一道未作答题', p.cur === '1', `(cur=${p.cur})`)

  // ── 五、ESC 关闭 ────────────────────────────────────
  console.log('\n【五】ESC 关闭')
  await clickSubmit('.b-r button')
  await sleep(350)
  ok('弹窗再次出现', !!(await dlgInfo()))
  await b.press('Escape', { code: 'Escape', vk: 27, text: '' })
  await sleep(400)
  p = await page()
  ok('ESC 关闭弹窗且未交卷', !p.dlg && p.running && !p.result)

  // ── 六、答题卡「交卷判分」入口 + 点题号跳题 ──────────
  console.log('\n【六】第二个交卷入口与点击题号跳题')
  await clickText('.sheet button', '/交卷判分/')
  await sleep(400)
  const d2 = await dlgInfo()
  ok('「交卷判分」同样弹窗', !!d2)
  const fifthQid = d2?.chips[4]?.qid || ''
  await b.click('.blank-chip:nth-child(5)', 500)
  p = await page()
  ok('点第 5 个题号后弹窗关闭', !p.dlg)
  ok('跳到第 5 题', p.cur === '5', `(cur=${p.cur}, qid=${fifthQid})`)
  ok('仍未交卷', p.running && !p.result)

  // ── 七、答 1 题后清单同步 ────────────────────────────
  console.log('\n【七】答一题后未答清单同步减少')
  await b.press('1', { wait: 250 })
  await sleep(600)
  p = await page()
  ok('已记录 1 题答案', p.done === 1, `(done=${p.done})`)
  await clickSubmit('.b-r button')
  await sleep(400)
  const d3 = await dlgInfo()
  console.log('   ', JSON.stringify({ title: d3?.title, n: d3?.chips.length }))
  ok('标题变「还有 34 题未作答」', d3?.title === '还有 34 题未作答', d3?.title)
  ok('清单剩 34 条', d3?.chips.length === QUESTIONS - 1, `(${d3?.chips.length})`)
  ok('已答的第 5 题不再出现在清单', !d3?.chips.some((c) => c.qid === fifthQid), fifthQid)

  // ── 八、「返回作答」按钮 ─────────────────────────────
  console.log('\n【八】「返回作答」')
  await clickText('.dlg-acts button', '/返回作答/')
  await sleep(400)
  p = await page()
  ok('弹窗关闭且未交卷', !p.dlg && p.running && !p.result)
  ok('跳到第一道未作答题', p.cur === '1', `(cur=${p.cur})`)

  // ── 九、「继续提交」真正交卷 ─────────────────────────
  console.log('\n【九】「继续提交」完成交卷')
  await clickSubmit('.b-r button')
  await sleep(350)
  await clickText('.dlg-acts button', '/继续提交/')
  await sleep(1300)
  p = await page()
  console.log('   ', JSON.stringify(p))
  ok('进入结果页', p.result && !p.running)
  ok('弹窗已收起', !p.dlg)
  ok('结果页「未答」= 34', p.blankCell === '34', `(未答=${p.blankCell})`)
  ok('逐题回顾 35 个 chip', p.chips === QUESTIONS, `(${p.chips})`)

  // ── 十、全部答完不弹窗 ───────────────────────────────
  console.log('\n【十】全部答完直接交卷，不再打扰')
  await b.goto('/exam/technician', 2600)
  await b.waitFor('.grid .th', 12000)
  for (let n = 0; n < QUESTIONS; n++) {
    // 显式定位每一题，避开「首次作答自动跳下一题」的 260ms 竞态
    await b.eval(`document.querySelectorAll('.grid .th')[${n}]?.click()`, false)
    await sleep(60)
    await b.press('1', { wait: 60 })
    await sleep(300)
  }
  p = await page()
  console.log('   ', JSON.stringify({ sheet: p.sheet, done: p.done, bar: p.bar }))
  ok('35 题全部已答', p.done === QUESTIONS, `(done=${p.done})`)
  await clickText('.sheet button', '/交卷判分/')
  await sleep(1300)
  p = await page()
  ok('不出现确认弹窗', !p.dlg)
  ok('直接进入结果页', p.result)
  ok('结果页「未答」= 0', p.blankCell === '0', `(未答=${p.blankCell})`)

  // ── 十一、控制台 ────────────────────────────────────
  console.log('\n【十一】控制台')
  ok('全程无控制台报错', b.errors.length === 0)
  if (b.errors.length) console.log('  errors:', b.errors.slice(0, 4))
} finally {
  await b.close()
}

console.log(`\n结果: ${pass}/${total} 通过`)
process.exitCode = pass === total ? 0 : 1
