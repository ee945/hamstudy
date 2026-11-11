<script setup>
import { computed, onMounted } from 'vue'
import { useBank, slugOf } from '../stores/bank'
import { useStudy } from '../stores/study'

const bank = useBank()
const st = useStudy()

onMounted(() => bank.fetchMeta())

const stats = computed(() => st.stats)
const recent = computed(() =>
  [...st.attempts].sort((a, b) => b.ts - a.ts).slice(0, 6)
)

/** 今日是否练过 */
const todayCount = computed(() => {
  const key = new Date().toDateString()
  return st.attempts.filter((a) => new Date(a.ts).toDateString() === key).length
})
/**
 * 这条记录属于哪个级别，由题号首字母决定（T/G/E）。
 * 不能读 a.level —— 那字段是答题时才写进去的，历史上缺 level 的记录至今还在
 * 用户浏览器和云端躺着，读它就会把 G/E 的题误判到技术级，点开是空小节。
 */

function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return '刚刚'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  return Math.floor(s / 86400) + ' 天前'
}
</script>

<template>
  <div class="wrap">
    <!-- Hero -->
    <section class="hero card">
      <div class="hero-bg"></div>
      <div class="hero-in">
        <div class="hero-t">
          <h1>FCC 业余无线电执照题库</h1>
          <p class="sub">技术级 · 通用级 · 业余特级 共 {{ bank.totalCount }} 题中英双语精校，含 {{ 44 }} 张电路图</p>
        </div>
        <div class="quick">
          <div class="qs"><b>{{ todayCount }}</b><span>今日练习</span></div>
          <div class="qs"><b>{{ stats.streak }}</b><span>连续天数</span></div>
          <div class="qs"><b>{{ stats.accuracy }}%</b><span>正确率</span></div>
          <div class="qs"><b>{{ stats.wrongCount }}</b><span>错题</span></div>
        </div>
      </div>
    </section>

    <!-- 级别卡片 -->
    <section>
      <h2 class="sec-t">选择执照等级 <span class="sec-hint">各级进入浏览模式：默认显示正确答案，仅供阅读学习；计分练习请用顶部「刷题模式」</span></h2>
      <div class="levels">
        <RouterLink
          v-for="l in bank.levels" :key="l.slug"
          :to="`/l/${l.slug}`" class="lv card"
          :style="{ '--c': l.color }"
        >
          <div class="lv-top">
            <span class="lv-tag" :style="{ background: l.color + '18', color: l.color }">{{ l.tag }}</span>
            <span class="lv-period">{{ l.period }}</span>
          </div>
          <h3>{{ l.en }}</h3>
          <p class="lv-zh">
            {{ l.key }}
            <span class="lv-n">{{ l.count }} 题</span>
          </p>
          <p class="lv-desc">{{ l.desc }}</p>

          <div class="lv-meta">
            <span><b>{{ l.blocks.length }}</b> 子单元</span>
            <span><b>{{ l.blocks.reduce((n, b) => n + b.secs.length, 0) }}</b> 小节</span>
            <span><b>{{ l.imgCount }}</b> 配图</span>
            <span>难度 <b>{{ l.avgDiff }}</b></span>
          </div>

          <div class="lv-act">
            <span class="go">浏览题目 →</span>
            <span class="exam-hint">考试 {{ l.exam.questions }} 题 · 答对 {{ l.exam.pass }}</span>
          </div>
        </RouterLink>
      </div>
    </section>

    <!-- 继续学习 -->
    <section v-if="recent.length">
      <h2 class="sec-t">最近练习</h2>
      <div class="recent card">
        <RouterLink
          v-for="a in recent" :key="a.id"
          :to="`/l/${slugOf(a.qid)}/${a.sec}#${a.qid}`"
          class="rec"
        >
          <span class="rid">#{{ a.qid }}</span>
          <span class="rsec">{{ a.sec }}</span>
          <span class="rok" :class="a.ok ? 'y' : 'n'">{{ a.ok ? '正确' : '错误' }}</span>
          <span class="rtime">{{ timeAgo(a.ts) }}</span>
        </RouterLink>
      </div>
    </section>

    <!-- 考试说明 -->
    <section class="tips card">
      <h3>关于 FCC 业余无线电考试</h3>
      <ul>
        <li><b>技术级 Technician</b>：35 题，答对 26 题（74%）合格，是无线电入门第一步。</li>
        <li><b>通用级 General</b>：35 题，答对 26 题合格，解锁绝大部分 HF 短波频段。</li>
        <li><b>业余特级 Amateur Extra</b>：50 题，答对 37 题合格，解锁全部业余频率。</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.wrap { max-width: 1160px; margin: 0 auto; padding: 26px 20px 50px; display: flex; flex-direction: column; gap: 30px; }

.hero { position: relative; overflow: hidden; padding: 30px 30px 26px; background: linear-gradient(120deg, #ffffff 0%, #f2fbf6 62%, #eaf6ff 100%); }
.hero-bg {
  position: absolute; right: -60px; top: -70px; width: 320px; height: 320px; opacity: .5;
  background-image: radial-gradient(circle at center, var(--tech-soft) 0, transparent 70%);
}
.hero-in { position: relative; display: flex; gap: 24px; align-items: flex-end; flex-wrap: wrap; }
.hero-t { flex: 1; min-width: 260px; }
.hero h1 { font-size: 27px; letter-spacing: -.025em; }
.sub { color: var(--text-2); margin-top: 7px; font-size: 14.5px; }

.quick { display: flex; gap: 22px; }
.qs { text-align: center; }
.qs b { display: block; font-size: 21px; font-family: var(--mono); color: var(--tech); line-height: 1.2; }
.qs span { font-size: 12px; color: var(--text-3); }

.sec-t { font-size: 15px; color: var(--text-2); font-weight: 600; margin-bottom: 12px; letter-spacing: .01em; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.sec-hint { font-size: 12.5px; font-weight: 400; color: var(--text-3); }

.levels { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
.lv {
  padding: 20px 22px 18px; display: flex; flex-direction: column;
  border-top: 3px solid var(--c); transition: .18s ease;
}
.lv:hover { transform: translateY(-2px); box-shadow: var(--sh-3); border-color: var(--c); }
.lv-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.lv-tag { padding: 2px 9px; border-radius: 6px; font-size: 12px; font-weight: 600; }
.lv-period { font-size: 12px; color: var(--text-3); font-family: var(--mono); }
.lv h3 { font-size: 20px; letter-spacing: -.02em; }
.lv-zh { display: flex; align-items: baseline; gap: 9px; margin-top: 2px; color: var(--text-2); font-size: 14.5px; }
.lv-n { font-family: var(--mono); color: var(--c); font-weight: 600; }
.lv-desc { margin-top: 10px; font-size: 13.5px; color: var(--text-2); line-height: 1.65; flex: 1; }

.lv-meta {
  display: flex; gap: 14px; flex-wrap: wrap;
  margin: 14px 0 13px; padding: 10px 0;
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  font-size: 12.5px; color: var(--text-3);
}
.lv-meta b { color: var(--text); font-family: var(--mono); }

.lv-act { display: flex; align-items: center; justify-content: space-between; }
.go { font-size: 14px; font-weight: 600; color: var(--c); }
.exam-hint { font-size: 12px; color: var(--text-3); }

.recent { padding: 8px 10px; }
.rec {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 12px; border-radius: 9px; font-size: 14px;
}
.rec:hover { background: var(--surface-sunken); }
.rid { font-family: var(--mono); font-size: 13px; color: var(--text-2); width: 70px; }
.rsec { color: var(--text-3); font-size: 13px; }
.rok { margin-left: auto; font-size: 12.5px; padding: 2px 8px; border-radius: 6px; }
.rok.y { background: var(--ok-soft); color: var(--ok); }
.rok.n { background: var(--err-soft); color: var(--err); }
.rtime { font-size: 12px; color: var(--text-3); width: 72px; text-align: right; }

.tips { padding: 20px 24px; }
.tips h3 { margin-bottom: 9px; }
.tips ul { margin: 0; padding-left: 18px; color: var(--text-2); font-size: 14px; line-height: 1.85; }
.tips b { color: var(--text); }

@media (max-width: 620px) {
  .wrap { padding: 18px 14px 40px; gap: 22px; }
  .hero { padding: 22px 20px; }
  .quick { gap: 16px; }
}
</style>
