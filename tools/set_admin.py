# -*- coding: utf-8 -*-
"""授予 / 撤销题库角色（三级：普通用户 / editor 编辑员 / admin 管理员）。

被授权的是普通注册账号，用它登录前台就能进题库维护；
后台面板的超级管理员（_superusers）是另一套账号，不受影响。

    admin   管理员 —— 可改题库任意部分，直接生效；审核编辑员的提案
    editor  编辑员 —— 只改中文译文 / 记忆要点 / 题目解析，提交后需管理员审核
    ''      普通用户 —— 只能浏览

用法：
    python3 tools/set_admin.py you@example.com                    # 授权为管理员（默认）
    python3 tools/set_admin.py you@example.com --role editor     # 授权为编辑员
    python3 tools/set_admin.py you@example.com --role admin      # 授权为管理员
    python3 tools/set_admin.py you@example.com --revoke          # 撤销，回到普通用户
    python3 tools/set_admin.py --list                            # 列出所有有角色的账号
"""
import os
import sys
import json
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pb_admin  # noqa: E402

PB = pb_admin.PB
ADMIN_EMAIL = pb_admin.ADMIN_EMAIL
ADMIN_PWD = pb_admin.ADMIN_PWD

ROLE_LABEL = {"admin": "管理员", "editor": "编辑员", "": "普通用户"}


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
        return {"_code": e.code, "_body": e.read().decode()[:300]}


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)

    token = req("/api/collections/_superusers/auth-with-password", "POST",
                {"identity": ADMIN_EMAIL, "password": ADMIN_PWD}).get("token")
    if not token:
        sys.exit("[ERROR] 超级管理员登录失败，请确认 PocketBase 已启动")

    users = req("/api/collections/users/records?perPage=500", token=token).get("items", [])

    def show(u):
        role = u.get("role") or ""
        return f"{u.get('nickname') or '（未填昵称）'} <{u.get('email','')}>  [{ROLE_LABEL.get(role, role)}]"

    if "--list" in args:
        staff = [u for u in users if (u.get("role") or "") in ("admin", "editor")]
        if not staff:
            print("当前没有管理员 / 编辑员。授权：python3 tools/set_admin.py 你的邮箱 --role editor")
            return
        print(f"有角色的账号 {len(staff)} 个：")
        for u in staff:
            print("  ·", show(u))
        return

    email = args[0]
    revoke = "--revoke" in args
    role = ""
    if "--role" in args:
        i = args.index("--role")
        if i + 1 >= len(args):
            sys.exit("[ERROR] --role 后面要跟 admin 或 editor")
        role = args[i + 1]
    if role not in ("admin", "editor", ""):
        sys.exit(f"[ERROR] 未知角色 {role!r}，只能是 admin 或 editor")
    if revoke:
        role = ""
    elif not role:
        role = "admin"  # 兼容旧用法：不带 --role 就是授权管理员

    hit = [u for u in users if (u.get("email") or "").lower() == email.lower()]
    if not hit:
        sys.exit(f"[ERROR] 找不到账号 {email}。请先在前台注册，再回来授权。")
    u = hit[0]

    # 用超级管理员身份写，绕过 users 集合上「不许自带 role」的规则
    r = req(f"/api/collections/users/records/{u['id']}", "PATCH", {"role": role}, token)
    if r.get("_code"):
        sys.exit(f"[ERROR] 写入失败 {r['_code']}：{r.get('_body')}")

    print(f"已设为 {ROLE_LABEL[role]}：{show(r)}")
    if role:
        print("  用这个账号登录前台，头像菜单 → 题库维护 / 待审修订。")
        print("  若此刻正登录着，刷新一下页面就能拿到新身份。")
    else:
        print("  该账号现在只能浏览题库。")


if __name__ == "__main__":
    main()
