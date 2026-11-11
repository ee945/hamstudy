<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUser } from '../stores/user'
import { normalizeCallsign, callsignProblem } from '../lib/callsign'

const router = useRouter()
const user = useUser()

const tab = ref('login')
const email = ref('')
const pwd = ref('')
const pwd2 = ref('')
const nick = ref('')
const call = ref('')
const health = ref(null)   // null=检查中 true=可用 false=不可用

onMounted(async () => {
  try {
    const r = await fetch('/pb/api/health')
    health.value = r.ok
  } catch {
    health.value = false
  }
})

async function submit() {
  if (tab.value === 'login') {
    if (await user.login(email.value, pwd.value)) router.push('/progress')
  } else {
    if (pwd.value !== pwd2.value) { user.error = '两次输入的密码不一致'; return }
    if (pwd.value.length < 8) { user.error = '密码至少 8 位'; return }
    const cp = callsignProblem(call.value)
    if (cp) { user.error = cp; return }
    if (await user.register(email.value, pwd.value, nick.value, normalizeCallsign(call.value))) router.push('/progress')
  }
}
</script>

<template>
  <div class="wrap">
    <div class="box card">
      <div class="logo">
        <svg width="34" height="34" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="2.6" fill="currentColor"/>
          <circle cx="16" cy="16" r="7.4" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/>
          <circle cx="16" cy="16" r="12.6" fill="none" stroke="currentColor" stroke-width="2" opacity=".28"/>
        </svg>
      </div>
      <h1>{{ tab === 'login' ? '登录 HamStudy' : '注册新账号' }}</h1>
      <p class="sub">登录后你的刷题进度、错题本与收藏夹将保存在云端，可跨设备同步。</p>

      <div v-if="health === false" class="alert">
        后端服务未启动。请先在站点根目录运行 <code>npm run pb</code> 启动 PocketBase 后重试。
      </div>

      <div class="tabs">
        <button :class="{ on: tab === 'login' }" @click="tab = 'login'; user.error = ''">登录</button>
        <button :class="{ on: tab === 'register' }" @click="tab = 'register'; user.error = ''">注册</button>
      </div>

      <form @submit.prevent="submit">
        <label>邮箱<input v-model="email" type="email" required placeholder="you@example.com" autocomplete="email"></label>
        <label v-if="tab === 'register'">昵称<input v-model="nick" placeholder="选填，默认取邮箱前缀"></label>
        <label v-if="tab === 'register'">
          呼号
          <input
            v-model="call" class="cs-in" placeholder="选填，例如 BA4ABC" maxlength="16" spellcheck="false"
          >
        </label>
        <label>密码
          <input v-model="pwd" type="password" required placeholder="至少 8 位"
                 :autocomplete="tab === 'login' ? 'current-password' : 'new-password'">
        </label>
        <label v-if="tab === 'register'">确认密码<input v-model="pwd2" type="password" required></label>

        <p v-if="user.error" class="err">{{ user.error }}</p>

        <button class="btn btn-primary go" type="submit" :disabled="user.loading || health === false">
          {{ user.loading ? '处理中…' : tab === 'login' ? '登录' : '注册并登录' }}
        </button>
      </form>

      <p class="foot">
        不登录也能正常使用全部学习功能，数据先存在本机；登录后会自动并入你的账号并同步到云端。
      </p>
    </div>
  </div>
</template>

<style scoped>
.wrap { max-width: 420px; margin: 0 auto; padding: 40px 20px 70px; }
.box { padding: 30px 30px 26px; text-align: center; }
.logo { color: var(--tech); display: grid; place-items: center; margin-bottom: 12px; }
h1 { font-size: 22px; }
.sub { color: var(--text-2); font-size: 13.5px; margin-top: 7px; line-height: 1.6; }

.alert {
  margin-top: 14px; padding: 10px 13px; border-radius: 10px;
  background: var(--err-soft); color: var(--err); font-size: 13px; text-align: left;
}
.alert code {
  font-family: var(--mono); background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px;
}

.tabs { display: flex; gap: 4px; margin: 20px 0 16px; background: var(--surface-sunken); padding: 3px; border-radius: 10px; }
.tabs button { flex: 1; height: 32px; border-radius: 8px; font-size: 14px; color: var(--text-2); }
.tabs button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--sh-1); }

form { display: flex; flex-direction: column; gap: 11px; text-align: left; }
label { font-size: 13px; color: var(--text-2); display: flex; flex-direction: column; gap: 5px; }
label input {
  height: 38px; padding: 0 12px; border-radius: 9px;
  border: 1px solid var(--line-2); background: var(--surface); outline: none;
}
label input:focus { border-color: var(--gen); box-shadow: var(--ring); }

/* 呼号：等宽大写 */
.cs-in { font-family: var(--mono); letter-spacing: .04em; text-transform: uppercase; }

.err { color: var(--err); font-size: 13px; margin: 0; }
.go { width: 100%; height: 38px; margin-top: 4px; }
.foot { font-size: 12.5px; color: var(--text-3); margin-top: 14px; line-height: 1.6; }
</style>
