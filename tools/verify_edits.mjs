#!/usr/bin/env node
/**
 * 题库修订（/edits）的端到端验证：
 *   ① 非管理员：用户菜单没有入口，直接输入 /edits 会被挡回首页
 *   ② 管理员：修订 → 保存成功
 *   ③ 差分存储：只存真正改过的字段
 *   ④ 立即生效：刷题页看到新译文，作答后看到新要点
 *   ⑤ 字段级还原 + 整题还原
 *   ⑥ 权限：未登录 / 普通注册用户都写不进题库；无法自提权；伪造 author 无效
 *   ⑦ 前台：非管理员在刷题页看不到修订入口，带 ?q= 的直达链接也被挡回
 *
 *   保存流程用的是 role = admin 的账号（脚本里先授权再登录）。
 *   编辑员提交 / 审核 / 日志的完整流程见 tools/verify_workflow.mjs。
 *
 *   node tools/verify_edits.mjs
 */
import { launch, sleep } from './_cdp.mjs'

import { BASE, PB, ADMIN } from './_env.mjs'
const PWD = 'ham12345'
const QID = 'T1A01'
const NEW_ZH = 'ZZ测试译文ZZ'
const NEW_MNEM = 'MM测试要点MM'

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
async function delUser(id) {
  await api(`/collections/users/records/${id}`, { method: 'DELETE' })
  for (const c of ['hs_attempts', 'hs_favorites', 'hs_sessions', 'hs_edits']) {
    for (let i = 0; i < 10; i++) {
      const l = await api(`/collections/${c}/records?perPage=500&filter=${encodeURIComponent(`user="${id}"`)}`)
      if (!l.items?.length) break
      for (const it of l.items) await api(`/collections/${c}/records/${it.id}`, { method: 'DELETE' })
    }
  }
  // 新增的审批表用的是 author / userId，不是 user，单独清一遍，
  // 免得测试账号的名字残留在站长的贡献榜里。
  for (const [c, f] of [['hs_pending', 'author'], ['hs_edit_logs', 'userId']]) {
    const l = await api(`/collections/${c}/records?perPage=500&filter=${encodeURIComponent(`${f}="${id}"`)}`)
    for (const it of l.items || []) await api(`/collections/${c}/records/${it.id}`, { method: 'DELETE' })
  }
}
/** 清掉某题的所有修订，保证从题库原文这个干净状态开始 */
async function clearEdit(qid) {
  for (const c of ['hs_edits']) {
    const l = await api(`/collections/${c}/records?perPage=10&filter=${encodeURIComponent(`qid="${qid}"`)}`)
    for (const it of l.items || []) await api(`/collections/${c}/records/${it.id}`, { method: 'DELETE' })
  }
}
const getEdit = async (qid) => {
  const l = await api(`/collections/hs_edits/records?perPage=10&filter=${encodeURIComponent(`qid="${qid}"`)}`)
  return l.items?.[0] || null
}

const b = await launch(BASE, { port: 9391 })

async function setEl(expr, value) {
  const box = await b.eval(`(() => {
    const el = ${expr}
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  if (!box) throw new Error('未找到元素: ' + expr)
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await sleep(120)
  await b.eval(`(() => { const el = ${expr}; el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })) })()`, false)
  for (const ch of value) { await b.send('Input.insertText', { text: ch }); await sleep(15) }
  await sleep(150)
}
async function clickText(text) {
  return b.eval(`(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)})
    if (!btn) return false
    btn.scrollIntoView({ block: 'center' })
    btn.click(); return true
  })()`, false)
}
async function login(email) {
  await b.goto('/login', 1600)
  await setEl('document.querySelector(\'input[autocomplete="email"]\')', email)
  await setEl('document.querySelector(\'input[type="password"]\')', PWD)
  await b.click('button.go', 300)
  await sleep(2400)
}
const txt = (sel) => b.eval(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim() || ''`)

console.log('\n【一】非管理员：没有入口，地址也进不去')
await clearEdit(QID)

/** 当前路由路径——重定向后它就是我们判断「有没有被放进去」的依据 */
const path = () => b.eval(`location.pathname`)
/** 展开头像菜单后，把菜单项文字拼成串 */
async function menuText() {
  await b.eval(`document.querySelector('.avatar-btn').click()`, false)
  await sleep(500)
  const t = await b.eval(`[...document.querySelectorAll('.menu-a')].map((a) => a.textContent.trim()).join(' | ')`)
  await b.eval(`document.querySelector('.avatar-btn').click()`, false)
  await sleep(300)
  return t
}

// 游客
await b.eval(`localStorage.clear()`, false)
await b.goto('/edits', 1600)
await sleep(1300)
ok((await path()) === '/', '游客输入 /edits 跳回首页', await path())
ok(!(await b.eval(`!!document.querySelector('.avatar-btn')`)), '确认当前是游客')

// 注册了但不是管理员：光有账号不行
const guest = await plainUser('gs')
await login(guest.rec.email)
ok(await b.eval(`!!document.querySelector('.avatar-btn')`), '普通用户登录成功')
await b.goto('/edits', 1600)
await sleep(1300)
ok((await path()) === '/', '普通用户访问 /edits 跳回首页', await path())
const gm = await menuText()
ok(!/题库维护/.test(gm), '用户菜单里没有「题库维护」', gm)
ok(/账户设置/.test(gm), '菜单其余项照常显示', gm)
// 先让浏览器把登录态丢干净再删账号：否则页面还拿着 token 继续请求，
// 服务端一律 401，控制台会留下与本功能无关的报错。
await b.eval(`localStorage.clear()`, false)
await sleep(400)
await delUser(guest.rec.id)

console.log('\n【二】管理员修订')
const email = `ed${Date.now()}@ham.test`
const u = await api('/collections/users/records', {
  method: 'POST',
  body: JSON.stringify({ email, password: PWD, passwordConfirm: PWD, nickname: '台友' }),
})
// 题库改写只认 role = admin，先授权再走保存流程（授权用超级管理员 token 写）
await api(`/collections/users/records/${u.id}`, {
  method: 'PATCH', body: JSON.stringify({ role: 'admin' }),
})
await login(email)
ok(await b.eval(`!!document.querySelector('.avatar-btn')`), '登录成功')
const am = await menuText()
ok(/题库维护/.test(am), '用户菜单里出现「题库维护」', am)

await b.goto('/edits', 1600)
await sleep(1300)
ok((await path()) === '/edits', '管理员能进维护页', await path())
await b.waitFor('.stats', 20000)
await sleep(800)
const total = Number(await b.eval(`document.querySelector('.s b')?.textContent.trim() || '0'`))
ok(total > 1400, '统计出题库总数', `${total} 题`)
ok(!(await b.eval(`!!document.querySelector('.warn')`)), '没有无权提示')

await setEl('document.querySelector(\'.kw\')', QID)
await sleep(900)
const rows = await b.eval(`document.querySelectorAll('.list .item').length`)
ok(rows === 1, '按题号精确定位', `${rows} 条`)

await b.eval(`document.querySelector('.list .item .head').click()`, false)
await sleep(700)
ok(await b.eval(`!!document.querySelector('.ed')`), '编辑器展开')
const areas = await b.eval(`document.querySelectorAll('.ed textarea').length`)
// 英文/中文题干 + 4 英文选项 + 4 中文选项 + 要点 + 解析
ok(areas === 12, '十二个文本域（题干、选项、要点、解析）', `${areas} 个`)

/** 按标签文字定位编辑框，别用序号 —— 选项改多行后会多出 8 个 textarea */
async function setField(label, value) {
  await setEl(`(() => {
    const f = [...document.querySelectorAll('.ed .fld')]
      .find((x) => (x.querySelector('.lb')?.textContent || '').includes(${JSON.stringify(label)}))
    return f ? f.querySelector('textarea, input') : null
  })()`, value)
}

await setField('中文题干', NEW_ZH)
await setField('记忆要点', NEW_MNEM)
await sleep(400)
const chg = await txt('.ed .chg')
ok(/改动 2 处/.test(chg), '实时显示改动处数', chg)

await clickText('保存修订')
await sleep(2000)
const m1 = await txt('.ed .msg')
ok(/已保存/.test(m1), '保存成功', m1)

console.log('\n【三】只存真正改过的字段')
let rec = await getEdit(QID)
ok(!!rec, '云端已有修订记录')
ok(rec.qzh === NEW_ZH, '中文题干已存', rec?.qzh)
ok(rec.mnem === NEW_MNEM, '记忆要点已存', rec?.mnem)
ok(!rec.qen && !rec.expl, '没改的字段不留值', `qen=${JSON.stringify(rec?.qen)}`)
ok(!(rec.optzh || []).length && !(rec.opten || []).length, '选项未存')
ok(Number(rec.diff) === 0, '难度沿用原文（存 0）', String(rec?.diff))
ok(rec.author === u.id, '修订人记为本人')

console.log('\n【四】刷题页立即生效')
await b.eval(`localStorage.setItem('hamstudy:ui', JSON.stringify({ showZh: true, showExpl: true, revealAnswer: true }))`, false)
await b.goto(`/l/technician/T1A`, 2600)
await sleep(1500)
const pens = await b.eval(`document.querySelectorAll('.qc a.ibtn[href^="/edits"]').length`)
ok(pens > 0, '管理员在刷题页看到修订入口', `${pens} 个`)
const zhNow = await txt('.qc .zh')
ok(zhNow.includes(NEW_ZH), '题干已用新的中文译文', zhNow.slice(0, 30))
await b.eval(`document.querySelector('.qc .opt').click()`, false)
await sleep(800)
const mn = await txt('.qc .mnem')
ok(mn.includes(NEW_MNEM), '作答后显示新的记忆要点', mn.slice(0, 40))

console.log('\n【五】字段级还原 / 整题还原')
await b.goto(`/edits?q=${QID}`, 1200)
await b.waitFor('.stats', 20000)
await sleep(1800)
ok(await b.eval(`!!document.querySelector('.ed')`), '带 ?q= 直达本题并已展开')
ok(await b.eval(`!!document.querySelector('.rev-tag')`), '列表标出「改动 n 处」')

// 点「记忆要点」那一行的还原按钮
await b.eval(`(() => {
  const fld = [...document.querySelectorAll('.ed .fld')].find(f => /记忆要点/.test(f.querySelector('.lb')?.textContent))
  fld.querySelector('.mini').click()
})()`, false)
await sleep(400)
await clickText('保存修订')
await sleep(2000)
rec = await getEdit(QID)
ok(!!rec && !rec.mnem, '单字段还原后该项清空', JSON.stringify(rec?.mnem))
ok(rec && rec.qzh === NEW_ZH, '另一字段不受影响')

await clickText('还原为原文')
await sleep(2000)
ok(/还原/.test(await txt('.ed .msg')), '整题还原有回执', await txt('.ed .msg'))
rec = await getEdit(QID)
ok(!rec, '整题还原后云端记录被删除')

await b.goto(`/l/technician/T1A`, 2600)
await sleep(1200)
const zhBack = await txt('.qc .zh')
ok(!zhBack.includes(NEW_ZH), '刷题页回到题库原文', zhBack.slice(0, 30))

console.log('\n【六】权限：改写只认 role = admin')
// PocketBase 对规则拦截一律报 400（不像读接口那样给 403），
// 所以这里不能只看状态码，必须由是否落库来判定拦截是否真的生效。
const anon = await fetch(`${PB}/api/collections/hs_edits/records`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ qid: 'T1A99', qzh: '匿名写入' }),
}).then((r) => ({ status: r.status }))
await sleep(600)
const leaked = await getEdit('T1A99')
ok(anon.status >= 400 && !leaked, '未登录不能写修订', `HTTP ${anon.status}，落库 ${leaked ? 1 : 0} 条`)

/** 建一个普通账号并拿到它的 token */
async function plainUser(tag) {
  const rec = await api('/collections/users/records', {
    method: 'POST',
    body: JSON.stringify({ email: `${tag}${Date.now()}@ham.test`, password: PWD, passwordConfirm: PWD }),
  })
  const token = (await fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: rec.email, password: PWD }),
  }).then((r) => r.json())).token
  return { rec, token }
}

// 注册用户 ≠ 管理员：光登录不够，写不进去
const plain = await plainUser('pl')
const pwrite = await fetch(`${PB}/api/collections/hs_edits/records`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: plain.token },
  body: JSON.stringify({ qid: 'T1A97', qzh: '普通用户写入' }),
}).then((r) => ({ status: r.status }))
await sleep(600)
ok(!(await getEdit('T1A97')), '普通注册用户写不进题库', `HTTP ${pwrite.status}`)

// 自提权：改资料时顺手塞 role=admin
const up = await fetch(`${PB}/api/collections/users/records/${plain.rec.id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: plain.token },
  body: JSON.stringify({ role: 'admin' }),
}).then((r) => ({ status: r.status }))
const after = await api(`/collections/users/records/${plain.rec.id}`)
ok(up.status >= 400 && (after.role || '') === '', '无法给自己提权', `HTTP ${up.status}，role=${JSON.stringify(after.role)}`)

// 改昵称这类正常操作不能被上面的规则误伤
const nick = await fetch(`${PB}/api/collections/users/records/${plain.rec.id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: plain.token },
  body: JSON.stringify({ nickname: '台友' }),
}).then((r) => r.json())
ok(nick.nickname === '台友', '改自己的昵称不受影响')

// 伪造作者：即便有权限，author 也只能是自己
const other = await api('/collections/users/records', {
  method: 'POST',
  body: JSON.stringify({ email: `oth${Date.now()}@ham.test`, password: PWD, passwordConfirm: PWD }),
})
const me = await plainUser('me')
await api(`/collections/users/records/${me.rec.id}`, {
  method: 'PATCH', body: JSON.stringify({ role: 'admin' }),
})
const fake = await fetch(`${PB}/api/collections/hs_edits/records`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: me.token },
  body: JSON.stringify({ qid: 'T1A98', qzh: '伪造作者', author: other.id }),
}).then((r) => r.json())
ok(fake.author === me.rec.id, '伪造 author 被后端改成自己', `提交 ${other.id} → 实际 ${fake.author}`)

console.log('\n【七】前台：非管理员看不到任何修订入口')
await b.eval(`localStorage.clear()`, false)
await login(plain.rec.email)
// 从刷题页点铅笔会带 ?q= 跳过来，这里连带参数一起试，别只测裸路径
await b.goto(`/edits?q=${QID}`, 1600)
await sleep(1300)
ok((await path()) === '/', '带 ?q= 的直达链接也被挡回', await path())

await b.goto('/l/technician/T1A', 2600)
await sleep(1200)
const pens2 = await b.eval(`document.querySelectorAll('.qc a.ibtn[href^="/edits"]').length`)
ok(pens2 === 0, '刷题页不给非管理员显示修订入口', `${pens2} 个`)

console.log('\n清理测试数据')
await api(`/collections/hs_edits/records/${fake.id}`, { method: 'DELETE' })
await delUser(u.id)
await delUser(other.id)
await delUser(me.rec.id)
await delUser(plain.rec.id)

const errs = b.errors.filter((e) => !/Development|DevTools/.test(e))
console.log('控制台错误:', errs.length ? errs.slice(0, 6) : '无')
console.log(`\n${failures.length ? '✗ 失败 ' + failures.length + ' 项：\n  - ' + failures.join('\n  - ') : '✓ 全部通过'}`)
await b.close()
process.exit(failures.length ? 1 : 0)
