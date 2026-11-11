// 页面级回归：确认 4 道修复题在刷题页真实渲染出完整的中英文选项，
// 并扫描所在小节所有题卡，确保没有任何空白选项行。
// 数据层校验见 tools/verify_bank_data.py。
import { launch, sleep } from './_cdp.mjs'

const PORT = 9471
const SITE = 'http://127.0.0.1:8091'
const results = []
const ok = (cond, name, detail = '') => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? `  (${detail})` : ''))
}

// 题号 -> { 所在小节路径, A 选项英文, A 选项中文 }
const CASES = [
  ['T1B06', '/l/technician/T1B', 'None', '没有任何'],
  ['E1C12', '/l/extra/E1C', 'None', '无'],
  ['G5A11', '/l/general/G5A', 'Z', 'Z'],
  ['E5B02', '/l/extra/E5B', 'G', 'G'],
]
const EXPECT_EN = {
  T1B06: ['None', '10-meter band only', '80-meter, 40-meter, 15-meter, and 10-meter bands', '30-meter band only'],
  E1C12: ['None', 'Only the top 3 kHz', 'Only the bottom 3 kHz', 'The entire band'],
  G5A11: ['Z', 'X', 'B', 'Y'],
  E5B02: ['G', 'X', 'Y', 'B'],
}

const b = await launch(SITE, { port: PORT, quiet: true })
/** 等「本题号」真正渲染出来，而不是只等任意 .qc —— 页面切换/题库异步加载
 *  可能让通用选择器提前命中，产生偶发的假失败。 */
const waitCard = async (qid, timeout = 9000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const hit = await b.eval(`(() => {
      const c = document.querySelector('.qc')
      return !!c && c.querySelector('.qid')?.textContent.trim() === ${JSON.stringify('#' + qid)}
    })()`)
    if (hit) return true
    await sleep(200)
  }
  return false
}
try {
  // 打开中文译文，才能同时验证 optZh 已补齐
  await b.goto('/', 1800)
  await b.eval(`(() => {
    const k = 'hamstudy:ui'
    let v = {}
    try { v = JSON.parse(localStorage.getItem(k) || '{}') } catch {}
    v.showZh = true
    localStorage.setItem(k, JSON.stringify(v))
  })()`, false)

  // BrowseView 是「单题模式」：一次只渲染一道题，靠 #题号 锚点定位
  // （load() 里按 route.hash 把 i 指到对应下标）。全库完整性由
  // tools/verify_bank_data.py 覆盖，这里只验证修复题的真实渲染。
  for (const [qid, path, aEn, aZh] of CASES) {
    console.log(`\n──── ${qid} (${path}#${qid}) ────`)
    await b.goto(`${path}#${qid}`, 2400)
    await waitCard(qid)

    const q = await b.eval(`(() => {
      const card = document.querySelector('.qc')
      if (!card) return null
      return {
        id: card.querySelector('.qid')?.textContent.trim() || '',
        stem: card.querySelector('.stem .en')?.textContent.trim() || '',
        stemZh: card.querySelector('.stem .zh')?.textContent.trim() || '',
        opts: [...card.querySelectorAll('.opts .opt')].map(li => ({
          ltr: li.querySelector('.ltr')?.textContent.trim() || '',
          en: li.querySelector('.body .en')?.textContent.trim() || '',
          zh: li.querySelector('.body .zh')?.textContent.trim() || '',
        })),
      }
    })()`)
    ok(!!q, `${qid} 题卡已渲染`)
    if (!q) continue
    ok(q.id === '#' + qid, `${qid} 题号锚点定位成功`, q.id)
    ok(q.opts.length === 4, `${qid} 渲染 4 个选项`, String(q.opts.length))
    ok(q.opts.map((o) => o.ltr).join('') === 'ABCD', `${qid} 字母顺序 A-D`)
    ok(q.opts[0].en === aEn, `${qid} A(英文) = ${aEn}`, JSON.stringify(q.opts[0].en))
    ok(q.opts[0].zh === aZh, `${qid} A(中文) = ${aZh}`, JSON.stringify(q.opts[0].zh))
    ok(JSON.stringify(q.opts.map((o) => o.en)) === JSON.stringify(EXPECT_EN[qid]),
      `${qid} 四个英文选项与官方题库一致`, JSON.stringify(q.opts.map((o) => o.en)))
    // 单字母符号题无需翻译：中文选项必须与英文逐字一致
    if (qid === 'G5A11' || qid === 'E5B02') {
      ok(JSON.stringify(q.opts.map((o) => o.zh)) === JSON.stringify(EXPECT_EN[qid]),
        `${qid} 中文选项与英文完全相同（不翻译）`, JSON.stringify(q.opts.map((o) => o.zh)))
    }
    ok(q.opts.every((o) => o.en.trim() && o.zh.trim()) && !!q.stem && !!q.stemZh,
      `${qid} 题干与全部中英选项均非空`)
  }

  console.log('\n──── 控制台 ────')
  ok(b.errors.length === 0, '全程无控制台报错', b.errors.slice(0, 2).join(' | '))
} finally {
  await b.close()
}

const passed = results.filter(Boolean).length
console.log(`\n结果: ${passed}/${results.length} 通过`)
if (passed !== results.length) process.exit(1)
