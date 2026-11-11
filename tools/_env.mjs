#!/usr/bin/env node
/**
 * 回归 / 运维脚本的公共配置读取器（零依赖，Node 18+）。
 *
 * 优先级：进程环境变量 > 项目根 .env > 内置默认值。
 * .env 已被 .gitignore 排除，仓库里只保留 .env.example 模板，
 * 因此任何超管凭据都不会进入版本历史。
 *
 * 端口的唯一来源是 .env 的 PB_PORT / SITE_PORT；PB_URL / SITE_URL
 * 由它们派生，仅在 PocketBase 不在本机时才需显式覆盖。
 * 与 tools/config.py 的端口规则保持一致。
 *
 * 用法：import { BASE, PB, ADMIN, PB_PORT, SITE_PORT } from './_env.mjs'
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = path.join(ROOT_DIR, '.env')

if (fs.existsSync(ENV_FILE)) {
  for (const raw of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 1) continue
    const key = line.slice(0, i).trim()
    let val = line.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    // 已经从 shell 传入的值优先，.env 只补空缺
    if (!(key in process.env)) process.env[key] = val
  }
}

function required(key) {
  const val = process.env[key]
  if (!val) {
    console.error(`[配置缺失] 请在项目根 .env 中设置 ${key}（参考 .env.example）`)
    process.exit(1)
  }
  return val
}

function port(key, fallback, allowPrivileged = false) {
  const v = String(process.env[key] || fallback).trim()
  // SITE_PORT 允许 80/443（nginx master 由 root 启动）；PB_PORT 必须以非 root 运行
  const lo = allowPrivileged ? 1 : 1024
  const hi = allowPrivileged ? 65535 : 32767
  if (!/^\d{1,5}$/.test(v) || Number(v) < lo || Number(v) > hi) {
    console.error(`[配置错误] .env 中 ${key}=${v} 不是合法端口（${lo}–${hi}）`)
    process.exit(1)
  }
  return v
}

export const PB_PORT = port('PB_PORT', '8199')
export const SITE_PORT = port('SITE_PORT', '8091', true)
/** 站点前台地址（回归脚本用；线上由 nginx 决定，前端代码不需要配置） */
export const BASE = process.env.SITE_URL || `http://127.0.0.1:${SITE_PORT}`
/** PocketBase 直连地址（不经 /pb 反代） */
export const PB = process.env.PB_URL || `http://127.0.0.1:${PB_PORT}`
/** PocketBase 超级管理员，仅用于建/删测试账号与读取校验 */
export const ADMIN = {
  identity: required('PB_ADMIN'),
  password: required('PB_ADMIN_PWD'),
}
