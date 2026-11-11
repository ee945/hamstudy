<script setup>
/**
 * 用户头像。三层降级：
 *   1. 上传的头像文件（users.avatar，PocketBase 内置字段）
 *   2. 内置预设（users.avatarPreset）
 *   3. 默认：昵称/邮箱首字母圆形图标
 */
import { computed } from 'vue'
import { pb } from '../lib/pb'
import { avatarSrc, avatarLabel } from '../lib/avatars'

const props = defineProps({
  user: { type: Object, default: null },
  size: { type: Number, default: 32 },
})

const initial = computed(() => {
  const u = props.user
  return u ? (u.nickname || u.email || 'U').charAt(0).toUpperCase() : '?'
})

const uploaded = computed(() => {
  const f = props.user?.avatar
  if (!f) return ''
  try {
    return pb.files.getUrl(props.user, f, { thumb: '96x96' })
  } catch {
    return ''
  }
})

const preset = computed(() => avatarSrc(props.user?.avatarPreset || ''))
const src = computed(() => uploaded.value || preset.value)
const alt = computed(() => (props.user?.avatarPreset ? avatarLabel(props.user.avatarPreset) : '头像'))
</script>

<template>
  <span
    class="ua"
    :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.44) + 'px' }"
  >
    <img v-if="src" :src="src" :alt="alt" :width="size" :height="size">
    <span v-else class="ua-init">{{ initial }}</span>
  </span>
</template>

<style scoped>
.ua {
  display: inline-grid; place-items: center;
  border-radius: 50%; overflow: hidden;
  background: var(--tech-soft); color: var(--tech);
  font-weight: 650; flex: none;
  border: 1px solid var(--line);
}
.ua img { display: block; border-radius: 50%; object-fit: cover; }
.ua-init { line-height: 1; }
</style>
