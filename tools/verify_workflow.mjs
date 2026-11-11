#!/usr/bin/env node
/**
 * 题库审批工作流端到端验证：
 *   ① 游客 / 普通用户：菜单与路由的可见性边界
 *   ② 编辑员：受限表单（英文原题与难度只读）→ 提交审核 → 题面不生效
 *   ③ 越权：直写 hs_edits / 自提权 / 自审 / 伪造日志全部被挡
 *   ④ 管理员审核通过：合并进 hs_edits，全站立即生效，日志留痕
 *   ⑤ 驳回：题面不动
 *   ⑥ 协助修改后提交生效：写入的是管理员改后的值
 *   ⑦ 管理员直接修订：立即生效并记 direct 日志
 *   ⑧ 「已人工修订」统计卡点击筛选
 *   ⑨ 修订日志页：贡献排行与明细统计
 *
 *   node tools/verify_workflow.mjs
 */
import { launch, sleep } from './_cdp.mjs'

import { BASE, PB, ADMIN } from './_env.mjs'
const PWD = 'ham12345'
const QID = 'T1A01'
const NEW_ZH = 'ZZ编辑员译文ZZ'
const NEW_MNEM = 'MM编辑员要点MM'

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
const list = async (col, filter = '') => {
  const q = filter ? `&filter=${encodeURIComponent(filter)}` : ''
  return (await api(`/collections/${col}/records?perPage=200${q}`)).items || []
}
const getEdit = async (qid) => (await list('hs_edits', `qid="${qid}"`))[0] || null
const getPending = async (qid) => (await list('hs_pending', `qid="${qid}"`))[0] || null
const clearAll = async (cols = ['hs_edits', 'hs_pending', 'hs_edit_logs']) => {
  for (const c of cols) {
    for (const it of await list(c)) await api(`/collections/${c}/records/${it.id}`, { method: 'DELETE' })
  }
}
/** 只清题面与提案，保留日志 —— 贡献榜要横跨多个小节统计 */
const clearData = () => clearAll(['hs_edits', 'hs_pending'])
const mkUser = async (role, tag) => {
  const email = `${tag}${Date.now()}@ham.test`
  const u = await api('/collections/users/records', {
    method: 'POST',
    body: JSON.stringify({ email, password: PWD, passwordConfirm: PWD, nickname: tag }),
  })
  if (role) await api(`/collections/users/records/${u.id}`, {
    method: 'PATCH', body: JSON.stringify({ role }),
  })
  return { ...u, email }
}
const delUser = async (id) => api(`/collections/users/records/${id}`, { method: 'DELETE' })
const tokenOf = async (email) => (await fetch(`${PB}/api/collections/users/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PWD }),
}).then((r) => r.json())).token
const asUser = async (p, email, opt = {}) => {
  const r = await fetch(`${PB}/api${p}`, {
    ...opt, headers: {
      'Content-Type': 'application/json', Authorization: await tokenOf(email),
    },
  })
  const raw = await r.text()
  return { status: r.status, body: raw ? JSON.parse(raw) : {} }
}

const b = await launch(BASE, { port: 9421 })
const path = () => b.eval(`location.pathname`)
const txt = (sel) => b.eval(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim() || ''`)

async function login(email) {
  // 切身份前清掉本地登录态，避免上一位用户的 token 还挂在页面里
  await b.eval(`localStorage.clear()`, false)
  await b.goto('/login', 1600)
  await b.eval(`(() => {
    const e = document.querySelector('input[autocomplete="email"]')
    e.value = ${JSON.stringify(email)}; e.dispatchEvent(new Event('input', { bubbles: true }))
    const p = document.querySelector('input[type="password"]')
    p.value = ${JSON.stringify(PWD)}; p.dispatchEvent(new Event('input', { bubbles: true }))
  })()`, false)
  await b.click('button.go', 300)
  await sleep(2400)
}
async function enableZh() {
  // 中文译文默认关闭，题目卡里根本不渲染 qZh，必须先打开才能验证题面变化
  await b.eval(`(() => {
    const k = 'hamstudy:ui'
    let v = {}
    try { v = JSON.parse(localStorage.getItem(k) || '{}') } catch {}
    v.showZh = true
    localStorage.setItem(k, JSON.stringify(v))
  })()`, false)
}
async function menuText() {
  await b.eval(`document.querySelector('.avatar-btn').click()`, false)
  await sleep(450)
  const t = await b.eval(`[...document.querySelectorAll('.menu-a')].map((a) => a.textContent.trim()).join(' | ')`)
  await b.eval(`document.querySelector('.avatar-btn').click()`, false)
  await sleep(250)
  return t
}
async function clickText(text) {
  return b.eval(`(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)})
    if (!btn) return false
    btn.scrollIntoView({ block: 'center' }); btn.click(); return true
  })()`, false)
}
/** 按标签定位编辑器里的输入框 */
const fld = (label, all = false) =>
  `[...document.querySelectorAll('.ed .fld, .body .fld')].find(f => f.querySelector('.lb')?.textContent.includes(${JSON.stringify(label)}))`
    + (all ? `?.querySelectorAll('textarea')` : `?.querySelector('textarea, input')`)
async function fill(expr, value) {
  return b.eval(`(() => {
    const el = ${expr}
    if (!el) return false
    el.value = ${JSON.stringify(value)}
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`, false)
}

await clearAll()

console.log('\n【一】游客 / 普通用户：可见性边界')
await b.eval(`localStorage.clear()`, false)
await b.goto('/edits', 1500)
ok((await path()) === '/', '游客访问 /edits 跳回首页', await path())
await b.goto('/reviews', 1500)
ok((await path()) === '/', '游客访问 /reviews 跳回首页', await path())
await b.goto('/edit-log', 1500)
ok((await path()) === '/', '游客访问 /edit-log 跳回首页', await path())

const plain = await mkUser('', 'plain')
await login(plain.email)
ok(await b.eval(`!!document.querySelector('.avatar-btn')`), '普通用户登录成功')
const pm = await menuText()
ok(!/题库维护|待审修订/.test(pm), '菜单里没有维护与审核入口', pm)
ok(/修订日志/.test(pm), '菜单里有修订日志')
await b.goto('/edits', 1500)
ok((await path()) === '/', '普通用户 /edits 跳回首页')
await b.goto('/reviews', 1500)
ok((await path()) === '/', '普通用户 /reviews 跳回首页')
await b.goto('/edit-log', 1800)
ok((await path()) === '/edit-log', '普通用户能看修订日志页')
await b.waitFor('.stats', 15000)
ok((await txt('.stats')).includes('参与人数'), '日志页统计卡渲染')

console.log('\n【二】编辑员：受限表单与提交审核')
const editor = await mkUser('editor', 'ed')
await login(editor.email)
const em = await menuText()
ok(/题库维护/.test(em) && /待审修订/.test(em), '编辑员菜单出现维护与审核入口', em)
await b.goto(`/edits?q=${QID}`, 2200)
await b.waitFor('.ed', 20000)
await sleep(900)
ok((await txt('.badge')) === '编辑员', '页面显示编辑员徽章')
ok((await txt('.sub')).includes('审核通过'), '副标题说明需审核')

const ro = await b.eval(`(() => {
  const out = {}
  document.querySelectorAll('.ed .fld').forEach(f => {
    const t = f.querySelector('.lb')?.textContent || ''
    const first = f.querySelector('textarea, input')
    const all = [...f.querySelectorAll('textarea')]
    if (t.includes('英文题干')) out.qen = !!first?.disabled
    if (t.includes('中文题干')) out.qzh = !!first?.disabled
    if (t.includes('英文选项')) out.opten = all.length > 0 && all.every(x => x.disabled)
    if (t.includes('中文选项')) out.optzh = all.length > 0 && all.every(x => x.disabled)
    if (t.includes('难度')) out.diff = !!f.querySelector('input[type=range]')?.disabled
    if (t.includes('记忆要点')) out.mnem = !!first?.disabled
    if (t.includes('题目解析')) out.expl = !!first?.disabled
  })
  return out
})()`)
ok(ro.qen && ro.opten && ro.diff, '英文题干 / 英文选项 / 难度只读', JSON.stringify(ro))
ok(!ro.qzh && !ro.optzh && !ro.mnem && !ro.expl, '中文题干 / 中文选项 / 要点 / 解析可改', JSON.stringify(ro))
ok((await txt('.lb-dim')).includes('审核通过生效后，将记录入修订日志'), '修订说明提示已补文案')

await fill(fld('中文题干'), NEW_ZH)
await fill(fld('记忆要点'), NEW_MNEM)
ok(await clickText('提交审核'), '点到「提交审核」按钮')
await sleep(1800)
const p1 = await getPending(QID)
ok(!!p1, '生成待审提案')
ok(p1 && p1.author === editor.id, '提案作者是当前编辑员', p1?.author)
ok(p1 && p1.authorName === 'ed', '提交时快照了昵称', p1?.authorName)
ok(p1 && (p1.fields || []).includes('qzh') && (p1.fields || []).includes('mnem'), '只记录真正改过的字段', JSON.stringify(p1?.fields))
ok(p1 && !p1.status, '状态仍是待审（空串）')
ok(p1 && p1.qzh === NEW_ZH && p1.mnem === NEW_MNEM, '提案内容正确')
ok(!(await getEdit(QID)), 'hs_edits 仍为空 —— 改动未生效')
await enableZh()
await b.goto(`/l/technician/T1A`, 2200)
await sleep(1200)
const browseText = await b.eval(`document.querySelector('.qc')?.textContent || ''`)
ok(!browseText.includes(NEW_ZH), '刷题页看到的仍是原文（未生效）')
ok(await b.eval(`!!document.querySelector('.qc .zh')`), '中文译文已开启，题面确实渲染了')
const log1 = await list('hs_edit_logs', `action="submit"`)
ok(log1.length === 1 && log1[0].userId === editor.id, '日志记下一条 submit')

console.log('\n【三】越权尝试（服务端拦截）')
const w1 = await asUser('/collections/hs_edits/records', editor.email, {
  method: 'POST', body: JSON.stringify({ qid: QID, qzh: 'HACK' }),
})
ok(w1.status >= 400, '编辑员直写 hs_edits 被拒', `HTTP ${w1.status}`)
const w2 = await asUser(`/collections/users/records/${editor.id}`, editor.email, {
  method: 'PATCH', body: JSON.stringify({ role: 'admin' }),
})
ok(w2.status >= 400, '编辑员自提权被拒', `HTTP ${w2.status}`)
const w3 = await asUser(`/collections/hs_pending/records/${p1.id}`, editor.email, {
  method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
})
ok(w3.status >= 400, '编辑员自己把提案改成已通过被拒', `HTTP ${w3.status}`)
const w4 = await asUser('/collections/hs_edit_logs/records', editor.email, {
  method: 'POST', body: JSON.stringify({
    qid: QID, userId: editor.id, userName: 'x', userRole: 'editor', action: 'approve',
  }),
})
ok(w4.status >= 400, '编辑员伪造 approve 日志被拒', `HTTP ${w4.status}`)
ok(!(await getEdit(QID)), '以上越权都没污染生效题面')

console.log('\n【四】管理员审核通过 → 立即生效')
const admin = await mkUser('admin', 'adm')
await login(admin.email)
await b.goto('/reviews', 2200)
await b.waitFor('.item', 20000)
await sleep(700)
const am = await menuText()
ok(/待审修订/.test(am) && /题库维护/.test(am), '管理员菜单有维护与审核入口')
ok((await txt('.tabs')).includes('待审'), '审核台显示待审列表')
await b.eval(`document.querySelector('.item .head').click()`, false)
await sleep(700)
ok((await txt('.body')).includes('提案改动'), '展开后显示当前 / 提案对照')
ok((await txt('.body')).includes('通过并生效'), '有「通过并生效」按钮')
ok(await clickText('通过并生效'), '点通过')
await sleep(2000)
const e1 = await getEdit(QID)
ok(!!e1 && e1.qzh === NEW_ZH && e1.mnem === NEW_MNEM, '合并进 hs_edits，内容正确', e1?.qzh)
ok(!!e1 && !!e1.at, '生效记录带时间戳')
const p1b = await getPending(QID)
ok(p1b && p1b.status === 'approved', '提案标记为已通过', p1b?.status)
const logApprove = await list('hs_edit_logs', `action="approve"`)
ok(logApprove.length === 1 && logApprove[0].contributor === editor.id,
  '日志记 approve 并把贡献归给编辑员', JSON.stringify(logApprove[0]?.contributor))
await enableZh()
await b.goto(`/l/technician/T1A`, 2200)
await sleep(1200)
const browseText2 = await b.eval(`document.querySelector('.qc')?.textContent || ''`)
ok(browseText2.includes(NEW_ZH), '刷题页立即看到新译文')

console.log('\n【五】驳回：题面不动')
await clearData()
await login(editor.email)
await b.goto(`/edits?q=${QID}`, 2200)
await b.waitFor('.ed', 20000)
await sleep(800)
await fill(fld('中文题干'), 'BB驳回测试BB')
await clickText('提交审核')
await sleep(1600)
await login(admin.email)
await b.goto('/reviews', 2000)
await b.waitFor('.item', 15000)
await b.eval(`document.querySelector('.item .head').click()`, false)
await sleep(600)
await fill(`document.querySelector('.body input[placeholder="选填"]')`, '译文不准确')
ok(await clickText('驳回'), '点驳回')
await sleep(1600)
const p2 = await getPending(QID)
ok(p2 && p2.status === 'rejected', '提案标记已驳回', p2?.status)
ok(!(await getEdit(QID)), 'hs_edits 仍为空，题面没变')
ok((await list('hs_edit_logs', `action="reject"`)).length === 1, '日志记下驳回')

console.log('\n【六】协助修改后提交生效')
await clearData()
await login(editor.email)
await b.goto(`/edits?q=${QID}`, 2200)
await b.waitFor('.ed', 20000)
await sleep(800)
await fill(fld('题目解析'), 'CC原始提案解析CC')
await clickText('提交审核')
await sleep(1600)
const ASSIST = 'DD管理员协助改过的解析DD'
await login(admin.email)
await b.goto('/reviews', 2000)
await b.waitFor('.item', 15000)
await b.eval(`document.querySelector('.item .head').click()`, false)
await sleep(600)
await fill(fld('题目解析'), ASSIST)
ok(await clickText('通过并生效'), '协助修改后提交')
await sleep(2000)
const e3 = await getEdit(QID)
ok(!!e3 && e3.expl === ASSIST, '生效的是管理员改后的值', e3?.expl)
ok(!!e3 && !e3.qen, '英文原题未被提案影响')
const logAssist = await list('hs_edit_logs', `action="assist"`)
ok(logAssist.length === 1 && logAssist[0].contributor === editor.id, '日志记 assist 且归功编辑员')

console.log('\n【七】管理员直接修订 + 日志')
await clearData()
await login(admin.email)
await b.goto(`/edits?q=${QID}`, 2200)
await b.waitFor('.ed', 20000)
await sleep(800)
await fill(fld('英文题干'), 'EE admin original EE')
ok(await clickText('保存修订'), '管理员保存修订')
await sleep(1800)
const e4 = await getEdit(QID)
ok(!!e4 && e4.qen === 'EE admin original EE', '英文原题直接生效')
ok((await list('hs_edit_logs', `action="direct"`)).length === 1, '日志记下 direct')

console.log('\n【八】「已人工修订」统计卡点击筛选')
await b.goto('/edits', 2200)
await b.waitFor('.stats', 15000)
await sleep(700)
const revisedN = Number(await b.eval(`document.querySelectorAll('.s b')[1]?.textContent.trim()`))
ok(revisedN >= 1, '统计卡显示已修订数', String(revisedN))
await b.eval(`document.querySelectorAll('.s')[1].click()`, false)
await sleep(800)
const sel = await b.eval(`document.querySelectorAll('.filters select')[1]?.value`)
ok(sel === 'revised', '点击后状态筛选切到「已修订」', String(sel))
const shown = await b.eval(`document.querySelectorAll('.list .item').length`)
ok(shown >= 1 && shown <= revisedN, '列表只显示已修订过的题', `${shown} 条`)
ok(await b.eval(`document.querySelectorAll('.s')[1].classList.contains('active')`), '卡片有激活态')
await b.eval(`document.querySelectorAll('.s')[1].click()`, false)
await sleep(600)
ok((await b.eval(`document.querySelectorAll('.filters select')[1]?.value`)) === '', '再点一次取消筛选')

console.log('\n【九】修订日志页：贡献统计')
await b.goto('/edit-log', 2200)
await b.waitFor('.tbl', 15000)
await sleep(600)
const rank = await txt('.tbl')
ok(rank.includes('生效修订') && rank.includes('提交提案'), '贡献排行有统计列')
const logCount = (await list('hs_edit_logs')).length
ok(logCount >= 5, '修订日志累计记录了全流程操作', `${logCount} 条`)
ok(rank.includes('adm') && rank.includes('ed'), '排行列出管理员与编辑员', rank.slice(0, 120))
const rowsN = await b.eval(`document.querySelectorAll('.tbl tbody tr').length`)
ok(rowsN === 2, '贡献榜按人汇总为 2 行', `${rowsN} 行`)
await clickText('操作明细')
await sleep(500)
ok((await txt('.filters')).includes('全部动作'), '明细页筛选控件渲染')
const detail = await txt('.tbl')
ok(detail.includes('直接修订') || detail.includes('审核通过') || detail.includes('提交提案'), '明细列出操作动作')

console.log('\n【十】编辑员撤下提案也记入日志')
await clearData()
await login(editor.email)
await b.goto(`/edits?q=${QID}`, 2200)
await b.waitFor('.ed', 20000)
await sleep(800)
await fill(fld('中文题干'), 'FF撤下测试FF')
await clickText('提交审核')
await sleep(1600)
await b.goto('/reviews', 1800)
await b.waitFor('.item', 15000)
await b.eval(`document.querySelector('.item .head').click()`, false)
await sleep(600)
ok(await clickText('撤下这份提案'), '点撤下')
await sleep(1600)
ok(!(await getPending(QID)), '待审提案已移除')
ok((await list('hs_edit_logs', `action="withdraw"`)).length === 1, '日志记下 withdraw')

console.log('\n清理测试数据')
// 先清浏览器登录态，避免页面继续拿已删账号的 token 请求造成 401 噪音
await b.eval(`localStorage.clear()`, false)
await sleep(400)
for (const u of [plain, editor, admin]) await delUser(u.id)
await clearAll()
const left = await api('/collections/users/records?perPage=1')
ok(left.totalItems >= 2, '只删测试账号，原有账号保留', `剩余 ${left.totalItems}`)

const errs = b.errors.filter((e) => !/favicon/i.test(e))
ok(errs.length === 0, '控制台无报错', errs.slice(0, 2).join(' | '))
await b.close()

console.log(`\n${failures.length ? '✗ 失败 ' + failures.length + ' 项：\n  - ' + failures.join('\n  - ') : '✓ 全部通过'}`)
process.exit(failures.length ? 1 : 0)
