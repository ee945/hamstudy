#!/usr/bin/env node
/**
 * 回归：学习练习模式在任意视口宽度下都要正常显示。
 *
 * 历史 bug 1（收起边栏）：.layout 用 grid-template-columns: 216px 1fr 显式声明两列，
 *   aside 只是 display:none，列轨道并不会因此消失，剩下唯一的 .stage 被自动放置到
 *   第一列（216px 窄列），看起来就是「题目区缩小并占据到边栏」。
 *   修复：.layout.no-side 在收起时切成单列 1fr。
 *
 * 历史 bug 2（窄屏覆盖）：@media(max-width:900px) 把 aside 改成 position:fixed 的
 *   全宽浮层，但它默认展开，宽度一缩小就整片盖住题目，必须先点 × 才能看题。
 *   修复：窄屏改「默认收起的抽屉」，宽屏双栏 / 窄屏抽屉两套状态分开记，
 *   遮罩、×、ESC、点空白处、选完小节均可收起；跨断点缩放不互相干扰。
 *
 * 只测像素几何与交互，不做截图、不写任何业务数据。
 */
import { launch, sleep } from './_cdp.mjs'

const b = await launch('http://127.0.0.1:8091', { port: 9441, quiet: true })
const results = []
const ok = (name, cond, detail = '') => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? `  (${detail})` : ''))
}

const setW = async (w) => {
  await b.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: 900, deviceScaleFactor: 1, mobile: false,
  })
  await sleep(320)
}
/** 在指定坐标真实点一下。遮罩全屏但抽屉浮在它上面，
 *  b.click('.mask') 取的是元素中心，会落在抽屉里，测不到遮罩本身。 */
const clickAt = async (x, y) => {
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(350)
}
const measure = () =>
  b.eval(`(() => {
    const r = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().width) : -1 }
    const side = document.querySelector('.side')
    const lay = document.querySelector('.layout')
    const qc = document.querySelector('.qc')
    const q = qc ? qc.getBoundingClientRect() : null
    const hit = q ? document.elementFromPoint(q.x + q.width / 2, q.y + Math.min(50, q.height / 2)) : null
    return {
      layout: r('.layout'), stage: r('.stage'), side: r('.side'),
      cols: getComputedStyle(lay).gridTemplateColumns,
      sideDisplay: getComputedStyle(side).display,
      sidePos: getComputedStyle(side).position,
      cover: !!(hit && hit.closest('.side')),
      mask: !!document.querySelector('.mask'),
      toggle: !!document.querySelector('.side-toggle'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }
  })()`)

try {
  await b.goto('/l/technician/T1A', 2600)
  await b.waitFor('.stage')

  console.log('──── 宽屏收起 / 恢复（1400px）────')
  await setW(1400)
  const before = await measure()
  await b.click('.side-h button', 500) // × 收起
  const after = await measure()
  await b.click('.bar-r button', 500) // 「小节导航」恢复
  const restored = await measure()
  console.log('显示边栏 :', JSON.stringify(before))
  console.log('收起边栏 :', JSON.stringify(after))
  console.log('恢复边栏 :', JSON.stringify(restored))
  ok('边栏显示时题目区被侧栏挤窄', before.side > 0 && before.stage < before.layout - 200)
  ok('收起后题目区占满整行', Math.abs(after.stage - after.layout) <= 2)
  ok('收起后题目区确实变宽', after.stage > before.stage + 150)
  ok('收起后侧栏已隐藏', after.side === 0)
  ok('恢复后回到两列布局', Math.abs(restored.stage - before.stage) <= 2 && restored.side > 0)

  console.log('\n──── 各宽度默认状态（不点 ×，题目必须完整可见）────')
  for (const w of [1400, 1100, 960, 901, 900, 768, 640, 480, 375, 320]) {
    await setW(w)
    const m = await measure()
    console.log(String(w).padStart(4), JSON.stringify(m))
    const wide = w > 900
    ok(`${w}px：${wide ? '双栏且侧栏可见' : '侧栏收起、题目区单行全宽'}`,
      wide ? m.sideDisplay === 'block' && m.side > 0 && m.stage < m.layout - 150
           : m.sideDisplay === 'none' && m.side === 0 && Math.abs(m.stage - m.layout) <= 2)
    ok(`${w}px：题目中心未被侧栏遮挡`, !m.cover)
    ok(`${w}px：无横向溢出`, m.overflow <= 1, `overflow=${m.overflow}`)
    ok(`${w}px：默认无遮罩`, !m.mask)
  }

  console.log('\n──── 窄屏抽屉交互（768px）────')
  await setW(768)
  const closed = await measure()
  ok('窄屏提供「小节导航」按钮', closed.toggle)
  await b.click('.side-toggle', 400)
  const opened = await measure()
  ok('点按钮后抽屉浮出且有遮罩',
    opened.sideDisplay === 'block' && opened.sidePos === 'fixed' && opened.mask)
  ok('抽屉打开时题目区仍占满整行（栅格未被挤窄）',
    Math.abs(opened.stage - opened.layout) <= 2)
  await b.click('.side-h button', 400)
  const closedByX = await measure()
  ok('点 × 收起抽屉', !closedByX.mask && closedByX.sideDisplay === 'none')
  await b.click('.side-toggle', 400)
  await b.press('Escape')
  ok('ESC 收起抽屉', (await measure()).sideDisplay === 'none')
  await b.click('.side-toggle', 400)
  // 不要硬编码屏幕坐标：页面多加一行说明后，固定点会落到题号/导航链接上，
  // 一点就跳页，后续断言全乱。按抽屉的实际下沿取一个仍在视口内的点。
  const hit = await b.eval(`(() => {
    const side = document.querySelector('.side')
    if (!side || !document.querySelector('.mask')) return { ok: false, cls: '', x: 0, y: 0 }
    const r = side.getBoundingClientRect()
    const x = Math.max(10, Math.min(window.innerWidth - 20, r.left + 20))
    const y = Math.max(10, Math.min(window.innerHeight - 20, r.bottom + 50))
    const e = document.elementFromPoint(x, y)
    return { ok: !!(e && e.classList.contains('mask')), cls: String(e?.className || ''), x, y }
  })()`)
  ok('抽屉之外的空白区域确实是遮罩', hit.ok, `${hit.cls} @${hit.x},${hit.y}`)
  await clickAt(hit.x, hit.y)
  ok('点遮罩空白处收起抽屉', (await measure()).sideDisplay === 'none')

  // 选中另一个小节后抽屉必须自动收起，不能继续盖住新题目
  await b.click('.side-toggle', 400)
  await b.click('.side-body .si:nth-of-type(3)', 1200)
  const afterNav = await measure()
  ok('选完小节自动收起抽屉', afterNav.sideDisplay === 'none' && !afterNav.mask)

  console.log('\n──── 动态缩放：宽 → 窄 → 宽 ────')
  await setW(1400)
  const w1 = await measure()
  await setW(700)
  const w2 = await measure()
  await setW(1400)
  const w3 = await measure()
  ok('缩到窄屏瞬间不会弹出浮层盖住题目',
    w1.sideDisplay === 'block' && w2.sideDisplay === 'none' && !w2.cover)
  ok('拉回宽屏恢复双栏', w3.sideDisplay === 'block' && w3.side > 0)

  console.log('\n──── 主要页面在极窄屏无横向溢出 ────')
  for (const w of [375, 320]) {
    await setW(w)
    for (const p of ['/', '/exam/technician', '/l/technician/T1A']) {
      await b.goto(p, 2200)
      const ov = await b.eval('document.documentElement.scrollWidth - window.innerWidth')
      ok(`${w}px ${p} 无横向溢出`, ov <= 1, `overflow=${ov}`)
    }
  }

  console.log('\n──── 控制台 ────')
  ok('全程无控制台报错', b.errors.length === 0, b.errors.slice(0, 2).join(' | '))
} finally {
  await b.close()
}

const passed = results.filter(Boolean).length
console.log(`\n结果: ${passed}/${results.length} 通过`)
if (passed !== results.length) process.exit(1)
