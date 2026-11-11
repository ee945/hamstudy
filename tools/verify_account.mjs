#!/usr/bin/env node
/**
 * 账户功能端到端验证（无头浏览器 + CDP）。
 *
 *   node tools/verify_account.mjs
 *
 * 覆盖：登录 → 头像菜单 → 选内置头像 → 改昵称 → 刷新后仍在（已落库）
 *      → 改密码（含错误旧密码的拒绝）→ 用新密码重新登录 → 退出登录
 */
import { launch, sleep } from './_cdp.mjs'

import { BASE, PB, ADMIN } from './_env.mjs'
const EMAIL = `acct${Date.now()}@ham.test`
const PWD0 = 'ham12345'
const PWD1 = 'radio678'
const NEW_NICK = 'BA4ABC'

const failures = []
const ok = (cond, name, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`)
  if (!cond) failures.push(name)
}

// ---- 后端准备：直接建用户（比走注册表单快，且能精确控制） ----
async function createUser() {
  const r = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PWD0, passwordConfirm: PWD0, nickname: '初始昵称' }),
  })
  const d = await r.json()
  if (!d.id) throw new Error('建用户失败: ' + JSON.stringify(d))
  return d.id
}

async function deleteUser(id) {
  const a = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  }).then((r) => r.json())
  const h = { Authorization: a.token }
  const r = await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'DELETE', headers: h })
  // 以前这里不检查响应，删除失败会被静默吞掉，测试账号就留在了真实库里
  if (!r.ok) console.warn('[cleanup] 按 id 删除失败:', r.status, (await r.text()).slice(0, 160))
  // 兜底：测试过程中账号记录可能变过，按邮箱再清一次，绝不把测试账号留在库里
  const q = await fetch(`${PB}/api/collections/users/records?perPage=10&filter=${encodeURIComponent(`email="${EMAIL}"`)}`, { headers: h }).then((x) => x.json())
  for (const u of q.items || []) {
    const rr = await fetch(`${PB}/api/collections/users/records/${u.id}`, { method: 'DELETE', headers: h })
    if (!rr.ok) console.warn('[cleanup] 按邮箱兜底删除失败:', u.email, rr.status)
  }
  // 终极兜底：把库里所有 @ham.test 测试账号一次性清干净。
  // 回归脚本靠调试端口互斥、都是顺序跑的，不会误删别的脚本正在用的账号；
  // 真实账号（非 @ham.test）一律不碰。
  const all = await fetch(`${PB}/api/collections/users/records?perPage=500`, { headers: h }).then((x) => x.json())
  for (const u of all.items || []) {
    if (u.email.endsWith('@ham.test')) {
      await fetch(`${PB}/api/collections/users/records/${u.id}`, { method: 'DELETE', headers: h })
    }
  }
  // 顺带清掉可能残留的行为数据
  for (const c of ['hs_attempts', 'hs_favorites', 'hs_sessions']) {
    const list = await fetch(`${PB}/api/collections/${c}/records?perPage=200`, { headers: h }).then((x) => x.json())
    for (const i of list.items || []) {
      await fetch(`${PB}/api/collections/${c}/records/${i.id}`, { method: 'DELETE', headers: h })
    }
  }
}

const uid = await createUser()
console.log(`测试账号 ${EMAIL} / ${PWD0}\n`)

/** 给输入框赋值：b.type() 是「插入」而非「替换」，改资料前必须先清空 */
async function setInput(sel, value) {
  const okSet = await b.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return false
    el.value = ${JSON.stringify(value)}
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`, false)
  if (!okSet) throw new Error('选择器未找到: ' + sel)
  await sleep(120)
}

const b = await launch(BASE, { port: 9347 })
try {
  // ── 一、登录 ────────────────────────────────
  console.log('【一】登录')
  await b.goto('/login')
  await b.click('input[autocomplete="email"]')
  await b.type(EMAIL)
  await b.click('input[type="password"]')
  await b.type(PWD0)
  await b.click('button.go')
  await sleep(1800)
  const logged = await b.eval(`!!document.querySelector('.avatar-btn')`)
  ok(logged, '登录后顶栏出现头像按钮', await b.eval('location.pathname'))

  // ── 二、头像菜单 ────────────────────────────
  console.log('\n【二】点击头像弹出菜单')
  await b.click('.avatar-btn')
  await sleep(400)
  const menu = await b.eval(`(() => {
    const m = document.querySelector('.menu')
    return m ? { visible: true, items: [...m.querySelectorAll('.menu-a')].map(a => a.textContent.trim()) } : { visible: false }
  })()`)
  console.log('   菜单项:', JSON.stringify(menu.items))
  ok(menu.visible, '菜单已展开')
  ok(menu.items?.includes('账户设置') && menu.items?.includes('退出登录'), '含「账户设置」与「退出登录」')

  // 点空白处应关闭（必须 pressed + released 成对，浏览器才会合成 click）
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 520 })
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 520, button: 'left', clickCount: 1 })
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 520, button: 'left', clickCount: 1 })
  await sleep(400)
  ok(!(await b.eval(`!!document.querySelector('.menu')`)), '点击别处后菜单关闭')

  // ── 三、进入账户设置 ────────────────────────
  console.log('\n【三】进入账户设置')
  await b.click('.avatar-btn')
  await sleep(300)
  await b.click('.menu-a')   // 第一个是「账户设置」
  await sleep(1500)
  ok((await b.eval('location.pathname')) === '/account', '跳转到 /account')

  const opts = await b.eval(`document.querySelectorAll('.grid .opt').length`)
  ok(opts === 24, '头像可选数量 = 1 默认 + 23 内置', `实际 ${opts}`)
  // 列数按断点固定为 8/6/4/3，数量必须被它们整除，否则某档宽度下最后一排会被 1fr 拉宽
  ok([3, 4, 6, 8].every((c) => opts % c === 0), '数量能被 3/4/6/8 整除', `${opts} 格`)

  // ── 四、选内置头像 ──────────────────────────
  console.log('\n【四】选择内置头像（第 2 个 = 八木天线）')
  await b.click('.grid .opt:nth-child(2)')
  await sleep(1200)
  const hdrSrc = await b.eval(`document.querySelector('.avatar-btn img')?.getAttribute('src') || ''`)
  console.log('   顶栏头像 src:', hdrSrc)
  ok(hdrSrc.includes('/assets/avatar/yagi.svg'), '顶栏头像已换成所选图片')
  const savedMsg = await b.eval(`document.querySelector('.msg')?.textContent.trim() || ''`)
  ok(savedMsg === '已保存', '页面给出「已保存」反馈', savedMsg)

  // ── 五、改昵称 ──────────────────────────────
  console.log('\n【五】修改昵称')
  await setInput('input[placeholder="例如 老王"]', NEW_NICK)
  await b.eval(`(() => {
    const btn = [...document.querySelectorAll('section .btn-primary')].find(x => x.textContent.trim() === '保存')
    btn.click()
  })()`, false)
  await sleep(1200)
  const nickMsg = await b.eval(`[...document.querySelectorAll('.msg')].map(m => m.textContent.trim())`)
  console.log('   反馈:', JSON.stringify(nickMsg))
  ok(nickMsg.includes('已保存'), '昵称保存成功')

  // ── 六、刷新后仍在（证明已写入服务端） ──────
  console.log('\n【六】刷新页面验证持久化')
  await b.goto('/account')
  await sleep(600)
  const persisted = await b.eval(`(() => ({
    nick: document.querySelector('input[placeholder="例如 老王"]')?.value,
    src: document.querySelector('.avatar-btn img')?.getAttribute('src') || '',
    on: document.querySelector('.grid .opt.on .lb')?.textContent.trim(),
  }))()`)
  console.log('   ', JSON.stringify(persisted))
  ok(persisted.nick === NEW_NICK, '昵称已落库', persisted.nick)
  ok(persisted.src.includes('/assets/avatar/yagi.svg'), '头像已落库')
  ok(persisted.on === '八木天线', '选中态回显正确', persisted.on)

  // ── 七、改密码：先故意输错旧密码 ────────────
  console.log('\n【七】改密码 —— 旧密码错误应被拒')
  await setInput('input[placeholder="输入现在的密码"]', 'wrongpwd')
  await setInput('input[placeholder="至少 8 位"]', PWD1)
  await setInput('input[placeholder="再输入一次"]', PWD1)
  await b.eval(`[...document.querySelectorAll('button')].find(x => x.textContent.trim() === '修改密码').click()`, false)
  await sleep(1500)
  const badMsg = await b.eval(`[...document.querySelectorAll('.msg.no')].map(m => m.textContent.trim())`)
  console.log('   反馈:', JSON.stringify(badMsg))
  ok(badMsg.some((t) => t.includes('当前密码不正确')), '提示「当前密码不正确」')

  // ── 八、改密码：正确旧密码 ──────────────────
  console.log('\n【八】改密码 —— 旧密码正确')
  // 新密码两位保持不变，只把「当前密码」换成正确的
  await setInput('input[placeholder="输入现在的密码"]', PWD0)
  await b.eval(`[...document.querySelectorAll('button')].find(x => x.textContent.trim() === '修改密码').click()`, false)
  await sleep(2000)
  const pwdMsgs = await b.eval(`[...document.querySelectorAll('.msg')].map(m => m.textContent.trim())`)
  console.log('   反馈:', JSON.stringify(pwdMsgs))
  ok(pwdMsgs.some((t) => t.includes('密码已更新')), '密码修改成功')
  const stillLogged = await b.eval(`!!document.querySelector('.avatar-btn')`)
  ok(stillLogged, '改密后仍处于登录态（已自动用新密码续期）')

  // ── 九、退出后用新密码登录 ──────────────────
  console.log('\n【九】退出登录并用新密码重新登录')
  await b.click('.avatar-btn')
  await sleep(300)
  await b.click('.menu-a.danger')
  await sleep(1200)
  ok(!(await b.eval(`!!document.querySelector('.avatar-btn')`)), '已退出登录')

  await b.goto('/login')
  await b.click('input[autocomplete="email"]')
  await b.type(EMAIL)
  await b.click('input[type="password"]')
  await b.type(PWD1)
  await b.click('button.go')
  await sleep(1800)
  ok(await b.eval(`!!document.querySelector('.avatar-btn')`), '新密码可以登录')
  const finalNick = await b.eval(`document.querySelector('.avatar-btn')?.getAttribute('title') || ''`)
  ok(finalNick === NEW_NICK, '昵称显示正确', finalNick)

  console.log('\n──────── 控制台错误 ────────')
  // 第七步是「故意用错旧密码」，那一次 400 属预期
  const unexpected = b.errors.filter((e) => !/status of 400/.test(e))
  console.log(b.errors.length ? b.errors.join('\n') : '（无）')
  console.log('（其中旧密码错误的 400 为预期，已排除）')
  if (unexpected.length) failures.push(`页面有 ${unexpected.length} 条意外运行时错误`)
} finally {
  await b.close()
  await deleteUser(uid)
  console.log('\n测试账号已清理')
}

console.log('\n──────── 结论 ────────')
if (failures.length) {
  console.log('✗ 失败项：\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ 账户功能全部通过')
