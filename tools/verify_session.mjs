#!/usr/bin/env node
/**
 * 登录态失效的端到端验证：
 *   ① 正常保存仍然成功（回归）
 *   ② 账号在后端被删除后点保存 → 自动登出 + 中文提示，不再是英文 404
 *   ③ 账号被删除后刷新页面 → 自动登出（启动时自检）
 *   ④ token 过期 → 不发无效请求，直接按未登录处理
 *   ⑤ 改密码时登录态失效 → 同样自动处理
 *
 *   node tools/verify_session.mjs
 */
import { launch, sleep } from './_cdp.mjs'

import { BASE, PB, ADMIN } from './_env.mjs'
const PWD = 'ham12345'

const failures = []
const ok = (cond, name, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`)
  if (!cond) failures.push(name)
}

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
async function makeUser(tag) {
  const email = `sess${tag}@ham.test`
  const d = await api('/collections/users/records', {
    method: 'POST',
    body: JSON.stringify({ email, password: PWD, passwordConfirm: PWD, nickname: '台友' }),
  })
  if (!d.id) throw new Error('建账号失败: ' + JSON.stringify(d))
  return { id: d.id, email }
}
async function delUser(id) {
  await api(`/collections/users/records/${id}`, { method: 'DELETE' })
  for (const c of ['hs_attempts', 'hs_favorites', 'hs_sessions']) {
    for (let i = 0; i < 10; i++) {
      const l = await api(`/collections/${c}/records?perPage=500&filter=${encodeURIComponent(`user="${id}"`)}`)
      if (!l.items?.length) break
      for (const it of l.items) await api(`/collections/${c}/records/${it.id}`, { method: 'DELETE' })
    }
  }
}

const b = await launch(BASE, { port: 9371 })

async function setInput(sel, value) {
  const box = await b.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return null
    // 页面比视口长时下边的输入框在视口外，不滚过来的话鼠标点不到它
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  if (!box) throw new Error('未找到 ' + sel)
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await sleep(120)
  await b.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`, false)
  for (const ch of value) { await b.send('Input.insertText', { text: ch }); await sleep(20) }
  await sleep(120)
}
async function clickText(text) {
  return b.eval(`(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)})
    if (!btn) return false
    btn.click(); return true
  })()`, false)
}
/** 点「某个输入框所在那一行」的保存按钮 —— 昵称区与呼号区各有一个「保存」 */
async function clickSaveNear(inputSel) {
  return b.eval(`(() => {
    const input = document.querySelector(${JSON.stringify(inputSel)})
    if (!input) return false
    const btn = [...input.closest('.row').querySelectorAll('button')]
      .find((x) => x.textContent.trim() === '保存')
    if (!btn) return false
    btn.click(); return true
  })()`, false)
}
async function login(email) {
  await b.goto('/login', 1600)
  await setInput('input[autocomplete="email"]', email)
  await setInput('input[type="password"]', PWD)
  await b.click('button.go', 300)
  await sleep(2200)
}
const msgs = () => b.eval(`[...document.querySelectorAll('.msg')].map(x=>x.textContent.trim()).join(' | ')`)
const toast = () => b.eval(`document.querySelector('.toast')?.textContent.trim() || ''`)
const logged = () => b.eval(`!!document.querySelector('.avatar-btn')`)

/* ================= ① 正常保存（回归） ================= */
console.log('\n【一】正常账号保存资料')
const u1 = await makeUser('a' + Date.now())
await login(u1.email)
ok(await logged(), '登录成功')
await b.goto('/account', 1800)
await setInput('input[placeholder="例如 老王"]', '老王A')
await clickSaveNear('input[placeholder="例如 老王"]')
await sleep(1500)
ok(/已保存/.test(await msgs()), '昵称保存成功', await msgs())
await setInput('input[placeholder="例如 BA4ABC"]', 'BA4ABC')
await clickSaveNear('input[placeholder="例如 BA4ABC"]')
await sleep(1500)
ok(/呼号已保存/.test(await msgs()), '呼号保存成功', await msgs())
const rec1 = await api(`/collections/users/records/${u1.id}`)
ok(rec1.nickname === '老王A' && rec1.callsign === 'BA4ABC', '后端确实落库', `${rec1.nickname}/${rec1.callsign}`)

/* ================= ② 账号被删后点保存 ================= */
console.log('\n【二】账号在后端被删除后点保存')
await delUser(u1.id)
await setInput('input[placeholder="例如 老王"]', '老王B')
await clickSaveNear('input[placeholder="例如 老王"]')
await sleep(1800)
const m2 = await msgs()
ok(!/wasn't found|404|not found/i.test(m2), '不再把英文 404 抛给用户', m2 || '（无回执，页面已切换）')
ok(!(await logged()), '自动切到未登录态，不再卡在半登录')
const emptyTxt = await b.eval(`document.querySelector('.empty')?.textContent.replace(/\\s+/g,' ').trim() || ''`)
ok(/登录状态已失效/.test(emptyTxt), '账户页给出「登录状态已失效」说明', emptyTxt.slice(0, 40))
const t2 = await toast()
ok(/失效|重新登录/.test(t2), '右下角给出回执', t2)
ok(await b.eval(`!!document.querySelector('.empty .btn-primary')`), '提供「去登录」入口')

/* ================= ③ 刷新页面自动恢复 ================= */
console.log('\n【三】账号已不存在，刷新页面')
const u3 = await makeUser('c' + Date.now())
await login(u3.email)
ok(await logged(), '登录成功')
await delUser(u3.id)
// 模拟用户一直开着页面、后端账号却没了：刷新时应该自己发现并说清楚
await b.send('Page.reload', {})
await sleep(2800)
ok(!(await logged()), '刷新后自动识别为未登录')
ok(/失效|过期/.test(await toast()), '刷新后给出提示', await toast())

/* ================= ④ token 过期 ================= */
console.log('\n【四】token 过期')
const u4 = await makeUser('d' + Date.now())
await login(u4.email)
ok(await logged(), '登录成功')
// 把 token 换成一份已过期的（同一账号、同样签名结构，只是 exp 在过去）
await b.eval(`(() => {
  const raw = localStorage.getItem('pocketbase_auth')
  const s = JSON.parse(raw)
  const seg = s.token.split('.')
  const pad = seg[1].replace(/-/g, '+').replace(/_/g, '/')
  const p = JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)))
  p.exp = Math.floor(Date.now() / 1000) - 3600
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
  s.token = seg[0] + '.' + b64(p) + '.' + seg[2]
  localStorage.setItem('pocketbase_auth', JSON.stringify(s))
})()`, false)
await b.goto('/account', 1000)
await b.send('Page.reload', {})
await sleep(2400)
ok(!(await logged()), '过期 token 不再当成已登录')
const emptyTxt4 = await b.eval(`document.querySelector('.empty')?.textContent.replace(/\\s+/g,' ').trim() || ''`)
ok(/登录后才能修改|登录状态已失效/.test(emptyTxt4), '账户页回到未登录视图', emptyTxt4.slice(0, 40))
ok(/过期/.test(await toast()), '过期时给出说明', await toast())

/* ================= ⑤ 改密码时登录态失效 ================= */
console.log('\n【五】改密码时账号已不存在')
const u5 = await makeUser('e' + Date.now())
await login(u5.email)
ok(await logged(), '登录成功')
await b.goto('/account', 1800)
await setInput('input[autocomplete="current-password"]', PWD)
await setInput('input[placeholder^="至少"]', 'newpass123')
await setInput('input[placeholder="再输入一次"]', 'newpass123')
await delUser(u5.id)          // 填完表之后账号才没的，模拟真实的中途失效
const pwdFilled = await b.eval(`(() => {
  const v = (s) => document.querySelector(s)?.value || ''
  return {
    old: v('input[autocomplete="current-password"]'),
    n1: v('input[placeholder^="至少"]'),
    n2: v('input[placeholder="再输入一次"]'),
    warn: document.querySelector('.warn')?.textContent.trim() || '',
  }
})()`)
console.log('   表单状态:', JSON.stringify(pwdFilled, null, 0))
await clickText('修改密码')
await sleep(1800)
const m5 = await msgs()
ok(!/wasn't found|404/i.test(m5), '改密码也不再抛英文 404', m5 || '（无回执，页面已切换）')
ok(!(await logged()), '改密码失败后自动登出')

console.log('\n控制台错误:', b.errors.length ? b.errors.slice(0, 6) : '无')
await b.close()

for (const u of [u1, u3, u4, u5]) await delUser(u.id)
console.log('测试账号已清理')

console.log(`\n${failures.length ? '✗ 失败 ' + failures.length + ' 项: ' + failures.join('；') : '✓ 全部通过'}`)
process.exit(failures.length ? 1 : 0)
