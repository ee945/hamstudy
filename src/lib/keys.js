/**
 * 全局快捷键工具。
 *
 * 两条约定：
 *  1. 所有快捷键在「正在输入」时让路——光标位于 input / textarea / select /
 *     contenteditable 时不拦截，否则回车无法提交搜索框与登录表单。
 *  2. 组合键（Ctrl / Cmd / Alt）一律放行，避免劫持浏览器原生快捷键。
 */

/** 当前焦点是否处于可编辑元素内 */
export function isTyping(el) {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable === true
}

/**
 * 焦点所在元素是否「已经用掉了回车」。
 * 按钮 / 链接 / details 摘要有浏览器原生语义（回车 = 触发点击），
 * 若也劫持会挡住纯键盘用户的操作，因此让路。
 */
export function enterIsNative(el) {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true
  return el.getAttribute && el.getAttribute('role') === 'button'
}

/** 是否应当让该次按键走原生行为 */
export function shouldIgnore(e) {
  return e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)
}

/**
 * 识别数字键 1-4，返回下标 0-3；不是则返回 -1。
 *
 * 优先看 e.key，但它有两种失效场景，故用物理键位 e.code 兜底：
 *   1. 小键盘 NumLock 关闭时产出的是 End / PageDown / Home 等功能键名
 *   2. 非 US 布局（如 AZERTY）顶排数字键不按 Shift 时产出的是 & é " 等符号
 * 用 e.code 判定物理位置则不受布局与 NumLock 状态影响，
 * 且 Numpad1-4 只可能来自小键盘，不会误伤笔记本上的 End / 方向键。
 */
export function digitIndex(e) {
  const byKey = ['1', '2', '3', '4'].indexOf(e.key)
  if (byKey >= 0) return byKey
  const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code || '')
  return m ? Number(m[1]) - 1 : -1
}

/**
 * 挂载一个 document 级按键监听，返回卸载函数。
 * @param {(e: KeyboardEvent) => void} fn
 */
export function onKey(fn) {
  const h = (e) => { if (!shouldIgnore(e)) fn(e) }
  document.addEventListener('keydown', h)
  return () => document.removeEventListener('keydown', h)
}
