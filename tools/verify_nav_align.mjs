#!/usr/bin/env node
/**
 * 导航对齐回归：滚动条槽位恒定，六个主页面的头部 / 导航位置完全一致。
 *
 * 背景：经典滚动条会占掉约 10px 视口宽度，内容长的页面出现滚动条后
 * 居中的 .hdr-in 会整体左移 5px，造成「模拟考试 / 收藏夹」这类短页面
 * 与「首页 / 刷题 / 错题本 / 进度」看起来差半个身位。
 *
 * 覆盖：六页面 clientWidth / 槽位 / 头部 / 导航逐项位置、滚动后吸顶、
 *       四种窄屏宽度无横向溢出、无控制台错误。
 *
 * 用法: node tools/verify_nav_align.mjs [baseURL]
 */
import { launch, sleep } from './_cdp.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:8091'
const b = await launch(BASE, { port: 9497, quiet: true })

let passed = 0
const fails = []
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✓', name) }
  else { fails.push(name); console.log('  ✗', name, extra ? `— ${extra}` : '') }
}

const PATHS = ['/', '/study', '/exam', '/wrong', '/fav', '/progress']

const MEASURE = `(() => {
  const h = document.querySelector('.hdr-in')?.getBoundingClientRect()
  const n = document.querySelector('.nav')?.getBoundingClientRect()
  const round = (v) => Math.round(v * 100) / 100
  return {
    path: location.pathname,
    innerW: window.innerWidth,
    clientW: document.documentElement.clientWidth,
    gutter: window.innerWidth - document.documentElement.clientWidth,
    hdrLeft: h ? round(h.left) : null,
    navLeft: n ? round(n.left) : null,
    items: [...document.querySelectorAll('.nav-i')].map((e) => round(e.getBoundingClientRect().left)),
    hasVScroll: document.documentElement.scrollHeight > window.innerHeight,
    overflowY: getComputedStyle(document.documentElement).overflowY,
  }
})()`

try {
  console.log('──── 六个主页面：槽位与导航位置 ────')
  const rows = []
  for (const p of PATHS) {
    await b.goto(p, 1500)
    const r = await b.eval(MEASURE)
    rows.push(r)
    console.log(`   ${p.padEnd(10)} clientW=${r.clientW} 槽位=${r.gutter} 头部=${r.hdrLeft} 导航=${r.navLeft} 滚动条=${r.hasVScroll ? '有' : '无'}`)
  }

  const first = rows[0]
  ok('六个页面都渲染出 6 个导航项', rows.every((r) => r.items.length === 6))
  ok('html 恒定为 overflow-y: scroll', rows.every((r) => r.overflowY === 'scroll'),
    rows.map((r) => r.overflowY).join(','))
  ok('滚动条槽位宽度在六页完全一致', rows.every((r) => r.gutter === first.gutter),
    rows.map((r) => `${r.path}:${r.gutter}`).join(' '))
  ok('clientWidth 在六页完全一致', rows.every((r) => r.clientW === first.clientW),
    rows.map((r) => `${r.path}:${r.clientW}`).join(' '))
  ok('头部容器左边缘在六页完全一致', rows.every((r) => r.hdrLeft === first.hdrLeft),
    rows.map((r) => `${r.path}:${r.hdrLeft}`).join(' '))
  ok('导航容器左边缘在六页完全一致', rows.every((r) => r.navLeft === first.navLeft),
    rows.map((r) => `${r.path}:${r.navLeft}`).join(' '))
  ok('六个导航项逐个位置一致（含模拟考试 / 收藏夹）',
    rows.every((r) => r.items.every((x, k) => x === first.items[k])),
    JSON.stringify(rows.map((r) => [r.path, r.items[2], r.items[4]])))
  ok('样本同时覆盖有滚动条与无滚动条页面',
    rows.some((r) => r.hasVScroll) && rows.some((r) => !r.hasVScroll),
    rows.map((r) => `${r.path}:${r.hasVScroll}`).join(' '))

  console.log('\n──── 滚动后头部仍吸顶 ────')
  await b.goto('/progress', 1400)
  await b.eval('window.scrollTo(0, 420)', false)
  await sleep(350)
  const top = await b.eval(`document.querySelector('.hdr').getBoundingClientRect().top`)
  ok('长页面滚动后 sticky 头部仍在顶部', Math.abs(top) < 1, `top=${top}`)
  await b.eval('window.scrollTo(0, 0)', false)

  console.log('\n──── 窄屏不引入横向溢出 ────')
  for (const w of [900, 680, 375, 320]) {
    await b.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: 900, deviceScaleFactor: 1, mobile: false,
    })
    await sleep(280)
    let worst = 0
    for (const p of ['/exam', '/fav', '/progress']) {
      await b.goto(p, 900)
      const ov = await b.eval(`document.documentElement.scrollWidth - window.innerWidth`)
      worst = Math.max(worst, ov)
    }
    ok(`${w}px 三个代表性页面无横向溢出`, worst <= 1, `最大溢出=${worst}`)
  }
  await b.send('Emulation.clearDeviceMetricsOverride', {})

  console.log('\n──── 控制台 ────')
  ok('全程无控制台报错', b.errors.length === 0, b.errors.slice(0, 3).join(' | '))
} finally {
  await b.close()
}

console.log(`\n结果: ${passed}/${passed + fails.length} 通过`)
if (fails.length) {
  console.log('失败项:', fails.join(' / '))
  process.exitCode = 1
}
