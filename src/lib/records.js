import { pb } from './pb'

const NS = 'hamstudy:v1'
/** @param {string|null} uid 用户 id；null 表示未登录 */
export const lsKey = (uid) => (uid ? `${NS}:${uid}` : `${NS}:guest`)

export const EMPTY = { attempts: [], favs: [], sessions: [], cleared: [] }

/** 记录 id。
 * 必须与 PocketBase 的 id 规则一致（15 位小写字母数字），
 * 这样本地 id 能原样写进云端，同步回来时才能按 id 认出是同一条，
 * 否则每刷新一次页面数据就会翻一倍。
 */
export function newId() {
  const A = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const buf = new Uint8Array(15)
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(buf)
  else for (let i = 0; i < 15; i++) buf[i] = Math.floor(Math.random() * 256)
  let s = ''
  for (const b of buf) s += A[b % 36]
  return s
}

/** 是否可以直接当作 PocketBase 的 id 上传 */
const isPbId = (id) => /^[a-z0-9]{15}$/.test(String(id || ''))

/* ---------------- 本地存取 ---------------- */

export function loadLocal(uid) {
  try {
    const raw = localStorage.getItem(lsKey(uid))
    if (!raw) return { ...EMPTY }
    const d = JSON.parse(raw)
    return { ...EMPTY, ...d }
  } catch {
    return { ...EMPTY }
  }
}

export function saveLocal(uid, data) {
  try {
    localStorage.setItem(lsKey(uid), JSON.stringify(data))
  } catch (e) {
    console.warn('[records] 本地写入失败', e)
  }
}

/** 读取未登录时攒下的进度；没有内容返回 null */
export function loadGuest() {
  try {
    const raw = localStorage.getItem(lsKey(null))
    if (!raw) return null
    const d = JSON.parse(raw)
    const n =
      (d?.attempts?.length || 0) + (d?.favs?.length || 0) +
      (d?.sessions?.length || 0) + (d?.cleared?.length || 0)
    return n ? { ...EMPTY, ...d } : null
  } catch {
    return null
  }
}

/** 游客进度已并入账号后清掉副本，避免下次重复合并 */
export function clearGuest() {
  try {
    localStorage.removeItem(lsKey(null))
  } catch (e) {
    console.warn('[records] 清除游客数据失败', e)
  }
}

/** 删除云端该用户的全部学习记录，返回删除条数 */
export async function wipeRemote(uid) {
  let n = 0
  for (const name of ['hs_attempts', 'hs_favorites', 'hs_sessions']) {
    try {
      const c = await col(name)
      let list = []
      try {
        list = await c.getFullList({ filter: `user="${uid}"`, fields: 'id' })
      } catch {
        // 过滤字段不被支持时退回默认查询
        list = await c.getFullList({ filter: `user="${uid}"` })
      }
      for (const it of list) {
        await c.delete(it.id)
        n++
      }
    } catch (e) {
      console.warn(`[records] 清空 ${name} 失败`, e?.message)
    }
  }
  return n
}

/* ---------------- 远端同步 ---------------- */

async function col(name) {
  return pb.collection(name)
}

/** 拉取云端记录，按 id 与本地合并 */
export async function pullRemote(uid) {
  const out = { attempts: [], favs: [], sessions: [], cleared: [] }
  const grab = async (name, map) => {
    try {
      const list = await (await col(name)).getFullList({ filter: `user="${uid}"` })
      out[map] = list.map((r) => ({
        id: r.id,
        qid: r.qid,
        level: r.level,
        sec: r.sec,
        ok: !!r.ok,
        mode: r.mode || 'browse',
        ts: r.created ? Date.parse(r.created) : Date.now(),
        detail: r.detail || null,
        total: r.total || 0,
        correct: r.correct || 0,
        durationSec: r.durationSec || 0,
        _synced: true,   // 来自云端，不必再推一次
      }))
    } catch (e) {
      console.warn(`[records] 拉取 ${name} 失败`, e?.message)
    }
  }
  await grab('hs_attempts', 'attempts')
  await grab('hs_favorites', 'favs')
  await grab('hs_sessions', 'sessions')
  return out
}

/** 内容指纹：老记录用的是 UUID 式 id，写不进云端，只能靠内容认亲 */
const fpAttempt = (r) => `${r.qid}|${r.ts}|${r.ok ? 1 : 0}|${r.mode || ''}`
const fpSession = (r) => `${r.level}|${r.ts}|${r.total}|${r.correct}`

/** 合并：以 id 去重，取 ts 较新者；cleared/favs 以 qid 去重。
 * 再按内容指纹兜底去重一次：同一件事在云端和本地各留一条时只保留一条，
 * 优先保留已在云端的那条，避免又被当成新数据推上去。 */
export function merge(local, remote) {
  const byId = (arr) => {
    const m = new Map()
    for (const r of arr) {
      const old = m.get(r.id)
      if (!old || (r.ts || 0) >= (old.ts || 0)) m.set(r.id, r)
    }
    return [...m.values()]
  }
  const byQid = (arr) => {
    const m = new Map()
    for (const r of arr) {
      const old = m.get(r.qid)
      if (!old || (r.ts || 0) >= (old.ts || 0)) m.set(r.qid, r)
    }
    return [...m.values()]
  }
  /** 指纹去重：优先保留 _synced 的那条（已在云端），否则保留先出现的 */
  const byFp = (arr, fp) => {
    const m = new Map()
    for (const r of arr) {
      const k = fp(r)
      const old = m.get(k)
      if (!old) { m.set(k, r); continue }
      if (r._synced && !old._synced) m.set(k, r)
    }
    return [...m.values()]
  }

  return {
    attempts: byFp(byId([...local.attempts, ...remote.attempts]), fpAttempt),
    favs: byQid([...local.favs, ...remote.favs]),
    sessions: byFp(byId([...local.sessions, ...remote.sessions]), fpSession),
    cleared: [...new Set([...local.cleared, ...remote.cleared])],
  }
}

/** 增量推送：把本地缺少 uid 标记的记录写入云端 */
export async function pushNew(uid, data) {
  const queue = []
  const c = (n) => col(n)

  const unsynced = (arr) => arr.filter((r) => !r._synced)
  /** 记录已存在（id 撞车）时不必反复重试 */
  const onDup = (r) => (e) => {
    if (e?.data?.data?.id || /unique/i.test(String(e?.message))) r._synced = true
    else console.warn('[sync] 推送失败', e?.message)
  }
  try {
    for (const r of unsynced(data.attempts)) {
      const body = { user: uid, qid: r.qid, level: r.level, sec: r.sec, ok: r.ok, mode: r.mode }
      if (isPbId(r.id)) body.id = r.id
      queue.push(
        (await c('hs_attempts'))
          .create(body)
          .then(() => (r._synced = true))
          .catch(onDup(r))
      )
    }
    for (const r of unsynced(data.favs)) {
      const body = { user: uid, qid: r.qid, level: r.level, sec: r.sec }
      if (isPbId(r.id)) body.id = r.id
      queue.push(
        (await c('hs_favorites'))
          .create(body)
          .then(() => (r._synced = true))
          .catch(onDup(r))
      )
    }
    for (const r of unsynced(data.sessions)) {
      const body = {
        user: uid, level: r.level, total: r.total, correct: r.correct,
        durationSec: r.durationSec, mode: r.mode, detail: r.detail,
      }
      if (isPbId(r.id)) body.id = r.id
      queue.push(
        (await c('hs_sessions'))
          .create(body)
          .then(() => (r._synced = true))
          .catch(onDup(r))
      )
    }
  } catch (e) {
    console.warn('[sync] 推送异常', e?.message)
  }
  await Promise.allSettled(queue)
  return data
}

/** 删除云端收藏 */
export async function removeFavRemote(uid, qid) {
  try {
    const list = await (await col('hs_favorites')).getList(1, 1, {
      filter: `user="${uid}" && qid="${qid}"`,
    })
    for (const it of list.items) await (await col('hs_favorites')).delete(it.id)
  } catch (e) {
    console.warn('[sync] 删除收藏失败', e?.message)
  }
}
