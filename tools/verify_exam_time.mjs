#!/usr/bin/env node
/**
 * 回归：模拟考试时长按级别配置 —— 技术级 / 通用级 60 分钟，业余特级 75 分钟。
 *
 * 历史：ExamView 原先用 `remain = need * 75`（题数 × 每题 75 秒），
 * 实际 T/G 只有 43.75 分钟、E 62.5 分钟。现改为读 meta.json 的 exam.minutes。
 *
 * 只打开页面、读倒计时与文案，不交卷，因此不写任何业务数据。
 */
import { launch } from './_cdp.mjs'

const BASE = 'http://127.0.0.1:8091'
const CASES = [
  { slug: 'technician', minutes: 60, questions: 35 },
  { slug: 'general', minutes: 60, questions: 35 },
  { slug: 'extra', minutes: 75, questions: 50 },
]

const b = await launch(BASE, { port: 9451, quiet: true })
let pass = 0
let total = 0
const ok = (name, cond, extra = '') => {
  total++
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''))
  if (cond) pass++
}

try {
  // 1) 设置页列出三个级别的时长
  await b.goto('/exam', 2600)
  await b.waitFor('.lv .row')
  const setup = await b.eval(`(() => {
    return [...document.querySelectorAll('.lv')].map((c) => {
      const row = [...c.querySelectorAll('.row')].find(
        (r) => r.querySelector('span')?.textContent.trim() === '考试时长'
      )
      return {
        name: c.querySelector('h3')?.textContent.trim(),
        time: row?.querySelector('b')?.textContent.trim() || '',
      }
    })
  })()`)
  console.log('设置页时长:', JSON.stringify(setup))
  ok('设置页列出 3 个级别', setup.length === 3)
  ok(
    '设置页时长为 60 / 60 / 75 分钟',
    setup.map((x) => x.time).join('|') === '60 分钟|60 分钟|75 分钟',
    setup.map((x) => x.time).join(' / ')
  )

  // 2) 逐个级别检查倒计时初值、顶栏限时文案、答题卡题数
  for (const c of CASES) {
    await b.goto(`/exam/${c.slug}`, 2600)
    const ready = await b.waitFor('.bar .mono', 12000)
    if (!ready) {
      ok(`${c.slug} 考试页渲染`, false, '（未出现倒计时）')
      continue
    }
    const info = await b.eval(`(() => {
      const t = document.querySelector('.bar .mono')?.textContent.trim() || ''
      const bar = document.querySelector('.bar .b-m')?.innerText || ''
      return { t, bar, sheet: document.querySelectorAll('.grid .th').length }
    })()`)
    const [mm, ss] = info.t.split(':').map(Number)
    const sec = mm * 60 + (ss || 0)
    const want = c.minutes * 60
    console.log(
      `  ${c.slug}: 倒计时 ${info.t} (${sec}s / 目标 ${want}s) · 答题卡 ${info.sheet} 题 · ` +
        info.bar.replace(/\n+/g, ' | ')
    )
    // 倒计时每秒递减，页面就绪与读数之间最多走几秒，留 30s 容差
    ok(`${c.slug} 倒计时 ≈ ${c.minutes} 分钟`, sec > want - 30 && sec <= want, `(${info.t})`)
    ok(`${c.slug} 顶栏显示「限时 ${c.minutes} 分钟」`, info.bar.includes(`限时 ${c.minutes} 分钟`))
    ok(`${c.slug} 答题卡 ${c.questions} 题`, info.sheet === c.questions, `(${info.sheet})`)
  }

  ok('全程无控制台报错', b.errors.length === 0)
  if (b.errors.length) console.log('  errors:', b.errors.slice(0, 3))
  console.log(`\n结果: ${pass}/${total} 通过`)
  process.exitCode = pass === total ? 0 : 1
} finally {
  await b.close()
}
