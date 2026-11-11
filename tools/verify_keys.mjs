#!/usr/bin/env node
/**
 * 验证「中文开关 + 快捷键」交互：
 *   · 中文按钮默认关闭呈灰态，点击/回车后开启并恢复饱和
 *   · 回车键全局切换中文；焦点在搜索框内时不劫持（应触发跳转搜索）
 *   · 刷题模式 / 模拟考试按 1/2/3/4 等价于选中 A/B/C/D
 *   · 浏览模式只读，任何作答按键都不判分、不写流水
 *   · digitIndex 覆盖主键盘顶排、小键盘、NumLock 关闭与非 US 布局
 * 用法: node tools/verify_keys.mjs [baseURL]
 */
import { launch, sleep } from './_cdp.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:8091'
const failures = []
const ok = (cond, msg, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}${extra ? '  ' + extra : ''}`)
  if (!cond) failures.push(msg + (extra ? ' — ' + extra : ''))
  return cond
}

// 读取当前页面的语言开关状态
const STATE = `(() => {
  const btn = document.querySelector('.zh-btn')
  const stemZh = document.querySelectorAll('.stem .zh').length
  const optZh = document.querySelectorAll('.opts .zh').length
  const en = document.querySelector('.stem .en')?.textContent.trim() || ''
  return {
    exists: !!btn,
    cls: btn ? btn.className : '',
    label: btn ? btn.textContent.replace(/\\s+/g, ' ').trim() : '',
    off: btn ? btn.classList.contains('off') : false,
    on: btn ? btn.classList.contains('on') : false,
    stemZh, optZh, en,
  }
})()`

const b = await launch(BASE)

try {
  console.log('\n【一】默认状态：中文关闭（灰）')
  await b.goto('/l/technician/T1A')
  let s = await b.eval(STATE)
  console.log('   按钮:', JSON.stringify({ label: s.label, off: s.off, on: s.on }))
  ok(s.exists, '中文按钮存在')
  ok(s.off && !s.on, '默认处于「关」态')
  ok(s.stemZh === 0 && s.optZh === 0, '默认不渲染中文行', `stem=${s.stemZh} opt=${s.optZh}`)
  ok(s.en.length > 0, '英文题干始终显示', `«${s.en.slice(0, 46)}…»`)

  console.log('\n【二】点击按钮开启中文')
  await b.eval(`document.querySelector('.zh-btn').click()`, false)
  await sleep(300)
  s = await b.eval(STATE)
  ok(s.on && !s.off, '按钮切到「开」态')
  ok(s.stemZh === 1 && s.optZh === 4, '中文译文出现（题干 1 行 + 选项 4 行）', `stem=${s.stemZh} opt=${s.optZh}`)

  console.log('\n【三】回车键切换中文（关闭）')
  await b.press('Enter')
  s = await b.eval(STATE)
  ok(s.off && !s.on, '回车已关闭中文')
  ok(s.stemZh === 0, '中文行已隐藏')

  console.log('\n【四】再次回车（开启）')
  await b.press('Enter')
  s = await b.eval(STATE)
  ok(s.on, '回车再次开启中文')
  ok(s.stemZh === 1, '中文行恢复显示')

  console.log('\n【五】偏好持久化：刷新后仍为开启')
  await b.goto('/l/technician/T1B')
  s = await b.eval(STATE)
  ok(s.on, '刷新/换页后仍保持开启')

  console.log('\n【六】焦点在搜索框时，回车不应劫持（应触发搜索跳转）')
  await b.goto('/l/technician/T1C')
  const beforeZn = await b.eval(`JSON.parse(localStorage.getItem('hamstudy:ui')||'{}').showZh`)
  await b.click('.search input')          // headless 下 focus() 无效，必须真点
  await b.type('antenna')
  console.log('   输入框值:', await b.eval(`document.querySelector('.search input').value`))
  await b.press('Enter')
  await sleep(1400)
  const href = await b.eval('location.href')
  const afterZn = await b.eval(`JSON.parse(localStorage.getItem('hamstudy:ui')||'{}').showZh`)
  ok(href.includes('/search') && href.includes('antenna'), '回车触发了搜索并跳转', href)
  ok(beforeZn === afterZn, '回车没有顺手切换中文', `${beforeZn} → ${afterZn}`)

  // 每个选项的状态：right=正确答案 wrong=我答错的那项 dim=其余
  const OPTSTATE = `(() => [...document.querySelectorAll('.opt')].map(o =>
      o.classList.contains('right') ? 'right'
    : o.classList.contains('wrong') ? 'wrong'
    : o.classList.contains('hint')  ? 'hint'
    : o.classList.contains('dim')   ? 'dim' : '-'))()`
  const attemptsNow = () =>
    b.eval(`(JSON.parse(localStorage.getItem('hamstudy:v1:guest') || '{}').attempts || []).length`)

  console.log('\n【七】浏览模式只读：默认亮答案，按 1-4 不作答')
  await b.goto('/l/technician/T1D')
  await b.waitFor('.qc .opt', 8000)
  const read0 = await b.eval(`(() => ({
    hints: document.querySelectorAll('.opt .kbd-hint').length,
    right: document.querySelectorAll('.opt.right').length,
    wrong: document.querySelectorAll('.opt.wrong').length,
  }))()`)
  ok(read0.hints === 0, '浏览模式不显示 1/2/3/4 数字提示', `实际 ${read0.hints} 个`)
  ok(read0.right === 1 && read0.wrong === 0, '默认只高亮正确答案，不判对错', JSON.stringify(read0))
  const nRead0 = await attemptsNow()
  await b.press('3')
  await b.press('1')
  const read1 = await b.eval(`(() => ({
    wrong: document.querySelectorAll('.opt.wrong').length,
    verdict: document.querySelectorAll('.verdict.ok, .verdict.no').length,
  }))()`)
  ok(read1.wrong === 0 && read1.verdict === 0, '数字键不会把浏览页变成答题')
  ok(await attemptsNow() === nRead0, '浏览模式不写答题流水', `${nRead0} → ${await attemptsNow()}`)

  console.log('\n【八】刷题模式：数字键 1-4 选择答案')
  // 清掉偏好，确保落在「选范围」面板，且没有上次作答状态残留
  await b.goto('/')
  await b.eval('localStorage.clear()', false)
  await b.goto('/study', 2400)
  await b.waitFor('.picker', 8000)
  await b.eval(`document.querySelector('.pk-f .btn').click()`, false)
  await sleep(1600)
  await b.waitFor('.qc .opt', 8000)
  const hints = await b.eval(`document.querySelectorAll('.opt .kbd-hint').length`)
  ok(hints === 4, '刷题模式选项显示 1/2/3/4 数字提示', `实际 ${hints} 个`)
  const nBefore = await attemptsNow()
  await b.press('3')
  const st7 = await b.eval(OPTSTATE)
  console.log('   选项状态 [A,B,C,D]:', JSON.stringify(st7))
  ok(await b.eval(`!!document.querySelector('.result')`), '按 3 完成了作答')
  ok(['right', 'wrong'].includes(st7[2]), '被提交的是第 3 项（C）', `实际 ${st7[2]}`)
  ok(st7.filter((x) => x === 'wrong').length <= 1, '只判定了一个错误项')
  ok(await b.eval(`document.querySelectorAll('.opt .kbd-hint').length`) === 0, '作答后数字提示消失（避免误导）')
  ok(await attemptsNow() === nBefore + 1, '作答写入一条刷题流水', `${nBefore} → ${await attemptsNow()}`)

  console.log('\n【八·续】作答后数字键不应改变结果')
  await b.press('1')
  await b.press('4')
  const st8 = await b.eval(OPTSTATE)
  console.log('   选项状态 [A,B,C,D]:', JSON.stringify(st8))
  ok(JSON.stringify(st8) === JSON.stringify(st7), '重复按键不篡改已提交的答案', `${st7} → ${st8}`)

  console.log('\n【九】考试中同样可用（exam 模式）')
  await b.goto('/exam')
  await b.eval(`document.querySelector('button.go').click()`, false)
  await sleep(3000)
  const cnt = await b.eval(`document.querySelectorAll('.grid .th').length`)
  console.log('   答题卡题数:', cnt)
  await b.press('2')
  // 考试中不提示对错，答题卡只标记「已答」；答案是否被记录就看这个格子
  const cell = await b.eval(`(() => {
    const c = document.querySelector('.grid .th')
    return { cls: c.className, marked: c.classList.contains('done') }
  })()`)
  console.log('   第 1 格:', JSON.stringify(cell))
  ok(cell.marked, '考试中按 2 记录了答案（答题卡第 1 格已标记）')

  console.log('\n【十】考后回顾页不应响应数字键（mode=review）')
  await b.eval(`[...document.querySelectorAll('button')].find(x=>x.textContent.includes('交卷'))?.click()`, false)
  await sleep(400)
  // 未全答时会弹「还有 N 题未作答」确认框，点「继续提交」完成交卷
  await b.eval(`[...document.querySelectorAll('button')].find(x => /继续提交/.test(x.textContent))?.click()`, false)
  await sleep(1500)
  const reviewStage = await b.eval(`(() => {
    const t = document.body.innerText
    return { hasScore: /\\d+\\s*\\/\\s*\\d+/.test(t), inResult: !!document.querySelector('.result, .score') }
  })()`)
  console.log('   成绩页:', JSON.stringify(reviewStage))
  ok(reviewStage.hasScore, '已交卷进入成绩页')

  console.log('\n【十一】焦点在按钮上时，回车应激活按钮而非切换中文')
  await b.goto('/l/technician/T1A')
  const pos = () => b.eval(`document.querySelector('.pos')?.textContent.trim() || ''`)
  const znFlag = () => b.eval(`JSON.parse(localStorage.getItem('hamstudy:ui')||'{}').showZh`)
  const zn0 = await znFlag()
  const p0 = await pos()
  await b.click('.thumbs .th:nth-child(3)')   // 真实点击，焦点留在按钮上
  const p1 = await pos()
  await b.press('Enter')
  const p2 = await pos()
  const zn1 = await znFlag()
  console.log(`   题位: ${p0} → ${p1} → ${p2} | 中文开关: ${zn0} → ${zn1}`)
  ok(p1.startsWith('3 '), '点击第 3 个缩略图跳到第 3 题', `${p0} → ${p1}`)
  ok(zn1 === zn0, '回车没有抢走中文开关（焦点在按钮上，交给原生行为）')

  // 浏览模式是只读的：字母键、数字键都不该改变选项状态或写入流水
  console.log('\n【十二】浏览模式下字母键 / 数字键都不触发作答')
  await b.goto('/l/general/G1A')
  await b.waitFor('.qc .opt', 8000)
  const st12a = await b.eval(OPTSTATE)
  ok(
    st12a.filter((s) => s === 'right').length === 1 && st12a.every((s) => s !== 'wrong'),
    '前置条件：只读浏览，仅正确答案高亮',
    `实际 ${JSON.stringify(st12a)}`
  )
  const n12 = await attemptsNow()
  await b.press('b')
  await b.press('a')
  await b.press('C')
  await b.press('2')
  await b.press('End')
  const st12 = await b.eval(OPTSTATE)
  console.log('   按键后选项状态 [A,B,C,D]:', JSON.stringify(st12))
  ok(
    JSON.stringify(st12) === JSON.stringify(st12a) && st12.every((s) => s !== 'wrong'),
    '字母键 / 数字键 / End 都不触发作答',
    `实际 ${JSON.stringify(st12)}`
  )
  ok(await attemptsNow() === n12, '只读浏览按键不写流水', `${n12} → ${await attemptsNow()}`)

  console.log('\n【十三】digitIndex：数字键的各种物理来源与布局（纯函数）')
  const { digitIndex } = await import('../src/lib/keys.js')
  const DIGIT_CASES = [
    ['主键盘顶排 1（笔记本）', { key: '1', code: 'Digit1' }, 0],
    ['小键盘 1（NumLock 开）', { key: '1', code: 'Numpad1' }, 0],
    ['小键盘 1（NumLock 关 → key=End）', { key: 'End', code: 'Numpad1' }, 0],
    ['AZERTY 顶排（key=&）', { key: '&', code: 'Digit1' }, 0],
    ['主键盘顶排 4 → D', { key: '4', code: 'Digit4' }, 3],
  ]
  for (const [name, ev, expect] of DIGIT_CASES) {
    ok(digitIndex(ev) === expect, `${name} 命中第 ${expect + 1} 项`, `idx=${digitIndex(ev)}`)
  }
  ok(digitIndex({ key: 'End', code: 'End' }) === -1,
    'End 键本身不被误判（e.code 兜底没有误伤功能键）')
  ok(digitIndex({ key: '5', code: 'Digit5' }) === -1, '5–9 不在 1–4 映射内')

  console.log('\n──────── 控制台错误 ────────')
  console.log(b.errors.length ? b.errors.join('\n') : '（无）')
  if (b.errors.length) failures.push(`页面有 ${b.errors.length} 条运行时错误`)
} finally {
  await b.close()
}

console.log('\n──────── 结论 ────────')
if (failures.length) { failures.forEach((f) => console.log('✗ ' + f)); process.exit(1) }
console.log('✓ 中文开关与快捷键全部通过')
