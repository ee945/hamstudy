# -*- coding: utf-8 -*-
"""初始化 PocketBase 集合（可重复执行，已存在则跳过）。

用法：
  1) 先启动服务： npm run pb
  2) python3 tools/setup_pb.py
首次部署先创建超管，凭据写在项目根 .env（模板见 .env.example）。
"""
import json, os, sys, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pb_admin  # noqa: E402

PB = pb_admin.PB
ADMIN_EMAIL = pb_admin.ADMIN_EMAIL
ADMIN_PWD = pb_admin.ADMIN_PWD


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


def admin_token():
    d = req("/api/collections/_superusers/auth-with-password", "POST",
            {"identity": ADMIN_EMAIL, "password": ADMIN_PWD})
    return d["token"]


TEXT = lambda: {"type": "text", "options": {}}
NUM = lambda: {"type": "number", "options": {}}
BOOL = lambda: {"type": "bool", "options": {}}
JSON = lambda: {"type": "json", "options": {}}
REQ = lambda t: {**t, "required": True}


def build_schema(users_cid):
    # 注意：PocketBase 0.40 的 REST 字段格式为「扁平内联」，
    # collectionId / cascadeDelete / maxSelect 等直接写在字段对象上，不再嵌套于 options。
    def owner_rel():
        return {
            "type": "relation", "required": True, "collectionId": users_cid,
            "cascadeDelete": True, "minSelect": 0, "maxSelect": 1, "displayFields": [],
        }

    def author_rel():
        # 修订人只作追溯用：删掉账号不该连带删掉他写的译文
        return {
            "type": "relation", "required": False, "collectionId": users_cid,
            "cascadeDelete": False, "minSelect": 0, "maxSelect": 1, "displayFields": [],
        }

    field = lambda name, t: {"name": name, **t}

    return {
        "hs_attempts": [
            field("user", owner_rel()), field("qid", TEXT()), field("level", TEXT()),
            field("sec", TEXT()), field("ok", BOOL()), field("mode", TEXT()),
        ],
        "hs_favorites": [
            field("user", owner_rel()), field("qid", TEXT()), field("level", TEXT()), field("sec", TEXT()),
        ],
        "hs_sessions": [
            field("user", owner_rel()), field("level", TEXT()), field("total", NUM()),
            field("correct", NUM()), field("durationSec", NUM()),
            field("mode", TEXT()), field("detail", JSON()),
        ],
        # 题库修订：题面正文仍由静态 JSON 提供，这里只存放被人工改过的字段。
        # 每条对应一道题（qid 唯一），空值表示沿用原文，便于「改了哪几处」一目了然。
        "hs_edits": [
            field("qid", REQ(TEXT())),
            field("level", TEXT()), field("sec", TEXT()),
            field("qzh", TEXT()), field("qen", TEXT()),
            field("optzh", JSON()), field("opten", JSON()),
            field("mnem", TEXT()), field("expl", TEXT()),
            field("diff", NUM()),          # 0 = 未指定，沿用题库原值
            field("author", author_rel()),
            field("note", TEXT()),
        ],
    }


# 默认 API 规则：自己的记录自己可见可改。个别集合需要放宽，见下。
DEFAULT_RULES = {
    "listRule": '@request.auth.id = user',
    "viewRule": '@request.auth.id = user',
    "createRule": '@request.auth.id != ""',
    "updateRule": '@request.auth.id = user',
    "deleteRule": '@request.auth.id = user',
}
# 修订内容是题面的一部分，连游客都要能看到（译文属于公开内容）。
# 但改写只放开给管理员 —— 见 ADMIN_ONLY。别改成「登录即可写」，
# 那等于把题库开放给任何注册账号，谁都能改题面和答案要点。
ADMIN_ONLY = '@request.auth.role = "admin"'
RULES = {
    "hs_edits": {
        "listRule": '',
        "viewRule": '',
        "createRule": ADMIN_ONLY,
        "updateRule": ADMIN_ONLY,
        "deleteRule": ADMIN_ONLY,
    },
}

# 挡住「注册或改资料时自带 role」的自提权。
# 实测（tools/verify_edits.mjs 有对应用例）：请求体里没有该字段时 PocketBase
# 视作空串，所以这里 `= ""` 既放行正常的注册与改资料，又能拦下 role=admin 的提交。
ROLE_GUARD = '@request.body.role = ""'


def main():
    token = admin_token()
    print("· 管理员登录成功")

    cols = req("/api/collections?perPage=200", token=token)["items"]
    by_name = {c["name"]: c for c in cols}
    users_cid = by_name.get("users", {}).get("id")
    if not users_cid:
        sys.exit("[ERROR] 未找到 users 集合")
    print(f"· users 集合 id = {users_cid}")

    # users 增加 nickname / role 字段
    # role：'admin' 题库管理员（改全站题面）、'editor' 编辑员（改中文译文等，需审核）、
    # 空串即普通用户。仅加字段不够 —— 必须同时收紧下面的写规则，否则用户改资料时
    # 顺手填个 admin 就能给自己提权。
    users = by_name["users"]
    for fname in ("nickname", "role"):
        if not any(f["name"] == fname for f in users.get("fields", [])):
            fields = users.get("fields", [])
            fields.append({"name": fname, "type": "text", "options": {}})
            req(f"/api/collections/{users['id']}", "PATCH", {"fields": fields}, token)
            print(f"· users 已添加 {fname} 字段")
            users = req(f"/api/collections/{users['id']}", token=token)

    # 注册可公开，改资料限本人，两者都不许携带 role
    req(f"/api/collections/{users['id']}", "PATCH", {
        "createRule": ROLE_GUARD,
        "updateRule": f"id = @request.auth.id && {ROLE_GUARD}",
    }, token)
    print("· users 写规则已收紧（禁止自带 role）")

    for name, schema in build_schema(users_cid).items():
        if name in by_name:
            print(f"· 跳过已存在的集合 {name}")
            continue
        idx = []
        if any(f["name"] == "user" for f in schema):
            idx.append("CREATE INDEX idx_%s_user ON %s (user)" % (name, name))
        if any(f["name"] == "qid" for f in schema):
            # hs_edits 一题只允许一条修订，唯一索引直接挡住重复写入
            uniq = " UNIQUE" if name == "hs_edits" else ""
            idx.append("CREATE%s INDEX idx_%s_qid ON %s (qid)" % (uniq, name, name))
        payload = {
            "name": name,
            "type": "base",
            "fields": schema,
            "indexes": idx,
            **RULES.get(name, DEFAULT_RULES),
        }
        req("/api/collections", "POST", payload, token)
        print(f"✓ 已创建集合 {name}")

    # 允许邮箱注册 + 免邮箱验证
    for cname, body in [
        ("users", {"authAlert": {"enabled": False}, "passwordAuth": {"enabled": True, "identityFields": ["email"]}}),
        ("_superusers", {}),
    ]:
        if body:
            cid = by_name[cname]["id"]
            cur = req(f"/api/collections/{cid}", token=token)
            cur.update(body)
            req(f"/api/collections/{cid}", "PATCH", {k: body[k] for k in body}, token)
    print("✓ 邮箱注册已开启（无需邮箱验证）")

    # 三级角色 / 待审提案 / 修订日志：定义集中在 setup_workflow.py，
    # 全新部署在这里直接跑一遍，避免两处维护同一份规则。
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import setup_workflow
    setup_workflow.main()

    print("\n· 此时还没有任何题库管理员 / 编辑员，任何人都改不了题库。")
    print("  授权方式：python3 tools/set_admin.py 你的邮箱 --role admin|editor")


if __name__ == "__main__":
    main()
