#!/usr/bin/env node
/**
 * 用无头 Chrome 走一遍「模拟考试」点击链路，验证按钮确实能跳转且无运行时报错。
 * 用法: node tools/verify_exam.mjs [baseURL]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8091'
const PORT = 9333
/** 依次探测本机可用的 Chromium 内核浏览器 */
const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function http(method, url, body) {
  const res = await fetch(url, { method, body, headers: body ? { 'Content-Type': 'application/json' } : {} })
  return res.json()
}

const CHROME = BROWSERS.find((p) => fs.existsSync(p))
if (!CHROME) {
  console.error('未找到可用的 Chromium 内核浏览器（Chrome / Edge / Chromium / Brave）')
  process.exit(2)
}
console.log('使用浏览器:', CHROME.split('/')[2])

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-proxy-server',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  '--no-first-run', '--disable-extensions', 'about:blank',
], { stdio: 'ignore' })

let ws, failures = []
const errors = []

try {
  // 等调试端口就绪
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    try { target = await http('PUT', `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE)}`) }
    catch { try { target = await http('PUT', `http://127.0.0.1:${PORT}/json/new?${BASE}`) } catch { await sleep(250) } }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('无法连接 Chrome 调试端口')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })

  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('未捕获异常: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map((a) => a.description || a.value).join(' '))
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('日志错误: ' + m.params.entry.text)
    }
  }
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id
    pending.set(i, (m) => r(m.result))
    ws.send(JSON.stringify({ id: i, method, params }))
  })

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')

  const evaluate = async (expr, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
    if (r.exceptionDetails) throw new Error('求值异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result.value
  }

  // 1) 打开模考入口页
  await send('Page.navigate', { url: `${BASE}/exam` })
  await sleep(2500)

  const before = await evaluate('location.href')
  console.log('① 入口页:', before)

  const btnCount = await evaluate(`document.querySelectorAll('button.go').length`)
  console.log('② 找到「开始模考」按钮数:', btnCount)
  if (!btnCount) failures.push('入口页没有渲染出任何开始按钮')

  const btnText = await evaluate(`document.querySelector('button.go')?.textContent.trim()`)
  console.log('   按钮文案:', btnText)

  // 2) 真实点击
  if (btnCount) {
    await evaluate(`document.querySelector('button.go').click()`, false)
    await sleep(3000)
  }

  const after = await evaluate('location.href')
  console.log('③ 点击后 URL:', after)

  if (after === before) failures.push('点击后 URL 未变化 —— 按钮仍然无响应')
  else console.log('   ✓ 路由已跳转')

  // 3) 检查是否真的进入了考试界面（而不是白屏/报错卡住）
  const state = await evaluate(`(() => {
    const txt = document.body.innerText || ''
    return {
      hasTimer: /^\\d{2}:\\d{2}$/m.test(txt),
      hasSheet: !!document.querySelector('.grid .th'),
      loading: txt.includes('正在组卷'),
      err: txt.includes('组卷失败'),
      sheetCount: document.querySelectorAll('.grid .th').length,
      errText: (txt.match(/组卷失败：.*/) || [''])[0],
      head: txt.slice(0, 120).replace(/\\n+/g, ' | '),
    }
  })()`)
  console.log('④ 考试页状态:', JSON.stringify(state, null, 1))

  if (state.err) failures.push('进入考试页即组卷失败: ' + state.errText)
  if (state.loading) failures.push('卡在「正在组卷」，可能异常被吞')
  if (!state.hasSheet) failures.push('答题卡未渲染')
  if (state.sheetCount !== 35 && state.sheetCount !== 50) {
    failures.push(`答题卡题数异常: ${state.sheetCount}（技术级应 35 / 业余特级应 50）`)
  } else {
    console.log(`   ✓ 答题卡 ${state.sheetCount} 题`)
  }

  console.log('\n──────── 控制台错误 ────────')
  console.log(errors.length ? errors.join('\n') : '（无）')
  if (errors.length) failures.push(`页面有 ${errors.length} 条运行时错误`)
} finally {
  try { ws?.close() } catch {}
  chrome.kill()
  // 浏览器退出需要一点时间，等它释放 profile 目录再清理
  await sleep(1200)
  try { fs.rmSync(userDir, { recursive: true, force: true }) } catch {}
}

console.log('\n──────── 结论 ────────')
if (failures.length) { failures.forEach((f) => console.log('✗ ' + f)); process.exit(1) }
console.log('✓ 模拟考试点击链路全部通过')
