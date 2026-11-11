#!/usr/bin/env node
/**
 * 端到端回归：四种练习模式的进度统一 + 错题本/收藏夹的循环练习交互。
 *
 * 验证：
 *   · 错题本作答后正确项标绿 / 错误项标红、留在原题、不能重复作答；
 *   · 错题本与收藏夹 ← / → 循环翻页，整轮答完回到第一题重新刷；
 *   · 刷题 / 模考 / 错题本 / 收藏夹的作答都落在 hs_attempts，且带正确 mode；
 *   · 刷题页显示的完成度与「全部模式流水」重放结果完全一致。
 *
 * 无头浏览器使用独立 profile，不会写脏用户数据。
 * 用法: node tools/verify_practice_ui.mjs [baseURL]
 */
import { launch, sleep } from './_cdp.mjs'
import { replayDrill, summarize } from '../src/lib/drill.js'

const BASE = process.argv[2] || 'http://127.0.0.1:8091'
const KEY = 'hamstudy:v1:guest'
const DKEY = 'hamstudy:drill:v1:guest'
const IDS = ['T1A01', 'T1A02', 'T1A03']
const b = await launch(BASE, { port: 9471, quiet: true })
const results = []
const ok = (name, cond, detail = '') => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? `  (${detail})` : ''))
}

const raw = await (await fetch(BASE + '/data/q_technician.json')).json()
const ANS = Object.fromEntries(raw.qs.map((q) => [q.id, q.ans]))
const T1A_IDS = raw.qs.filter((q) => q.id.startsWith('T1A')).map((q) => q.id)

const J = JSON.stringify
const attempts = () => b.eval(`(() => {
  try { return JSON.parse(localStorage.getItem(${J(KEY)}) || '{}').attempts || [] }
  catch { return [] }
})()`)
const optStates = () => b.eval(`[...document.querySelectorAll('.qc .opt')].map(o =>
  o.classList.contains('right') ? 'right' :
  o.classList.contains('wrong') ? 'wrong' :
  o.classList.contains('dim')   ? 'dim'   : '-')`)
const pos = () => b.eval(`document.querySelector('.bar .pos')?.textContent.trim() || ''`)
const qid = () => b.eval(`document.querySelector('.qc .qid')?.textContent.trim().replace('#','') || ''`)
const roundText = () => b.eval(`document.querySelector('.bar .rnd')?.textContent.trim() || ''`)

/** 长页面按钮先滚到视口中间，再用真实鼠标点击 */
const clickSel = async (sel, wait = 420) => {
  await b.eval(`(() => { const e = document.querySelector(${J(sel)}); if (e) e.scrollIntoView({ block: 'center' }); return !!e })()`)
  await b.click(sel, wait)
}
const RIGHT = () => b.press('ArrowRight', { code: 'ArrowRight', vk: 39, text: '' })
const LEFT = () => b.press('ArrowLeft', { code: 'ArrowLeft', vk: 37, text: '' })

/** 对当前题作答；correct=false 时故意选一个错误项 */
async function answer(correct = true) {
  const cur = await qid()
  const want = correct ? ANS[cur] : (ANS[cur] === 'A' ? 'B' : 'A')
  await clickSel(`.qc .opt:nth-child(${'ABCD'.indexOf(want) + 1})`, 520)
  return cur
}

async function seed() {
  const now = Date.now()
  const data = {
    attempts: IDS.map((q, k) => ({
      id: `seed0000000000${k}`, qid: q, level: '技术级', sec: 'T1A',
      ok: false, mode: 'drill', ts: now - k * 1000,
    })),
    favs: IDS.map((q, k) => ({
      id: `fav00000000000${k}`, qid: q, level: '技术级', sec: 'T1A', ts: now - k * 1000,
    })),
    sessions: [], cleared: [],
  }
  await b.goto('/', 1500)
  await b.eval('localStorage.clear()', false)
  await b.eval(`localStorage.setItem(${J(KEY)}, ${J(J(data))})`, false)
  await b.eval(`localStorage.setItem(${J(DKEY)}, ${J(J({
    lastScope: { level: 'technician', set: 'T1A' }, resets: {}, autoNext: false,
  }))})`, false)
}

let lastMode = ''
try {
  await seed()

  /* ───────── 一、错题本：颜色 / 停留 / 防连答 ───────── */
  console.log('──── 错题本 ────')
  await b.goto('/wrong', 2500)
  await b.waitFor('.qc', 9000)
  ok('错题本载入 3 道待清错题', (await pos()) === '1 / 3', await pos())
  ok('未作答时不显示对错颜色', (await optStates()).every((s) => s === '-'))
  const first = await qid()
  await answer(false)
  const st1 = await optStates()
  ok('答错后正确项标绿、所选项标红', st1.includes('right') && st1.includes('wrong'), st1.join('/'))
  ok('结果区明确判定「回答错误」', await b.eval(`!!document.querySelector('.qc .verdict.no')`))
  ok('作答后留在原题供检查，不跳走', (await qid()) === first && (await pos()) === '1 / 3',
    `${await qid()} ${await pos()}`)
  let arr = await attempts()
  ok('新增一条 mode=wrong 的作答', arr.length === 4 && arr.at(-1).mode === 'wrong',
    `${arr.length} 条 / ${arr.at(-1)?.mode}`)
  ok('提示条给出掌握进度变化', (await b.eval(`document.querySelector('.flash')?.textContent || ''`)).includes('答错'))

  // 旧 bug 的两个表现：颜色消失 + 提示完还能继续连续作答
  await clickSel('.qc .opt:nth-child(2)', 300)
  await b.press('4')
  const st2 = await optStates()
  ok('再点选项 / 按数字键都不会二次作答',
    (await attempts()).length === 4 && J(st1) === J(st2), J(st2))
  await sleep(1200)   // 等 flash 消失，确认颜色没有被异步重载清掉
  ok('提示消失后对错颜色仍保留', J(await optStates()) === J(st1))

  /* ───────── 二、错题本：循环翻页 / 整轮重刷 ───────── */
  console.log('──── 错题本循环翻页 ────')
  await RIGHT()
  ok('→ 切到下一题', (await pos()) === '2 / 3', await pos())
  await answer(true)
  ok('第二题答对后标绿', (await optStates()).includes('right'))
  await RIGHT()
  ok('→ 切到末题', (await pos()) === '3 / 3', await pos())
  await answer(true)
  await LEFT()
  ok('← 回到上一题', (await pos()) === '2 / 3', await pos())
  await LEFT()
  await LEFT()
  ok('首题再往左循环到末题', (await pos()) === '3 / 3', await pos())
  await RIGHT()
  await sleep(900)    // 新一轮会按错题本重建列表
  ok('整轮答完再往右：回到第一题', (await pos()) === '1 / 3', await pos())
  ok('新一轮编号递增', (await roundText()).includes('第 2 轮'), await roundText())
  ok('新一轮清空作答，颜色复位', (await optStates()).every((s) => s === '-'))
  ok('新一轮不再产生重复作答', (await attempts()).length === 6)

  /* ───────── 三、收藏夹：同一套交互 ───────── */
  console.log('──── 收藏夹 ────')
  await b.goto('/fav', 2500)
  await b.waitFor('.qc', 9000)
  ok('收藏夹载入 3 道收藏题', (await pos()) === '1 / 3', await pos())
  const fFirst = await qid()
  await answer(true)
  ok('收藏夹答完显示对错颜色', (await optStates()).includes('right'))
  ok('收藏夹答完留在原题', (await qid()) === fFirst && (await pos()) === '1 / 3')
  arr = await attempts()
  ok('新增一条 mode=fav 的作答', arr.at(-1).mode === 'fav', arr.at(-1)?.mode)
  await LEFT()
  ok('收藏夹首题往左循环到末题', (await pos()) === '3 / 3', await pos())
  await RIGHT()
  ok('末题往右回第一题（未满一轮不清空）', (await pos()) === '1 / 3', await pos())
  // 线性走完剩下两题，再往右才应触发「整轮完成 → 回到第一题重刷」
  await RIGHT()
  ok('→ 第 2 题', (await pos()) === '2 / 3', await pos())
  await answer(true)
  await RIGHT()
  await answer(false)
  await RIGHT()
  await sleep(700)
  ok('收藏夹整轮答完回到第一题重刷',
    (await pos()) === '1 / 3' && (await roundText()).includes('第 2 轮'),
    `${await pos()} / ${await roundText()}`)
  ok('收藏夹新一轮颜色复位', (await optStates()).every((s) => s === '-'))

  /* ───────── 四、模考：作答 / 未作答分别打标 ───────── */
  console.log('──── 模考 ────')
  await b.goto('/exam/technician', 2600)
  await b.waitFor('.qc', 9000)
  await answer(true)
  await clickSel('.b-r .btn-primary', 600)
  await b.waitFor('.dlg', 4000)
  ok('有未作答题时弹确认框', await b.eval(`!!document.querySelector('.dlg')`))
  await clickSel('.dlg-acts .btn-primary', 900)
  await b.waitFor('.res', 6000)
  arr = await attempts()
  const modes = [...new Set(arr.map((a) => a.mode))]
  ok('交卷写入 mode=exam 的作答', modes.includes('exam'), modes.join(','))
  ok('未作答写为 exam-blank（不计完成度）', modes.includes('exam-blank'))
  ok('模考未作答仍按错题进错题本', await b.eval(`!!document.querySelector('.res')`))

  /* ───────── 五、四种模式汇总成同一个完成度 ───────── */
  console.log('──── 完成度统一 ────')
  arr = await attempts()
  const { score, seen } = replayDrill(arr, T1A_IDS, {})
  const expect = summarize(T1A_IDS, score, seen)
  ok('四种模式记录都存在于同一份流水',
    ['drill', 'wrong', 'fav', 'exam', 'exam-blank'].every((m) => modes.includes(m)),
    modes.join(','))
  await b.goto('/study', 2800)
  await b.waitFor('.metric', 9000)
  const shown = await b.eval(`(() => {
    const m = [...document.querySelectorAll('.metric')]
    return m.map(e => parseInt(e.querySelector('b')?.textContent, 10))
  })()`)
  ok('刷题页完成度 = 全模式流水重放', shown[0] === expect.aptitude,
    `页面 ${shown[0]}% / 重放 ${expect.aptitude}%`)
  ok('已做占比 = 全模式去重作答数', shown[1] === expect.seenPct,
    `页面 ${shown[1]}% / 重放 ${expect.seenPct}%`)
  ok('浏览器把 T1A 作为上次范围续上',
    await b.eval(`document.body.innerText.includes('T1A')`))

  console.log('\n──── 控制台 ────')
  ok('全程无控制台报错', b.errors.length === 0, b.errors.slice(0, 3).join(' | '))
} finally {
  await b.close()
}

const passed = results.filter(Boolean).length
console.log(`\n结果: ${passed}/${results.length} 通过`)
if (passed !== results.length) process.exit(1)
