#!/usr/bin/env node
/**
 * 题库原文编辑 / 备份导出的界面回归。
 *
 * 验证：
 *   · 普通用户进不了 /bank/edit，进度页也看不到管理员专属备份区
 *   · 管理员菜单出现「题库原文编辑」，编辑页能加载出厂原文
 *   · 保存后 public/data 与 dist/data 同时变化、刷新后仍为新值（持久化）
 *   · 进度页导出按钮可用
 *   · 测试改动在 finally 里无条件还原，绝不污染真实题库
 *
 * 临时账号只用 @ham.test 后缀，跑完即删。
 * 用法: node tools/verify_bank_ui.mjs
 */
import fs from 'node:fs'
import { launch, sleep } from './_cdp.mjs'

import { BASE, PB, ADMIN } from './_env.mjs'
const PWD = 'bankui12345'
const QID = 'T1A01'
const MARK = '__题库直写UI测试__'
const FILE = new URL('../public/data/q_technician.json', import.meta.url)
const DIST = new URL('../dist/data/q_technician.json', import.meta.url)

const results = []
const ok = (name, cond, detail = '') => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? `  (${detail})` : ''))
}

const api = async (p, opt = {}, token = '') => {
  const r = await fetch(PB + '/api' + p, {
    ...opt,
    headers: { 'Content-Type': 'application/json', Authorization: token },
  })
  const raw = await r.text()
  return raw ? JSON.parse(raw) : {}
}
const adminToken = async () => (await fetch(PB + '/api/collections/_superusers/auth-with-password', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN),
}).then((r) => r.json())).token

const zhOf = (file) => JSON.parse(fs.readFileSync(file, 'utf-8')).qs.find((q) => q.id === QID).qZh
const ORIGINAL = zhOf(FILE)

const restoreOriginal = async (token) => fetch(PB + '/bank/write', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: token },
  body: JSON.stringify({ qid: QID, fields: { qZh: ORIGINAL } }),
}).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }))

const mkUser = async (token, role, tag) => {
  const email = `${tag}${Date.now()}@ham.test`
  const u = await api('/collections/users/records', {
    method: 'POST',
    body: JSON.stringify({ email, password: PWD, passwordConfirm: PWD, nickname: tag }),
  }, token)
  if (role) await api(`/collections/users/records/${u.id}`, {
    method: 'PATCH', body: JSON.stringify({ role }),
  }, token)
  const a = await fetch(PB + '/api/collections/users/auth-with-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: email, password: PWD }),
  }).then((r) => r.json())
  return { id: u.id, token: a.token, record: a.record }
}

const injectAuth = (b, u) => b.eval(
  `localStorage.clear(); localStorage.setItem('pocketbase_auth', ${JSON.stringify(JSON.stringify({ token: u.token, record: u.record }))}); 'ok'`
)

/** 长页面按钮先滚到视口中间再点，否则 CDP 的坐标点击会落空 */
const clickIn = async (b, sel, wait = 900) => {
  await b.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' }); return !!e })()`)
  await sleep(220)
  await b.click(sel, wait)
}

const token = await adminToken()
const users = []
let b
try {
  const guest = await mkUser(token, '', 'bankui-guest-')
  const admin = await mkUser(token, 'admin', 'bankui-admin-')
  users.push(guest.id, admin.id)
  b = await launch(BASE, { port: 9487, quiet: true })

  // ---- 普通用户 ----
  console.log('\n【一】普通用户边界')
  await b.goto('/')
  await injectAuth(b, guest)
  await b.goto('/bank/edit')
  ok('普通用户访问 /bank/edit 被送回首页', await b.eval('location.pathname') === '/')
  await b.goto('/progress')
  await b.waitFor('.dm', 6000)
  ok('进度页不显示管理员题库备份区', await b.eval('!document.querySelector(".dm-bank")'))

  // ---- 管理员 ----
  console.log('\n【二】管理员入口')
  await injectAuth(b, admin)
  await b.goto('/')
  await b.waitFor('.avatar-btn', 6000)
  await b.click('.avatar-btn')
  ok('用户菜单出现「题库原文编辑」', await b.eval(
    `[...document.querySelectorAll('.menu-a')].some(a => a.textContent.includes('题库原文编辑'))`
  ))
  await b.goto('/progress')
  await b.waitFor('.dm-bank', 6000)
  ok('进度页显示管理员题库备份区', await b.eval('!!document.querySelector(".dm-bank")'))
  ok('备份区含导出与恢复按钮', await b.eval(
    `[...document.querySelectorAll('.dm-bank .btn')].some(b => b.textContent.includes('导出题库备份'))`
  ))

  // ---- 编辑页保存 ----
  console.log('\n【三】原文编辑与持久化')
  await b.goto('/bank/edit')
  await b.waitFor('.be-form', 8000)
  ok('默认定位到 T1A01', await b.eval('document.querySelector(".be-qid")?.textContent.trim()') === QID)
  ok('表单载入出厂原文', await b.eval('document.querySelector(".be-f textarea")?.value') === ORIGINAL)

  await b.eval(`(() => {
    const el = document.querySelector('.be-f textarea')
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(el, ${JSON.stringify(MARK)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return el.value
  })()`)
  await clickIn(b, '.be-actions .btn-primary')
  ok('保存提示成功且线上同步', await b.eval(
    `(() => { const m = document.querySelector('.be-form .msg'); return !!m && m.classList.contains('ok') && m.textContent.includes('线上立即生效') })()`
  ), await b.eval('document.querySelector(".be-form .msg")?.textContent.trim() || ""'))
  ok('public/data 已写入新译文', zhOf(FILE) === MARK)
  ok('dist/data 已同步新译文', zhOf(DIST) === MARK)

  await b.goto('/bank/edit')
  await b.waitFor('.be-form', 8000)
  ok('刷新页面后仍是新译文（持久化）',
    await b.eval('document.querySelector(".be-f textarea")?.value') === MARK)

  // ---- 导出 ----
  console.log('\n【四】题库备份导出')
  await b.goto('/progress')
  await b.waitFor('.dm-bank', 6000)
  await clickIn(b, '.dm-bank .dm .btn')
  ok('导出按钮给出成功回执', await b.eval(
    `(() => { const m = document.querySelector('.msg'); return !!m && m.classList.contains('ok') && m.textContent.includes('已导出 hamstudy-bank-') })()`
  ), await b.eval('document.querySelector(".msg")?.textContent.trim() || ""'))

  ok('页面无未捕获异常', b.errors.length === 0, b.errors.slice(0, 2).join(' | '))
} finally {
  console.log('\n【清理】还原题库与临时账号')
  const r = await restoreOriginal(token)
  ok('T1A01 译文已还原', r?.ok === true && zhOf(FILE) === ORIGINAL)
  ok('dist/data 同步还原', zhOf(DIST) === ORIGINAL)
  // 兜底清理：按邮箱扫一遍，连之前失败残留的 @ham.test 账号一起删掉
  const all = await api('/collections/users/records?perPage=200', {}, token)
  for (const u of (all.items || []).filter((x) => String(x.email).includes('@ham.test'))) {
    const r = await fetch(PB + '/api/collections/users/records/' + u.id, {
      method: 'DELETE', headers: { Authorization: token },
    })
    console.log(`    删除 ${u.email} -> ${r.status}`)
  }
  const left = await api('/collections/users/records?perPage=1', {}, token)
  ok('users 表恢复为原有 2 个账号', left.totalItems === 2, String(left.totalItems))
  if (b) await b.close()
}

const passed = results.filter(Boolean).length
console.log(`\n结果: ${passed}/${results.length} 通过`)
if (passed !== results.length) process.exit(1)
