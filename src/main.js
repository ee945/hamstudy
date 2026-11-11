import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './styles/theme.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// 依赖 store 的初始化（顺序敏感：user -> study）
import { useUI } from './stores/ui'
import { useUser } from './stores/user'
import { useStudy } from './stores/study'
import { useDrill } from './stores/drill'
import { useBank } from './stores/bank'
import { useEdits } from './stores/edits'

const ui = useUI()
ui.load()

const user = useUser()
user.init()

useStudy().hydrate(user.user?.id || null)
useDrill().hydrate(user.user?.id || null)
useBank().fetchMeta()
// 尽早发出：题库页面往往先渲染完，晚起步会让原文先闪一帧
useEdits().load()

app.use(router)
app.mount('#app')
