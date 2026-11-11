<script setup>
/**
 * 学习进度。
 *
 * 三处口径刻意与刷题模式对齐：
 *  · 近 14 天活跃度 = 每日答题流水条数（不是时长），柱高按窗口内峰值归一化；
 *  · 各级别掌握情况 = replayDrill + summarize 得到的整级完成度，与刷题页
 *    「全部题目」用的是同一份掌握分（含重置标记），不再用「小节覆盖率」；
 *  · 模考记录只列最近 5 场，完整列表在 /progress/exams，每场都能回看成绩单。
 */
import { computed, onMounted, ref } from 'vue'
import { useBank } from '../stores/bank'
import { useStudy } from '../stores/study'
import { useDrill } from '../stores/drill'
import { useUser } from '../stores/user'
import { replayDrill, summarize } from '../lib/drill'
import { exportBackup, exportAttemptsCsv, exportExamsCsv, parseBackup } from '../lib/backup'
import { exportBankBackup, parseBankBackup, restoreBankBackup, backupFileNames } from '../lib/bankFiles'
import ExamHistoryList from '../components/ExamHistoryList.vue'

const bank = useBank()
const st = useStudy()
const drill = useDrill()
const user = useUser()

onMounted(() => bank.fetchMeta())

const stats = computed(() => st.stats)

/** 近 14 天每日「答题流水条数」。
 * 刷题 / 模考 / 错题本 / 收藏夹每次作答都写一条流水；模考交卷会一次写入整卷题数。
 * 只读浏览、主动显示答案、跳过不写记录，因此不出现在这张图里。 */
const daily = computed(() => {
  const arr = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const key = d.toDateString()
    const n = st.attempts.filter((a) => new Date(a.ts).toDateString() === key).length
    arr.push({ d, n, key, label: `${d.getMonth() + 1}/${d.getDate()}` })
  }
  return arr
})
const maxDay = computed(() => Math.max(1, ...daily.value.map((x) => x.n)))
const total14 = computed(() => daily.value.reduce((s, x) => s + x.n, 0))
const activeDays = computed(() => daily.value.filter((x) => x.n > 0).length)

/** 各级别：整级完成度 = round(100 × Σs / 2N)，N 为该级别全部题目数。
 * 这是「各小节完成度按题数加权的平均」，与刷题模式选「全部题目」时的读数完全相同。 */
const byLevel = computed(() => {
  if (!bank.meta) return []
  return bank.meta.levels.map((l) => {
    const secs = l.blocks.flatMap((b) => b.secs)
    const ids = secs.flatMap((s) => s.ids)
    const { score, seen } = replayDrill(st.attempts, ids, drill.resets)
    const all = summarize(ids, score, seen)

    // 小节读数用同一份掌握分聚合，薄弱小节按完成度（而非正确率）排序
    const secStats = secs.map((s) => ({ code: s.code, ...summarize(s.ids, score, seen) }))
    const weak = secStats
      .filter((s) => s.done > 0)
      .sort((a, b) => a.aptitude - b.aptitude || a.code.localeCompare(b.code))
      .slice(0, 4)

    // 正确率仍按真实作答流水统计（含全部练习模式），只作辅助读数
    const idSet = new Set(ids)
    let tried = 0, right = 0
    for (const a of st.attempts) {
      if (!idSet.has(a.qid)) continue
      tried++
      if (a.ok) right++
    }
    return {
      ...l,
      aptitude: all.aptitude,
      seenPct: all.seenPct,
      sum: all.sum,
      n: all.n,
      accPct: tried ? Math.round((right / tried) * 100) : 0,
      tried,
      weak,
      secCount: secs.length,
    }
  })
})

/** 进度页只放最近 5 场；全部场次在独立页 */
const allExams = computed(() => [...st.sessions].sort((a, b) => b.ts - a.ts))
const exams = computed(() => allExams.value.slice(0, 5))

/* ---------------- 数据管理：备份 / 恢复 / 清空 ---------------- */

const msgData = ref(null)      // { ok, text }
const confirmReset = ref(false)
const wiping = ref(false)
const fileInput = ref(null)
const bankFileInput = ref(null)
const bankBusy = ref(false)

const cnt = computed(() => st.counts)

function toast(ok, text) {
  msgData.value = { ok, text }
  clearTimeout(toast._t)
  toast._t = setTimeout(() => (msgData.value = null), 4000)
}

function doExportBackup() {
  const name = exportBackup(st.d, {
    email: user.user?.email,
    nickname: user.user?.nickname,
    callsign: user.callsign,
  })
  toast(true, `已导出 ${name}（${cnt.value.attempts} 次作答 · ${cnt.value.favs} 条收藏 · ${cnt.value.sessions} 场模考）`)
}

function doExportAttempts() {
  if (!cnt.value.attempts) { toast(false, '还没有答题记录可导出'); return }
  toast(true, `已导出 ${exportAttemptsCsv(st.attempts)}`)
}

function doExportExams() {
  if (!cnt.value.sessions) { toast(false, '还没有模考记录可导出'); return }
  toast(true, `已导出 ${exportExamsCsv(st.sessions)}`)
}

async function onPickFile(e) {
  const f = e.target.files?.[0]
  e.target.value = ''   // 允许连续选同一个文件
  if (!f) return
  const r = await parseBackup(f)
  if (!r.ok) { toast(false, r.error); return }
  const res = await st.importBackup(r.data)
  toast(true, `已从备份恢复：新增 ${res.added} 条记录（备份共 ${res.got} 条）`)
}

/** 管理员：把四份权威题库 JSON 原样打包导出，供故障后重建 */
async function doExportBank() {
  bankBusy.value = true
  try {
    const name = await exportBankBackup()
    toast(true, `已导出 ${name}（meta.json + 三个 q_*.json）`)
  } catch (e) {
    toast(false, e?.message || String(e))
  } finally {
    bankBusy.value = false
  }
}

/** 管理员：从备份覆盖服务端题库文件，必须二次确认 */
async function onPickBankFile(e) {
  const f = e.target.files?.[0]
  e.target.value = ''   // 允许连续选同一个文件
  if (!f) return
  let backup
  try {
    backup = await parseBankBackup(f)
  } catch (err) {
    toast(false, err?.message || String(err))
    return
  }
  const names = backupFileNames(backup)
  if (!names.length) { toast(false, '备份里没有可恢复的题库文件'); return }
  if (!window.confirm(
    `将用备份覆盖服务端 ${names.length} 个题库文件：\n${names.join('、')}\n\n` +
    '这会替换当前全部题面且不可撤销，确认继续？'
  )) return
  bankBusy.value = true
  try {
    const r = await restoreBankBackup(backup)
    await bank.refreshAll()
    toast(true, `已恢复 ${r.restored.length} 个题库文件，题面已刷新`)
  } catch (err) {
    toast(false, err?.message || String(err))
  } finally {
    bankBusy.value = false
  }
}

/** 清空：第一次点只是亮出确认条，第二次才真的动手 */
async function reset() {
  if (!confirmReset.value) {
    confirmReset.value = true
    clearTimeout(reset._t)
    reset._t = setTimeout(() => (confirmReset.value = false), 8000)
    return
  }
  wiping.value = true
  try {
    const r = await st.wipeAll()
    toast(
      true,
      r.remote
        ? `已清空：本机数据 + 云端 ${r.remote} 条记录，可以从头开始了`
        : '已清空本机学习数据，可以从头开始了'
    )
  } catch (e) {
    toast(false, `清空失败：${e?.message || e}`)
  } finally {
    wiping.value = false
    confirmReset.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <div class="head">
      <div>
        <h1>学习进度</h1>
        <p class="sub">
          {{ user.logged ? `已登录 · ${user.name} · 数据云端同步` : '未登录 · 数据仅保存在本机浏览器' }}
        </p>
      </div>
      <RouterLink v-if="!user.logged" to="/login" class="btn btn-primary">登录以同步数据</RouterLink>
      <button v-else class="btn" @click="user.logout()">退出登录</button>
    </div>

    <div class="grid4">
      <div class="s card"><b>{{ stats.total }}</b><span>累计答题</span></div>
      <div class="s card"><b>{{ stats.accuracy }}%</b><span>总正确率</span></div>
      <div class="s card"><b>{{ stats.streak }}</b><span>连续天数</span></div>
      <div class="s card"><b>{{ stats.favCount }}</b><span>收藏题</span></div>
    </div>

    <section class="card panel">
      <div class="pn-h">
        <h3>近 14 天活跃度</h3>
        <span class="pn-note">按每日答题次数 · 峰值 {{ maxDay }} 次为满格</span>
      </div>
      <p class="pn-sub">
        柱子是<strong>每天的作答条数</strong>，不是练习时长；刷题、模考、错题本、收藏夹都计入，
        只读浏览、查看答案与跳过不计。柱高以这 14 天里最多的一天为满格做<strong>相对归一化</strong>，
        窗口逐日滚动时刻度会跟着重算。模考交卷按整卷题数一次计入。
      </p>
      <div class="bars">
        <div v-for="x in daily" :key="x.key" class="b" :class="{ zero: !x.n }" :title="`${x.label} · ${x.n} 次作答`">
          <span class="b-n">{{ x.n || '' }}</span>
          <i :style="{ height: x.n ? Math.max(4, (x.n / maxDay) * 58) + 'px' : '2px' }"></i>
          <em>{{ x.d.getDate() }}</em>
        </div>
      </div>
      <p class="pn-foot">14 天合计 {{ total14 }} 次作答 · 有练习 {{ activeDays }} 天 · 单日峰值 {{ maxDay }} 次</p>
    </section>

    <section class="card panel">
      <div class="pn-h">
        <h3>各级别掌握情况</h3>
        <span class="pn-note">整级完成度 = 全部题目掌握分的平均（按题数加权）</span>
      </div>
      <div class="lvs">
        <div v-for="l in byLevel" :key="l.slug" class="lv" :style="{ '--c': l.color }">
          <div class="lv-t">
            <span class="name">{{ l.en }} <em>{{ l.key }}</em></span>
            <span class="pct">
              完成度 <b>{{ l.aptitude }}%</b> · 已做 {{ l.seenPct }}% · 正确率 {{ l.accPct }}%
            </span>
          </div>
          <div class="pbar" :title="`Σs = ${l.sum.toFixed(2)} / ${2 * l.n} · ${l.n} 题 · ${l.secCount} 个小节`">
            <i :style="{ width: l.aptitude + '%' }"></i>
          </div>
          <div v-if="l.weak.length" class="weak">
            完成度较低的小节：
            <RouterLink
              v-for="w in l.weak" :key="w.code"
              :to="`/study?level=${l.slug}&set=${w.code}`" class="w"
              :title="`去刷题模式练 ${w.code}（当前完成度 ${w.aptitude}%）`"
            >
              {{ w.code }} <em>{{ w.aptitude }}%</em>
            </RouterLink>
          </div>
          <p v-else class="weak">还没有练习记录，去 <RouterLink to="/study">刷题模式</RouterLink> 开始吧。</p>
        </div>
      </div>
    </section>

    <section class="card panel" v-if="allExams.length">
      <div class="pn-h">
        <h3>模考记录</h3>
        <span class="pn-count">最近 {{ exams.length }} / 共 {{ allExams.length }} 场</span>
        <RouterLink to="/progress/exams" class="btn btn-sm more">更多 <span>→</span></RouterLink>
      </div>
      <ExamHistoryList :sessions="exams" />
      <p class="pn-foot">点击时间或级别可回看这场模考的完整成绩单与逐题解析。</p>
    </section>

    <section class="card panel">
      <h3>数据管理</h3>
      <p class="dm-hint">
        当前：{{ cnt.attempts }} 次作答 · {{ cnt.favs }} 条收藏 · {{ cnt.sessions }} 场模考 ·
        {{ cnt.cleared }} 条已标记掌握
        <template v-if="user.logged">（已登录，数据保存在云端）</template>
        <template v-else>（未登录，数据只在本机）</template>
      </p>

      <div class="dm">
        <button class="btn" @click="doExportBackup">导出完整备份 · JSON</button>
        <button class="btn" @click="doExportAttempts">答题流水 · CSV</button>
        <button class="btn" @click="doExportExams">模考记录 · CSV</button>
        <button class="btn" @click="fileInput?.click()">从备份恢复…</button>
        <input
          ref="fileInput" type="file" accept="application/json,.json" hidden @change="onPickFile"
        >
      </div>
      <p class="dm-note">
        备份 JSON 包含全部答题、收藏、模考记录，可原样导入恢复；CSV 供表格软件查看统计。
      </p>

      <div v-if="user.isAdmin" class="dm-bank">
        <div class="dm-bank-h">题库原文备份 · 管理员</div>
        <div class="dm">
          <button class="btn" :disabled="bankBusy" @click="doExportBank">导出题库备份 · JSON</button>
          <button class="btn" :disabled="bankBusy" @click="bankFileInput?.click()">从题库备份恢复…</button>
          <RouterLink class="btn" to="/bank/edit">编辑题库原文</RouterLink>
          <input
            ref="bankFileInput" type="file" accept="application/json,.json" hidden
            @change="onPickBankFile"
          >
        </div>
        <p class="dm-note">
          三个 q_*.json 与 meta.json 是本站唯一权威数据源，与早期 Excel 总表无关。
          导出文件包含全部题面，站点或数据库故障后可用「从题库备份恢复」一键重建；
          恢复会覆盖现有题库且不可撤销。
        </p>
      </div>

      <div class="dm-danger">
        <button class="btn btn-sm danger-btn" :disabled="wiping" @click="reset()">
          {{ wiping ? '清空中…' : confirmReset ? '确认清空，此操作不可撤销' : '清空学习数据，从头再来' }}
        </button>
        <span class="note">
          将删除{{ user.logged ? '本机与云端的' : '本机的' }}全部学习数据
          <template v-if="user.logged">（含云端 {{ cnt.attempts + cnt.favs + cnt.sessions }} 条记录）</template>
          。建议先导出一份备份。
        </span>
      </div>

      <p v-if="msgData" class="msg" :class="msgData.ok ? 'ok' : 'no'">{{ msgData.text }}</p>
    </section>
  </div>
</template>

<style scoped>
.wrap { max-width: 1000px; margin: 0 auto; padding: 24px 20px 60px; display: flex; flex-direction: column; gap: 18px; }
.head { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
h1 { font-size: 24px; }
.sub { color: var(--text-2); font-size: 13.5px; margin-top: 4px; }
.head .btn { margin-left: auto; }

.grid4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.s { padding: 16px 18px; text-align: center; }
.s b { display: block; font-size: 26px; font-family: var(--mono); color: var(--tech); }
.s span { font-size: 12.5px; color: var(--text-3); }

.panel { padding: 18px 20px; }
.panel h3 { font-size: 15px; margin: 0 0 14px; }
.pn-h { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.pn-h h3 { margin: 0; }
.pn-note { margin-left: auto; font-size: 12px; color: var(--text-3); }
.pn-count { margin-left: auto; font-size: 12px; color: var(--text-3); }
.more { flex: none; margin-left: 2px; }
.more span { font-family: var(--mono); }
.pn-sub { font-size: 12.5px; color: var(--text-3); line-height: 1.65; margin: 0 0 12px; }
.pn-sub strong { color: var(--text-2); font-weight: 600; }
.pn-foot { font-size: 12px; color: var(--text-3); margin: 10px 0 0; }

.bars { display: flex; align-items: flex-end; gap: 6px; height: 94px; }
.b { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 3px; }
.b i { width: 100%; max-width: 34px; border-radius: 4px 4px 0 0; background: var(--tech); display: block; transition: height .35s; }
.b.zero i { background: var(--line-2); }
.b-n { height: 13px; line-height: 13px; font-size: 10.5px; font-family: var(--mono); color: var(--text-2); }
.b em { font-style: normal; font-size: 11px; height: 14px; line-height: 14px; color: var(--text-3); }

.lvs { display: flex; flex-direction: column; gap: 16px; }
.lv-t { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 7px; }
.lv-t .name { font-size: 14.5px; font-weight: 600; }
.lv-t .name em { font-style: normal; font-size: 13px; color: var(--text-3); font-weight: 400; }
.lv-t .pct { margin-left: auto; font-size: 12.5px; color: var(--text-3); }
.lv-t .pct b { font-family: var(--mono); font-size: 14px; color: var(--text); }
.pbar { height: 6px; border-radius: 4px; background: var(--line); overflow: hidden; }
.pbar i { display: block; height: 100%; background: var(--c); transition: width .4s; }
.weak { margin-top: 8px; font-size: 12.5px; color: var(--text-3); }
.weak a:not(.w) { color: var(--tech); }
.w {
  display: inline-block; margin-left: 6px; padding: 2px 7px; border-radius: 6px;
  background: var(--err-soft); color: var(--err); font-family: var(--mono);
}
.w em { font-style: normal; opacity: .75; }

/* 数据管理 */
.dm-hint { font-size: 13px; color: var(--text-2); margin-bottom: 13px; }
.dm { display: flex; flex-wrap: wrap; gap: 9px; }
.dm-note { font-size: 12.5px; color: var(--text-3); margin-top: 10px; line-height: 1.6; }
.dm-bank {
  margin-top: 14px; padding-top: 14px;
  border-top: 1px dashed var(--line-2);
}
.dm-bank-h { font-size: 13px; font-weight: 600; color: var(--text-2); margin-bottom: 10px; }
.dm-danger {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--line-2);
}
.danger-btn { color: var(--err); border-color: var(--line-2); }
.danger-btn:hover { background: var(--err-soft); border-color: var(--err); }
.note { font-size: 12.5px; color: var(--text-3); line-height: 1.6; }
.msg { font-size: 13px; margin: 12px 0 0; }
.msg.ok { color: var(--ok); }
.msg.no { color: var(--err); }
</style>
