#!/usr/bin/env node
/**
 * 跨级别导航的端到端验证（无头浏览器 + CDP）：
 *   ① 搜索结果的 T/G/E 题号各自跳到正确级别
 *   ② 首页「最近练习」对 level 为空的历史记录也能正确跳转
 *   ③ 跳转后直接定位到该题本身（带 #题号 锚点）
 *
 * 背景：判断「某题属于哪个级别」必须按题号首字母推导。早期实现读的是
 * 记录里的 level 字段，而该字段历史上缺值（题库只在文件顶层写级别），
 * 于是 T/G 的题会被算成 extra（搜索）或 technician（首页），点开是空小节。
 * 修复前的答题记录至今躺在用户浏览器和云端，所以这组用例不能删。
 *
 *   node tools/verify_jump.mjs
 */
import { launch, sleep } from './_cdp.mjs'

const BASE = 'http://127.0.0.1:8091'
const b = await launch(BASE, { port: 9411 })

const failures = []
const ok = (cond, name, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`)
  if (!cond) failures.push(name)
}

const WANT = { T: '/l/technician/', G: '/l/general/', E: '/l/extra/' }
const pathOf = () => b.eval(`location.pathname`)
const isEmptySec = () => b.eval(
  `document.body.innerText.includes('没有题目') || document.body.innerText.includes('该小节')`
)

try {
  console.log('\n【一】搜索结果：三个级别各抽一题')
  for (const qid of ['T1A01', 'G7A09', 'E5C10']) {
    await b.goto(`/search?q=${qid}`, 3000)
    const found = await b.waitFor('.res .r .rid', 20000)
    ok(found, `${qid} 搜索结果已渲染`)
    if (!found) continue
    await sleep(500)
    await b.eval(`document.querySelector('.res .r .rid')?.click()`, false)
    await sleep(2500)
    const p = await pathOf()
    const empty = await isEmptySec()
    // 锚点是否真的把当前卡片指到了那一题
    const cur = await b.eval(`document.querySelector('.qc .qid')?.textContent.trim() || ''`)
    ok(p.startsWith(WANT[qid[0]]) && !empty, `${qid} 跳到本级 ${WANT[qid[0]]}`, `${p}｜空页 ${empty}`)
    ok(cur.replace('#', '') === qid, `${qid} 直接定位到该题`, cur)
  }

  console.log('\n【二】首页「最近练习」：level 为空的遗留记录')
  // 修复前写入的答题记录没有 level，模拟两条塞进游客本地数据
  await b.eval(`localStorage.clear()`, false)
  await b.goto('/', 1200)
  await b.eval(`
    localStorage.setItem('hamstudy:v1:guest', JSON.stringify({
      attempts: [
        { id: 'aaaaaaaaaaaaaaa', qid: 'G7A09', level: '', sec: 'G7A', ts: Date.now(), ok: true, mode: 'browse' },
        { id: 'bbbbbbbbbbbbbbb', qid: 'E5C10', level: '', sec: 'E5C', ts: Date.now(), ok: false, mode: 'browse' },
      ],
      favs: [], sessions: [], cleared: [],
    }))
  `, false)
  await b.goto('/', 2600)
  await sleep(1200)
  const recs = await b.eval(
    `[...document.querySelectorAll('.recent .rec')].map((a) => ({
       href: a.getAttribute('href'), qid: (a.querySelector('.rid')?.textContent || '').trim()
     }))`
  )
  console.log('   首页链接:', JSON.stringify(recs))
  ok(recs.length === 2, '两条记录都进了「最近练习」', `${recs.length} 条`)
  for (const r of recs) {
    const qid = r.qid.replace('#', '')
    ok((r.href || '').startsWith(WANT[qid[0]]), `${qid} 链接指向 ${WANT[qid[0]]}`, r.href)
  }
  // 两条记录时间戳可能相同，排序先后不固定：按实际第一条的链接推导期望路径，
  // 不要写死成 G7A，否则会产生与产品逻辑无关的偶发失败。
  const wantPath = (recs[0]?.href || '').split('#')[0]
  await b.eval(`document.querySelector('.recent .rec')?.click()`, false)
  await sleep(2500)
  const p2 = await pathOf()
  ok(!!wantPath && p2 === wantPath && !(await isEmptySec()),
    '点开第一条不再是空小节', `${p2}（期望 ${wantPath}）`)

  await b.eval(`localStorage.clear()`, false)
  const errs = b.errors.filter((e) => !/Development|DevTools/.test(e))
  console.log('控制台错误:', errs.length ? errs.slice(0, 5) : '无')
} finally {
  // 断言抛错时也必须关掉浏览器，否则调试端口会被残留实例占住，后续重跑全失败
  await b.close()
}

console.log(`\n${failures.length ? '✗ 失败 ' + failures.length + ' 项：\n  - ' + failures.join('\n  - ') : '✓ 全部通过'}`)
process.exit(failures.length ? 1 : 0)
