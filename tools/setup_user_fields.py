# -*- coding: utf-8 -*-
"""users 集合的账户资料字段（可重复执行）。

  1) avatarPreset —— 内置头像的键名，空串表示用默认的「首字母」头像
  2) callsign     —— 业余无线电呼号，如 BA4ABC / BD1XYZ
  3) password.min —— 默认 8 位（PocketBase 原生下限，不再下调）

用法：先启动 PocketBase，再 `python3 tools/setup_user_fields.py`
"""
import json, os, sys, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pb_admin  # noqa: E402

PB = pb_admin.PB
ADMIN_EMAIL = pb_admin.ADMIN_EMAIL
ADMIN_PWD = pb_admin.ADMIN_PWD
MIN_PWD = int(os.environ.get("PB_MIN_PWD", "8"))


def req(path, method="GET", body=None, token=None):
    url = PB + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", token)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"[ERROR] {method} {path} -> {e.code}\n{e.read().decode()[:600]}")


def main():
    token = req("/api/collections/_superusers/auth-with-password", "POST",
                {"identity": ADMIN_EMAIL, "password": ADMIN_PWD})["token"]
    users = next(c for c in req("/api/collections?perPage=200", token=token)["items"]
                 if c["name"] == "users")
    cid = users["id"]
    fields = users.get("fields", [])
    changed = []

    # 1) 内置头像键名
    if not any(f["name"] == "avatarPreset" for f in fields):
        fields.append({"name": "avatarPreset", "type": "text", "options": {}})
        changed.append("+ avatarPreset")

    # 2) 业余无线电呼号
    if not any(f["name"] == "callsign" for f in fields):
        fields.append({
            "name": "callsign", "type": "text",
            "options": {"min": 0, "max": 16, "pattern": ""},
        })
        changed.append("+ callsign")

    # 3) 密码最短长度
    for f in fields:
        if f["name"] == "password" and f.get("min", 8) != MIN_PWD:
            f["min"] = MIN_PWD
            changed.append(f"~ password.min -> {MIN_PWD}")

    if not changed:
        print("· 无需变更，账户字段已是最新")
        return

    req(f"/api/collections/{cid}", "PATCH", {"fields": fields}, token)
    print("✓ users 已更新：" + "，".join(changed))

    # 回读校验
    cur = req(f"/api/collections/{cid}", token=token)
    names = [f["name"] for f in cur["fields"]]
    pwd = next(f for f in cur["fields"] if f["name"] == "password")
    print(f"  字段: {[n for n in names if n in ('nickname', 'avatarPreset', 'callsign', 'avatar')]}")
    print(f"  密码最短长度: {pwd.get('min')}")


if __name__ == "__main__":
    main()
