<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUser } from '../stores/user'
import { AVATARS, avatarSrc } from '../lib/avatars'
import { normalizeCallsign, callsignProblem } from '../lib/callsign'
import UserAvatar from '../components/UserAvatar.vue'

const router = useRouter()
const user = useUser()

const MIN_PWD = 8

// 昵称
const nick = ref('')
// 呼号
const call = ref('')
// 头像预设
const preset = ref('')
// 密码
const oldPwd = ref('')
const newPwd = ref('')
const newPwd2 = ref('')

// 各段独立的反馈，避免互串
const msgProfile = ref(null)   // { ok, text }
const msgPwd = ref(null)
const msgCall = ref(null)

const callProblem = computed(() => callsignProblem(call.value))

watch(
  () => user.user?.id,
  () => {
    nick.value = user.user?.nickname || ''
    call.value = user.user?.callsign || ''
    preset.value = user.user?.avatarPreset || ''
    msgProfile.value = null
    msgPwd.value = null
    msgCall.value = null
  },
  { immediate: true }
)

const pwdProblem = computed(() => {
  if (!oldPwd.value || !newPwd.value) return '请填写当前密码与新密码'
  if (newPwd.value.length < MIN_PWD) return `新密码至少 ${MIN_PWD} 位`
  if (newPwd.value !== newPwd2.value) return '两次输入的新密码不一致'
  if (newPwd.value === oldPwd.value) return '新密码不能与当前密码相同'
  return ''
})

async function saveProfile() {
  msgProfile.value = null
  const ok = await user.updateProfile({ nickname: nick.value.trim(), avatarPreset: preset.value })
  msgProfile.value = { ok, text: ok ? '已保存' : user.error || '保存失败' }
}

async function saveCallsign() {
  msgCall.value = null
  if (callProblem.value) {
    msgCall.value = { ok: false, text: callProblem.value }
    return
  }
  const ok = await user.updateProfile({
    nickname: nick.value.trim(),
    avatarPreset: preset.value,
    callsign: normalizeCallsign(call.value),
  })
  msgCall.value = { ok, text: ok ? '呼号已保存' : user.error || '保存失败' }
  if (ok) call.value = user.callsign
}

async function submitPwd() {
  msgPwd.value = null
  if (pwdProblem.value) {
    msgPwd.value = { ok: false, text: pwdProblem.value }
    return
  }
  const ok = await user.changePassword(oldPwd.value, newPwd.value)
  msgPwd.value = { ok, text: ok ? '密码已更新，已用新密码保持登录' : user.error || '修改失败' }
  if (ok) {
    oldPwd.value = newPwd.value = newPwd2.value = ''
  }
}
</script>

<template>
  <div class="wrap">
    <div v-if="!user.logged" class="card empty">
      <h1>账户设置</h1>
      <p>{{ user.sessionLost ? '登录状态已失效，请重新登录后再修改资料。' : '登录后才能修改头像、昵称与密码。' }}</p>
      <button class="btn btn-primary" @click="router.push('/login')">去登录</button>
    </div>

    <template v-else>
      <h1>账户设置</h1>

      <!-- 头像 -->
      <section class="card">
        <h2>头像</h2>
        <p class="hint">点击即可切换，立即生效。不想用图片就选「默认」，回到首字母图标。</p>

        <div class="cur">
          <UserAvatar :user="user.user" :size="64" />
          <div class="cur-t">
            <b>{{ user.name }}<span v-if="user.callsign" class="cs">{{ user.callsign }}</span></b>
            <span>{{ user.user.email }}</span>
          </div>
        </div>

        <div class="grid">
          <button
            v-for="a in AVATARS" :key="a.key || '__default__'"
            class="opt" :class="{ on: preset === a.key }"
            :title="a.label" @click="preset = a.key; saveProfile()"
          >
            <span class="thumb">
              <img v-if="avatarSrc(a.key)" :src="avatarSrc(a.key)" :alt="a.label" width="44" height="44">
              <span v-else class="letter">{{ (user.user.nickname || user.user.email || 'U').charAt(0).toUpperCase() }}</span>
            </span>
            <span class="lb">{{ a.label }}</span>
          </button>
        </div>
      </section>

      <!-- 昵称 -->
      <section class="card">
        <h2>昵称</h2>
        <p class="hint">显示在头像菜单里。很多台友直接用呼号，方便互相认出来。</p>
        <div class="row">
          <input v-model="nick" placeholder="例如 老王" maxlength="24" @keyup.enter="saveProfile">
          <button class="btn btn-primary" :disabled="user.loading" @click="saveProfile">保存</button>
        </div>
        <p v-if="msgProfile" class="msg" :class="msgProfile.ok ? 'ok' : 'no'">{{ msgProfile.text }}</p>
      </section>

      <!-- 呼号 -->
      <section class="card">
        <h2>呼号</h2>
        <p class="hint">
          业余电台呼号，例如 BA4ABC；临时设台可加后缀，如 BA4ABC/P。
          填写后会显示在头像菜单和你的资料里，方便台友认人。留空即不显示。
        </p>
        <div class="row">
          <input
            v-model="call" class="cs-in" placeholder="例如 BA4ABC" maxlength="16"
            spellcheck="false" @keyup.enter="saveCallsign"
          >
          <button class="btn btn-primary" :disabled="user.loading" @click="saveCallsign">保存</button>
          <button v-if="user.callsign" class="btn btn-ghost" @click="call = ''; saveCallsign()">清除</button>
        </div>
        <p v-if="callProblem" class="warn">{{ callProblem }}</p>
        <p v-if="msgCall" class="msg" :class="msgCall.ok ? 'ok' : 'no'">{{ msgCall.text }}</p>
      </section>

      <!-- 密码 -->
      <section class="card">
        <h2>修改密码</h2>
        <p class="hint">需要验证当前密码。改完后会自动用新密码重新登录，不会被踢下线。</p>
        <form @submit.prevent="submitPwd">
          <label>当前密码
            <input v-model="oldPwd" type="password" autocomplete="current-password" placeholder="输入现在的密码">
          </label>
          <div class="two">
            <label>新密码
              <input v-model="newPwd" type="password" autocomplete="new-password" :placeholder="`至少 ${MIN_PWD} 位`">
            </label>
            <label>确认新密码
              <input v-model="newPwd2" type="password" autocomplete="new-password" placeholder="再输入一次">
            </label>
          </div>
          <div class="row">
            <button class="btn btn-primary" type="submit" :disabled="user.loading || !!pwdProblem">
              {{ user.loading ? '处理中…' : '修改密码' }}
            </button>
            <span v-if="pwdProblem && (newPwd || oldPwd)" class="warn">{{ pwdProblem }}</span>
          </div>
          <p v-if="msgPwd" class="msg" :class="msgPwd.ok ? 'ok' : 'no'">{{ msgPwd.text }}</p>
        </form>
      </section>

      <section class="card dim-card">
        <h2>邮箱</h2>
        <p class="hint">{{ user.user.email }}</p>
        <p class="hint">
          暂不支持自助修改：更换邮箱需要向新地址发送确认邮件，而本站还没有配置 SMTP。
          真要改，让管理员在后台直接改。
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.wrap { max-width: 760px; margin: 0 auto; padding: 28px 20px 70px; }
h1 { font-size: 22px; margin-bottom: 18px; }
section { padding: 22px 24px; margin-bottom: 16px; }
h2 { font-size: 15px; margin-bottom: 6px; }
.hint { font-size: 13px; color: var(--text-2); line-height: 1.65; }
.dim-card { background: var(--surface-2); }

.empty { padding: 40px; text-align: center; }
.empty h1 { margin-bottom: 8px; }
.empty p { color: var(--text-2); margin-bottom: 16px; }

.cur { display: flex; align-items: center; gap: 14px; margin: 14px 0 16px; }
.cur-t { display: flex; flex-direction: column; gap: 2px; }
.cur-t b { font-size: 15px; display: flex; align-items: center; gap: 8px; }
.cur-t span { font-size: 13px; color: var(--text-3); }
/* 呼号：等宽 + 字距，一眼像电台标识 */
.cs {
  font-family: var(--mono); font-size: 12.5px; font-weight: 600; letter-spacing: .04em;
  padding: 2px 8px; border-radius: 6px;
  background: var(--tech-soft); color: var(--tech);
}
.cs-in { font-family: var(--mono); letter-spacing: .04em; text-transform: uppercase; }

/* 列数按断点写死，不随容器宽度浮动。
   24 格（23 张内置头像 + 默认）是 3/4/6/8 的最小公倍数，固定成这四种列数后
   每一排都刚好铺满，最后一排不会被 1fr 拉宽。若用 auto-fill，
   中等宽度会冒出 5 列、7 列，那两种列数除不尽，末尾就会参差。 */
.grid { display: grid; gap: 8px; grid-template-columns: repeat(8, 1fr); }
@media (max-width: 759px) { .grid { grid-template-columns: repeat(6, 1fr); } }
@media (max-width: 559px) { .grid { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 399px) { .grid { grid-template-columns: repeat(3, 1fr); } }
.opt {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 8px 4px; border-radius: 10px; border: 1.5px solid transparent;
  background: none; cursor: pointer;
}
.opt:hover { background: var(--surface-sunken); }
.opt.on { border-color: var(--gen); background: var(--gen-soft); }
.thumb {
  width: 44px; height: 44px; border-radius: 50%;
  display: grid; place-items: center; overflow: hidden;
  background: var(--tech-soft); color: var(--tech); font-weight: 650;
}
.thumb img { display: block; }
.letter { font-size: 18px; }
.lb { font-size: 11.5px; color: var(--text-2); text-align: center; line-height: 1.3; }
.opt.on .lb { color: var(--gen); font-weight: 600; }

.row { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.row input { flex: 1; min-width: 200px; }
input {
  height: 38px; padding: 0 12px; border-radius: 9px;
  border: 1px solid var(--line-2); background: var(--surface); outline: none; font-size: 14px;
}
input:focus { border-color: var(--gen); box-shadow: var(--ring); }

form { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
label { font-size: 13px; color: var(--text-2); display: flex; flex-direction: column; gap: 5px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 560px) { .two { grid-template-columns: 1fr; } }

.msg { font-size: 13px; margin: 10px 0 0; }
.msg.ok { color: var(--ok); }
.msg.no { color: var(--err); }
.warn { font-size: 13px; color: var(--warn); }
</style>
