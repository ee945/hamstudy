#!/usr/bin/env node
/**
 * 本批次功能的端到端验证（无头浏览器 + CDP）：
 *   ① 游客进度并入账号   ② 呼号字段   ③ 备份导出/恢复
 *   ④ 清空学习数据（含云端）  ⑤ 模考过程不提示对错
 *
 *   node tools/verify_batch.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, sleep } from './_cdp.mjs'

import { BASE, PB, ADMIN } from './_env.mjs'
const EMAIL = `batch${Date.now()}@ham.test`
const PWD = 'ham12345'
const CALL = 'BA4ABC'

const failures = []
const ok = (cond, name, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`)
  if (!cond) failures.push(name)
}

/* ---------------- 后端小工具 ---------------- */
let adminToken = ''
async function asAdmin() {
  if (!adminToken) {
    adminToken = (await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN),
    }).then((r) => r.json())).token
  }
  return adminToken
}
const api = async (p, opt = {}) => {
  const r = await fetch(`${PB}/api${p}`, {
    ...opt, headers: { 'Content-Type': 'application/json', Authorization: await asAdmin() },
  })
  const raw = await r.text()
  return raw ? JSON.parse(raw) : {}
}

async function createUser() {
  const d = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PWD, passwordConfirm: PWD, nickname: '测试台友' }),
  }).then((r) => r.json())
  if (!d.id) throw new Error('建用户失败: ' + JSON.stringify(d))
  return d.id
}
async function deleteUser(id) {
  const r = await api(`/collections/users/records/${id}`, { method: 'DELETE' })
  // 以前不检查响应，删除失败会被静默吞掉，测试账号就留在了真实库里
  if (r?.code) console.warn('[cleanup] 按 id 删除失败:', JSON.stringify(r).slice(0, 160))
  // 兜底：按邮箱再清一次，绝不把测试账号留在库里
  const q = await api(`/collections/users/records?perPage=10&filter=${encodeURIComponent(`email="${EMAIL}"`)}`)
  for (const u of q.items || []) {
    const rr = await api(`/collections/users/records/${u.id}`, { method: 'DELETE' })
    if (rr?.code) console.warn('[cleanup] 按邮箱兜底删除失败:', u.email, rr.code)
  }
  // 终极兜底：清掉库里所有 @ham.test 测试账号（脚本顺序执行、端口互斥，不会误删）
  const all = await api('/collections/users/records?perPage=500')
  for (const u of all.items || []) {
    if (u.email.endsWith('@ham.test')) {
      await api(`/collections/users/records/${u.id}`, { method: 'DELETE' })
    }
  }
  for (const c of ['hs_attempts', 'hs_favorites', 'hs_sessions']) {
    // 循环删到空为止：一次 perPage=500 可能删不完
    for (let i = 0; i < 20; i++) {
      const list = await api(`/collections/${c}/records?perPage=500&filter=${encodeURIComponent(`user="${id}"`)}`)
      if (!list.items?.length) break
      for (const it of list.items) await api(`/collections/${c}/records/${it.id}`, { method: 'DELETE' })
    }
  }
}
const countRemote = async (uid, c) => {
  const d = await api(`/collections/${c}/records?perPage=1&filter=${encodeURIComponent(`user="${uid}"`)}`)
  return d.totalItems || 0
}
const readUser = async (uid) => api(`/collections/users/records/${uid}`)

const uid = await createUser()
console.log(`测试账号 ${EMAIL}\n`)

/* ---------------- 浏览器 ---------------- */
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-dl-'))
const b = await launch(BASE, { port: 9351 })
await b.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir })

/** 给输入框赋值（b.type 是插入不是替换，改资料前必须先清） */
async function setInput(sel, value) {
  const done = await b.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return false
    el.value = ${JSON.stringify(value)}
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`, false)
  if (!done) throw new Error('选择器未找到: ' + sel)
  await sleep(120)
}
const clickText = (t) => b.eval(`(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(t)})
  if (!btn) return false
  btn.click(); return true
})()`, false).then((r) => sleep(900))

/** 页面内的提示条：App 的浮层回执用 .toast，页面内反馈用 .msg */
const toastText = () =>
  b.eval(`(document.querySelector('.toast')?.textContent || document.querySelector('.msg')?.textContent || '').trim()`)

try {
  /* ═══ ① 游客进度并入账号 ═══════════════════ */
  console.log('【一】未登录先刷几题，再登录看是否并入账号')
  // 浏览模式现在只读不计分，造作答数据必须走刷题模式（或模考）
  await b.goto('/study')
  await b.eval('localStorage.clear()')
  await b.goto('/study', 2600)
  await b.waitFor('.picker', 8000)
  await b.eval(`document.querySelector('.pk-f .btn').click()`, false)
  await sleep(1600)
  await b.waitFor('.qc .opt', 8000)

  // 连答 3 题：点第一个选项 → 「下一题」。
  // 用 DOM click 而非坐标点击：卡片很长，「下一题」常在视口外，
  // 加上 goNext 的平滑滚动，按坐标点会偶发落空，造成「只记了 1~2 条」的假失败。
  for (let k = 0; k < 3; k++) {
    await b.eval(`document.querySelector('.qc .opt:first-child')?.click()`, false)
    await sleep(420)
    await b.eval(`document.querySelector('.act-bar .btn-primary')?.click()`, false)
    await sleep(420)
  }
  const guestBefore = await b.eval(`(() => {
    const raw = localStorage.getItem('hamstudy:v1:guest')
    if (!raw) return { n: 0 }
    const d = JSON.parse(raw)
    return { n: (d.attempts || []).length, qids: (d.attempts || []).map(a => a.qid) }
  })()`)
  console.log('   游客数据:', JSON.stringify(guestBefore))
  ok(guestBefore.n >= 3, `游客身份已记录 ${guestBefore.n} 次作答`, '≥3')

  // 登录
  await b.goto('/login')
  await setInput('input[autocomplete="email"]', EMAIL)
  await setInput('input[type="password"]', PWD)
  // 注意：tab 上也有一个「登录」按钮，必须点表单里的 button.go
  await b.click('button.go')
  await sleep(3000)
  ok(await b.eval(`!!document.querySelector('.avatar-btn')`), '已登录')

  const mergeToast = await toastText()
  console.log('   回执:', mergeToast || '（未出现）')
  ok(/并入/.test(mergeToast), '界面给出「并入账号」回执')

  const afterLogin = await b.eval(`(() => {
    const keys = Object.keys(localStorage)
    const mine = keys.find(k => k.startsWith('hamstudy:v1:') && !k.endsWith(':guest'))
    const d = mine ? JSON.parse(localStorage.getItem(mine)) : { attempts: [] }
    return {
      guestLeft: !!localStorage.getItem('hamstudy:v1:guest'),
      mine: (d.attempts || []).length,
      hasQid: (d.attempts || []).some(a => ${JSON.stringify(guestBefore.qids)}.includes(a.qid)),
    }
  })()`)
  console.log('   登录后:', JSON.stringify(afterLogin))
  ok(!afterLogin.guestLeft, '游客副本已清除（不会重复合并）')
  ok(afterLogin.hasQid, '游客作答已进入账号数据')
  await sleep(3000)
  const remoteN = await countRemote(uid, 'hs_attempts')
  ok(remoteN >= guestBefore.n, `云端已收到 ${remoteN} 条作答`, `游客 ${guestBefore.n} 条`)

  /* ═══ ② 呼号 ═════════════════════════════ */
  console.log('\n【二】呼号字段')
  await b.goto('/account', 1800)
  ok(await b.eval(`!!document.querySelector('input[placeholder="例如 BA4ABC"]')`), '账户页有呼号输入框')
  await setInput('input[placeholder="例如 BA4ABC"]', 'ba4abc')   // 故意小写，测自动大写
  await b.eval(`(() => {
    const sec = [...document.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent.trim() === '呼号')
    ;[...sec.querySelectorAll('button')].find(x => x.textContent.trim() === '保存').click()
  })()`, false)
  await sleep(1500)
  const callMsg = await b.eval(`[...document.querySelectorAll('.msg')].map(m => m.textContent.trim())`)
  console.log('   反馈:', JSON.stringify(callMsg))
  ok(callMsg.includes('呼号已保存'), '呼号保存成功')
  const shown = await b.eval(`document.querySelector('.cur-t .cs')?.textContent.trim() || ''`)
  ok(shown === CALL, '资料区显示大写呼号', shown)
  const inDb = (await readUser(uid)).callsign
  ok(inDb === CALL, '已写入服务端（小写自动转大写）', String(inDb))

  await b.click('.avatar-btn')
  await sleep(400)
  const menuCs = await b.eval(`document.querySelector('.menu .cs')?.textContent.trim() || ''`)
  ok(menuCs === CALL, '头像菜单里显示呼号', menuCs)

  /* ═══ ③ 备份导出 / 恢复 ═══════════════════ */
  console.log('\n【三】备份导出与恢复')
  await b.goto('/progress', 2200)
  await b.eval(`[...document.querySelectorAll('button')].find(x => /导出完整备份/.test(x.textContent)).click()`, false)
  await sleep(1500)
  const expToast = await toastText()
  console.log('   回执:', expToast)
  ok(/已导出 hamstudy-backup-.*\.json/.test(expToast), '导出备份并给出回执')
  const files = fs.readdirSync(dlDir).filter((f) => f.endsWith('.json'))
  ok(files.length === 1, `备份文件已落盘：${files[0] || '（无）'}`)
  let backup = null
  if (files.length) {
    backup = JSON.parse(fs.readFileSync(path.join(dlDir, files[0]), 'utf8'))
    console.log('   备份内容:', JSON.stringify({
      schema: backup.schema,
      attempts: backup.data?.attempts?.length,
      favs: backup.data?.favs?.length,
      owner: backup.owner,
    }))
    ok(backup.schema === 'hamstudy-backup', '备份文件带正确 schema')
    ok((backup.data?.attempts?.length || 0) >= 3, '备份包含答题记录')
    ok(backup.owner?.callsign === CALL, '备份记录了呼号')
  }

  // CSV 导出
  await b.eval(`[...document.querySelectorAll('button')].find(x => /答题流水/.test(x.textContent)).click()`, false)
  await sleep(1200)
  ok(/hamstudy-attempts-.*\.csv/.test(await toastText()), '答题流水 CSV 可导出')
  const csvFiles = fs.readdirSync(dlDir).filter((f) => f.endsWith('.csv'))
  ok(csvFiles.length === 1, `CSV 已落盘：${csvFiles[0] || '（无）'}`)

  // 清空 → 再用备份恢复，验证闭环
  console.log('\n   —— 先清空，再用刚导出的备份恢复 ——')
  await b.eval(`[...document.querySelectorAll('button')].find(x => /清空学习数据/.test(x.textContent)).click()`, false)
  await sleep(600)
  await b.eval(`[...document.querySelectorAll('button')].find(x => /确认清空/.test(x.textContent))?.click()`, false)
  await sleep(2500)
  const afterWipe = await b.eval(`(() => {
    const k = Object.keys(localStorage).find(k => k.startsWith('hamstudy:v1:') && !k.endsWith(':guest'))
    const d = k ? JSON.parse(localStorage.getItem(k)) : { attempts: [] }
    return (d.attempts || []).length
  })()`)
  ok(afterWipe === 0, '清空后本机记录归零', String(afterWipe))
  ok((await countRemote(uid, 'hs_attempts')) === 0, '清空后云端记录也归零')
  const wipeToast = await toastText()
  console.log('   回执:', wipeToast)
  ok(/已清空/.test(wipeToast), '清空给出回执')

  if (backup) {
    await b.send('DOM.enable')
    const { root } = await b.send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await b.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
    ok(!!nodeId, '找到隐藏的文件选择框')
    if (nodeId) {
      await b.send('DOM.setFileInputFiles', { files: [path.join(dlDir, files[0])], nodeId })
      await sleep(2500)
      const impToast = await toastText()
      console.log('   回执:', impToast)
      ok(/已从备份恢复/.test(impToast), '从备份恢复成功')
      const restored = await b.eval(`(() => {
        const k = Object.keys(localStorage).find(k => k.startsWith('hamstudy:v1:') && !k.endsWith(':guest'))
        const d = k ? JSON.parse(localStorage.getItem(k)) : { attempts: [] }
        return (d.attempts || []).length
      })()`)
      ok(restored >= 3, `恢复后记录回到 ${restored} 条`)
    }
  }

  /* ═══ ④ 模考过程不提示对错 ═══════════════ */
  console.log('\n【四】模拟考试：过程中不得泄露对错')
  await b.goto('/exam', 2600)
  await b.eval(`document.querySelector('button.go')?.click()`, false)
  await sleep(3200)
  const inExam = await b.eval(`!!document.querySelector('.grid .th')`)
  ok(inExam, '已进入考试页')

  // 用数字键作答第 1 题（同时验证快捷键仍在）
  await b.press('1')
  await sleep(900)
  // 答完会自动跳到下一题，回到第 1 题再看它长什么样
  await b.click('.grid .th:first-child')
  await sleep(600)
  const leak = await b.eval(`(() => {
    const txt = document.body.innerText || ''
    return {
      right: document.querySelectorAll('.opt.right').length,
      wrong: document.querySelectorAll('.opt.wrong').length,
      hint: document.querySelectorAll('.opt.hint').length,
      seled: document.querySelectorAll('.opt.seled').length,
      thOk: document.querySelectorAll('.th.ok').length,
      thNo: document.querySelectorAll('.th.no').length,
      thDone: document.querySelectorAll('.th.done').length,
      saysRight: /回答正确|回答错误|正确答案/.test(txt),
      note: document.querySelector('.picked-note')?.textContent.trim() || '',
    }
  })()`)
  console.log('   ', JSON.stringify(leak))
  ok(leak.right + leak.wrong + leak.hint === 0, '选项没有被染成「正确/错误」色')
  ok(!leak.saysRight, '页面没有出现判分文案')
  ok(leak.seled === 1, '只中性地标出了「已选」')
  ok(leak.thOk + leak.thNo === 0, '答题卡没有红/绿格子')
  ok(leak.thDone >= 1, '答题卡标出「已答」')
  ok(/已选择/.test(leak.note), '给出「已选择，交卷后统一判分」提示', leak.note)

  // 改一次答案：应当只换选中项，仍然不判分
  await b.press('3')
  await sleep(600)
  const changed = await b.eval(`(() => ({
    seled: document.querySelectorAll('.opt.seled').length,
    note: document.querySelector('.picked-note')?.textContent.trim() || '',
    right: document.querySelectorAll('.opt.right, .opt.wrong, .opt.hint').length,
  }))()`)
  console.log('   改答案后:', JSON.stringify(changed))
  ok(changed.right === 0 && changed.seled === 1, '改答案时同样不泄露对错')
  ok(/已选择 C/.test(changed.note), '已选提示跟着更新', changed.note)

  // 再答 2 题
  await b.press('2')
  await sleep(700)
  await b.press('3')
  await sleep(700)
  const beforeSubmit = await countRemote(uid, 'hs_attempts')
  await b.eval(`[...document.querySelectorAll('button')].find(x => /交卷判分/.test(x.textContent)).click()`, false)
  await sleep(400)
  // 未全答时先弹「还有 N 题未作答」确认框，点「继续提交」才真正交卷
  await b.eval(`[...document.querySelectorAll('button')].find(x => /继续提交/.test(x.textContent))?.click()`, false)
  await sleep(2600)
  const resultPage = await b.eval(`(() => ({
    res: !!document.querySelector('.res'),
    chips: document.querySelectorAll('.chip.ok, .chip.no').length,
    txt: (document.querySelector('.res')?.innerText || '').replace(/\\n+/g, ' | '),
  }))()`)
  console.log('   ', JSON.stringify(resultPage))
  ok(resultPage.res, '交卷后出结果页')
  ok(resultPage.chips > 0, '考后逐题回顾才标对错')
  const afterSubmit = await countRemote(uid, 'hs_attempts')
  ok(afterSubmit > beforeSubmit, `交卷时才写入学习流水（${beforeSubmit} → ${afterSubmit}）`)

  console.log('\n──────── 控制台错误 ────────')
  console.log(b.errors.length ? b.errors.join('\n') : '（无）')
  if (b.errors.length) failures.push(`页面有 ${b.errors.length} 条意外运行时错误`)
} finally {
  await b.close()
  fs.rmSync(dlDir, { recursive: true, force: true })
  await deleteUser(uid)
  console.log('\n测试账号与临时文件已清理')
}

console.log('\n──────── 结论 ────────')
if (failures.length) {
  console.log('✗ 失败项：\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ 本批次五项功能全部通过')
