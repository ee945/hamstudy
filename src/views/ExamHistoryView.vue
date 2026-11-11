<script setup>
/** 完整模考记录页：进度页标题右侧「更多」进来，列出本账号的全部场次。 */
import { computed } from 'vue'
import { useStudy } from '../stores/study'
import ExamHistoryList from '../components/ExamHistoryList.vue'

const st = useStudy()
const exams = computed(() => [...st.sessions].sort((a, b) => b.ts - a.ts))
</script>

<template>
  <div class="wrap">
    <div class="crumb">
      <RouterLink to="/progress">学习进度</RouterLink><span class="sep">/</span><span>全部模考记录</span>
    </div>
    <header class="head">
      <div>
        <h1>全部模考记录</h1>
        <p class="sub">共 {{ exams.length }} 场 · 按时间倒序 · 点击时间或级别可回看完整成绩单与逐题解析</p>
      </div>
      <RouterLink to="/progress" class="btn">返回学习进度</RouterLink>
    </header>

    <section class="card panel">
      <ExamHistoryList v-if="exams.length" :sessions="exams" />
      <p v-else class="empty">还没有模考记录。先去 <RouterLink to="/exam">模拟考试</RouterLink> 练一套吧。</p>
    </section>
  </div>
</template>

<style scoped>
.wrap { max-width: 1000px; margin: 0 auto; padding: 24px 20px 60px; }
.crumb { font-size: 13px; color: var(--text-3); margin-bottom: 16px; }
.crumb a { color: var(--text-2); }
.crumb a:hover { color: var(--tech); }
.sep { margin: 0 8px; opacity: .55; }
.head { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
h1 { font-size: 24px; }
.sub { color: var(--text-2); font-size: 13.5px; margin-top: 4px; }
.head .btn { margin-left: auto; }
.panel { padding: 18px 20px; }
.empty { font-size: 13.5px; color: var(--text-3); padding: 22px 0; text-align: center; }
.empty a { color: var(--tech); }
</style>
