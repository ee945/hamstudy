import { createRouter, createWebHistory } from 'vue-router'
import { useUser } from '../stores/user'

const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { title: '首页' } },
  { path: '/l/:slug', name: 'level', component: () => import('../views/LevelView.vue') },
  { path: '/l/:slug/:sec', name: 'browse', component: () => import('../views/BrowseView.vue') },
  { path: '/study', name: 'study', component: () => import('../views/StudyView.vue'), meta: { title: '刷题模式' } },
  { path: '/exam', name: 'exam-setup', component: () => import('../views/ExamSetupView.vue'), meta: { title: '模拟考试' } },
  { path: '/exam/review/:id', name: 'exam-review', component: () => import('../views/ExamReviewView.vue'), meta: { title: '模考回顾' } },
  { path: '/exam/:slug', name: 'exam', component: () => import('../views/ExamView.vue'), meta: { title: '考试进行中' } },
  { path: '/search', name: 'search', component: () => import('../views/SearchView.vue'), meta: { title: '搜索' } },
  { path: '/wrong', name: 'wrong', component: () => import('../views/WrongView.vue'), meta: { title: '错题本' } },
  { path: '/fav', name: 'fav', component: () => import('../views/FavView.vue'), meta: { title: '收藏夹' } },
  { path: '/progress', name: 'progress', component: () => import('../views/ProgressView.vue'), meta: { title: '学习进度' } },
  { path: '/progress/exams', name: 'exam-history', component: () => import('../views/ExamHistoryView.vue'), meta: { title: '全部模考记录' } },
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { title: '登录' } },
  { path: '/account', name: 'account', component: () => import('../views/AccountView.vue'), meta: { title: '账户设置' } },
  { path: '/bank/edit', name: 'bank-edit', component: () => import('../views/BankEditView.vue'), meta: { title: '题库原文编辑' } },
  { path: '/edits', name: 'edits', component: () => import('../views/EditsView.vue'), meta: { title: '题库维护' } },
  { path: '/reviews', name: 'reviews', component: () => import('../views/ReviewsView.vue'), meta: { title: '待审修订' } },
  { path: '/edit-log', name: 'edit-log', component: () => import('../views/EditLogView.vue'), meta: { title: '修订日志' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach((to) => {
  const u = useUser()
  // 题库维护 / 待审修订只开放给管理员与编辑员。其他人直接输地址，
  // 就跟输 /xxx 这类无效地址一样回首页，而不是停在页面里给一句「无权限」。
  // 真正的拦截在服务端 API 规则上，这里只是让入口不暴露。
  if (to.path === '/edits' || to.path === '/reviews') {
    return u.canMaintain ? true : { path: '/', replace: true }
  }
  // 题库原文编辑直接落盘 q_*.json，只开放给管理员；编辑员仍走留痕的修订流
  if (to.path === '/bank/edit') {
    return u.isAdmin ? true : { path: '/', replace: true }
  }
  // 修订日志是贡献展示，登录即可看
  if (to.path === '/edit-log') {
    return u.logged ? true : { path: '/', replace: true }
  }
  return true
})

router.afterEach((to) => {
  const base = 'HamStudy · FCC 业余无线电题库'
  document.title = to.meta?.title ? `${to.meta.title} · ${base}` : base
})
