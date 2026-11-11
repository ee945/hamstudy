/** 呼号（Callsign）的规范化与校验。
 * 业余电台呼号形如 BA4ABC、BD1XYZ，操作地点后缀可带斜杠：BA4ABC/P。
 */

/** 去掉空白并统一大写 */
export function normalizeCallsign(v) {
  return String(v || '').replace(/\s+/g, '').toUpperCase()
}

/** 返回问题描述，合法或留空时返回空串 */
export function callsignProblem(v) {
  const s = normalizeCallsign(v)
  if (!s) return ''
  if (s.length > 16) return '呼号最多 16 位'
  if (!/^[A-Z0-9]+(\/[A-Z0-9]+)*$/.test(s)) return '呼号只能包含字母、数字和斜杠，例如 BA4ABC'
  return ''
}
