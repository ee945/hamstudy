# -*- coding: utf-8 -*-
"""PocketBase 超级管理员连接助手（供 tools 下的回归 / 运维脚本复用）。

只提供鉴权与原始请求，不含任何业务写操作。题库原文的修改请走站点
「题库原文编辑」（/bank/edit），它会通过 pb/pb_hooks/bank_files.pb.js
同时写回 public/data 与 dist/data。

配置：项目根 .env（模板见 .env.example）或 shell 环境变量。
      PB_ADMIN / PB_ADMIN_PWD 必填；PB_URL 由 .env 的 PB_PORT 派生
      （默认 8199），仅当 PocketBase 不在本机时才显式设置 PB_URL。
      端口规则的唯一实现见 tools/config.py，本文件只做同样的轻量派生。
      仓库内不含任何真实凭据。
"""
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_dotenv():
    """零依赖读取项目根 .env；已由 shell 传入的变量优先。"""
    fp = os.path.join(ROOT, ".env")
    if not os.path.exists(fp):
        return
    with open(fp, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k:
                os.environ.setdefault(k, v)


_load_dotenv()


def _pb_base():
    """PB_URL 未显式给出时，按 .env 的 PB_PORT 派生，保持与 config.py 一致。"""
    override = os.environ.get("PB_URL", "").strip()
    if override:
        return override.rstrip("/")
    port = os.environ.get("PB_PORT", "8199").strip()
    if not port.isdigit() or not (1024 <= int(port) <= 32767):
        sys.exit(f"[配置错误] .env 中 PB_PORT={port!r} 不是合法端口（1024–32767）")
    return f"http://127.0.0.1:{port}"


PB = _pb_base()


def _required(key):
    val = os.environ.get(key)
    if not val:
        sys.exit(f"[配置缺失] 请在项目根 .env 中设置 {key}（参考 .env.example）")
    return val


ADMIN_EMAIL = _required("PB_ADMIN")
ADMIN_PWD = _required("PB_ADMIN_PWD")


def req(path, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(PB + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", token)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"[ERROR] {method} {path} -> {e.code}\n{e.read().decode()[:800]}")


def admin_token():
    return req("/api/collections/_superusers/auth-with-password", "POST",
               {"identity": ADMIN_EMAIL, "password": ADMIN_PWD})["token"]


if __name__ == "__main__":
    print(admin_token())
