#!/usr/bin/env node
/**
 * 无头浏览器测试脚手架（CDP）。
 * Node 22 自带 WebSocket，不需要 puppeteer；自动探测本机 Chromium 内核浏览器。
 *
 *   import { launch } from './_cdp.mjs'
 *   const b = await launch('http://127.0.0.1:8091')
 *   await b.goto('/l/technician/T1A')
 *   const title = await b.eval('document.title')
 *   await b.close()
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
]

async function http(method, url, body) {
  const res = await fetch(url, {
    method,
    body,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  })
  return res.json()
}

export async function launch(base, { port = 9333, quiet = false } = {}) {
  const chromePath = BROWSERS.find((p) => fs.existsSync(p))
  if (!chromePath) throw new Error('未找到可用的 Chromium 内核浏览器（Chrome / Edge / Chromium / Brave）')
  if (!quiet) console.log('使用浏览器:', chromePath.split('/')[2])

  // 端口上若已有实例，/json/new 会静默连到它 —— 于是改了代码却测到旧页面，
  // 而且带旧缓存。这种失败极难排查，开工前先挡掉。
  const occupied = await fetch(`http://127.0.0.1:${port}/json/version`)
    .then(() => true)
    .catch(() => false)
  if (occupied) {
    throw new Error(
      `调试端口 ${port} 已被占用，多半是上次崩溃残留的浏览器实例。\n` +
      `  先执行： lsof -nP -iTCP:${port} -sTCP:LISTEN  找到 PID 后 kill 掉，再重跑。`
    )
  }

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-proxy-server',
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    '--window-size=1400,1000',
    '--no-first-run', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' })

  const errors = []
  let ws

  try {
    let target = null
    for (let i = 0; i < 40 && !target; i++) {
      try { target = await http('PUT', `http://127.0.0.1:${port}/json/new?${encodeURIComponent(base)}`) }
      catch { await sleep(250) }
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
    // 站点在 <900px 会隐藏搜索框，无头默认视口只有 800x600，必须显式放宽
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false,
    })

    const evaluate = async (expr, awaitPromise = true) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
      if (r.exceptionDetails) {
        throw new Error('求值异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
      }
      return r.result.value
    }

    return {
      errors,
      eval: evaluate,
      send,
      /** 跳转并等待页面稳定 */
      async goto(url, wait = 2200) {
        await send('Page.navigate', { url: base + url })
        await sleep(wait)
      },
      /**
       * 真实鼠标点击某个选择器。
       * 注意：headless 下 elem.focus() 常常无效（activeElement 仍是 body），
       * 必须用鼠标事件才能真正把焦点交给输入框。
       */
      async click(sel, wait = 350) {
        const r = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el) return null
          const b = el.getBoundingClientRect()
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
        })()`)
        if (!r) throw new Error('选择器未找到: ' + sel)
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
        await sleep(wait)
      },
      /** 轮询等待某个选择器出现，避免题库异步加载没赶上就断言 */
      async waitFor(sel, timeout = 8000) {
        const t0 = Date.now()
        while (Date.now() - t0 < timeout) {
          const hit = await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
          if (hit) return true
          await sleep(200)
        }
        return false
      },
      /** 向聚焦元素输入文本（逐字符，触发 input 事件链） */
      async type(text, wait = 120) {
        for (const ch of text) {
          await send('Input.insertText', { text: ch })
          await sleep(30)
        }
        await sleep(wait)
      },
      /** 真实按键：走 Input.dispatchKeyEvent，等价于用户敲击键盘 */
      async press(key, opts = {}) {
        const code = opts.code || (/^[1-4]$/.test(key) ? `Digit${key}` : key === 'Enter' ? 'Enter' : '')
        const text = opts.text !== undefined ? opts.text : (key.length === 1 ? key : '\r')
        const vk = opts.vk ?? (key === 'Enter' ? 13 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
        const common = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }
        await send('Input.dispatchKeyEvent', { type: 'keyDown', ...common, text: text || undefined })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...common })
        await sleep(opts.wait ?? 320)
      },
      async close() {
        try { ws?.close() } catch {}
        chrome.kill()
        await sleep(1200)
        try { fs.rmSync(userDir, { recursive: true, force: true }) } catch {}
      },
    }
  } catch (e) {
    try { ws?.close() } catch {}
    chrome.kill()
    try { fs.rmSync(userDir, { recursive: true, force: true }) } catch {}
    throw e
  }
}
