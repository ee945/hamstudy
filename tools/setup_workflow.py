# -*- coding: utf-8 -*-
"""题库审批工作流：三级角色 + 待审表 + 修订日志表（可重复执行）。

角色（users.role）：
    ''        普通用户 —— 只能浏览题库
    'editor'  编辑员   —— 可改中文翻译 / 记忆要点 / 题目解析，提交后「待审」，不立即生效
    'admin'   管理员   —— 可改题库任意部分（直接生效），并审核编辑员的提案

新增两个集合：
    hs_pending    编辑员的待审提案；管理员审核通过后才合并进 hs_edits
    hs_edit_logs  修订日志，记录编辑员与管理员的每一次修订操作

题库原文以 public/data 下三个 q_*.json 为唯一权威源，由管理员在
「题库原文编辑」页直接改写；本脚本不创建任何题库内容集合。

本脚本只动「集合定义与 API 规则」，不写业务数据；全新部署请用 setup_pb.py，
它已经内置了同样的定义。授权具体账号用 tools/set_admin.py --role editor|admin。

用法：先启动 PocketBase，再 `python3 tools/setup_workflow.py`
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

TEXT = lambda: {"type": "text", "options": {}}
NUM = lambda: {"type": "number", "options": {}}
JSON = lambda: {"type": "json", "options": {}}
REQ = lambda t: {**t, "required": True}


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


def person_rel(users_cid):
    """只作追溯用：删账号不该连带删掉他提交的提案 / 日志"""
    return {
        "type": "relation", "required": False, "collectionId": users_cid,
        "cascadeDelete": False, "minSelect": 0, "maxSelect": 1, "displayFields": [],
    }


def field(name, t):
    return {"name": name, **t}


def schemas(users_cid):
    # 提案里刻意不放 qen / opten / diff —— 编辑员能改什么是结构性的，
    # 不靠前端隐藏输入框。status 空串 = 待审，'approved' / 'rejected' 为终态。
    pending = [
        field("qid", REQ(TEXT())),
        field("level", TEXT()), field("sec", TEXT()),
        field("qzh", TEXT()), field("optzh", JSON()),
        field("mnem", TEXT()), field("expl", TEXT()),
        field("fields", JSON()),       # 本次改了哪些字段，审核台据此展示
        field("note", TEXT()),         # 修订说明
        field("author", person_rel(users_cid)),
        # users 的 viewRule 是「只看自己」，审核时管理员查不到别人的昵称，
        # 所以提交时把昵称快照下来，审核台与贡献榜直接用它。
        field("authorName", TEXT()),
        field("status", TEXT()),
        field("reviewer", person_rel(users_cid)),
        field("reviewNote", TEXT()),
        field("at", TEXT()),           # ISO 时间；这个 PB 版本不会自动加 created/updated
    ]
    logs = [
        field("qid", REQ(TEXT())),
        field("level", TEXT()), field("sec", TEXT()),
        field("userId", REQ(TEXT())), field("userName", TEXT()), field("userRole", TEXT()),
        field("action", REQ(TEXT())),  # submit / withdraw / direct / approve / assist / reject / revert
        field("fields", JSON()), field("summary", TEXT()), field("note", TEXT()),
        field("contributor", TEXT()), field("contributorName", TEXT()),
        field("pendingId", TEXT()),
        field("at", TEXT()),           # ISO 时间，日志排序与展示都靠它
    ]
    return {"hs_pending": pending, "hs_edit_logs": logs}


# ---- API 规则 ---------------------------------------------------------------
# 关键：PocketBase 的 update 规则是针对「库中现有记录」求值的，不是新值。
# 所以编辑员改自己的提案时，光有 status = "" 挡不住他顺手把 status 改成 approved
# 自己给自己通过 —— 必须再用 @request.body.status = "" 锁住请求体。
# 同理，创建时也要挡住自带 status / reviewer，否则能伪造「已通过」的提案。
PENDING_BODY_GUARD = (
    '@request.body.status = "" && '
    '@request.body.reviewer = "" && '
    '@request.body.reviewNote = ""'
)
PENDING_RULES = {
    "listRule": '@request.auth.role = "admin" || author = @request.auth.id',
    "viewRule": '@request.auth.role = "admin" || author = @request.auth.id',
    "createRule": (
        '(@request.auth.role = "editor" || @request.auth.role = "admin") && '
        '@request.body.author = @request.auth.id && ' + PENDING_BODY_GUARD
    ),
    "updateRule": (
        '@request.auth.role = "admin" || '
        '(author = @request.auth.id && status = "" && ' + PENDING_BODY_GUARD + ')'
    ),
    "deleteRule": '@request.auth.role = "admin" || (author = @request.auth.id && status = "")',
}

# 日志由前端在每次操作成功后写入。规则同时保证：
#   ① 只能记在自己名下；② 编辑员只能写 submit / withdraw，管理员只能写管理类动作。
# 否则随便一个编辑员就能造一条 approve 日志刷贡献榜。
LOG_RULES = {
    "listRule": '@request.auth.id != ""',
    "viewRule": '@request.auth.id != ""',
    "createRule": (
        '@request.auth.id != "" && @request.body.userId = @request.auth.id && '
        '((@request.auth.role = "editor" && '
        '(@request.body.action = "submit" || @request.body.action = "withdraw")) || '
        '(@request.auth.role = "admin" && @request.body.action != "submit"))'
    ),
    "updateRule": None,
    "deleteRule": None,
}

RULES_BY_NAME = {
    "hs_pending": PENDING_RULES,
    "hs_edit_logs": LOG_RULES,
}

# 每个集合要建的索引（PATCH 集合时不会重建索引，新装与升级都靠这里补齐）
INDEXES_BY_NAME = {
    "hs_pending": [
        "CREATE INDEX idx_hs_pending_qid ON hs_pending (qid)",
        "CREATE INDEX idx_hs_pending_author ON hs_pending (author)",
        "CREATE INDEX idx_hs_pending_status ON hs_pending (status)",
    ],
    "hs_edit_logs": [
        "CREATE INDEX idx_hs_edit_logs_qid ON hs_edit_logs (qid)",
        "CREATE INDEX idx_hs_edit_logs_user ON hs_edit_logs (userId)",
        "CREATE INDEX idx_hs_edit_logs_action ON hs_edit_logs (action)",
    ],
}

ADMIN_ONLY = '@request.auth.role = "admin"'
ROLE_GUARD = '@request.body.role = ""'


def ensure_fields(name, wanted, token):
    """给已存在的集合补字段。PocketBase 的 PATCH 要传完整 fields 数组。"""
    cur = req(f"/api/collections/{name}", token=token)
    have = {f["name"] for f in cur.get("fields", [])}
    missing = [f for f in wanted if f["name"] not in have]
    if missing:
        req(f"/api/collections/{cur['id']}", "PATCH",
            {"fields": (cur.get("fields") or []) + missing}, token)
        print(f"· {name} 补字段：{', '.join(f['name'] for f in missing)}")
    return req(f"/api/collections/{name}", token=token)


def main():
    token = req("/api/collections/_superusers/auth-with-password", "POST",
                {"identity": ADMIN_EMAIL, "password": ADMIN_PWD})["token"]
    print("· 超级管理员登录成功")

    cols = req("/api/collections?perPage=200", token=token)["items"]
    by_name = {c["name"]: c for c in cols}
    if "users" not in by_name or "hs_edits" not in by_name:
        sys.exit("[ERROR] 基础集合不全，请先运行 tools/setup_pb.py")
    users_cid = by_name["users"]["id"]

    # ---- 1) users.role 字段与防自提权规则（三级角色共用一套） ----
    users = by_name["users"]
    if not any(f["name"] == "role" for f in users.get("fields", [])):
        fields = users.get("fields", [])
        fields.append({"name": "role", "type": "text", "options": {}})
        req(f"/api/collections/{users_cid}", "PATCH", {"fields": fields}, token)
        print("· users 已添加 role 字段")
    req(f"/api/collections/{users_cid}", "PATCH", {
        "createRule": ROLE_GUARD,
        "updateRule": f"id = @request.auth.id && {ROLE_GUARD}",
    }, token)
    print('· users 写规则：注册 / 改资料均不许自带 role（admin 与 editor 都挡）')

    # ---- 2) hs_edits 仍只允许管理员直接写 ----
    req(f"/api/collections/{by_name['hs_edits']['id']}", "PATCH", {
        "listRule": "", "viewRule": "",
        "createRule": ADMIN_ONLY, "updateRule": ADMIN_ONLY, "deleteRule": ADMIN_ONLY,
    }, token)
    print('· hs_edits：读公开、写仅管理员（编辑员只能走 hs_pending）')
    # 这个 PB 版本不会自动加 created/updated，修订记录原来显示的是 NaN-NaN-NaN；
    # 统一补一个显式时间字段，由前端写入。
    ensure_fields("hs_edits", [field("at", TEXT())], token)

    # ---- 3) 三个新集合 ----
    for name, schema in schemas(users_cid).items():
        rules = RULES_BY_NAME[name]
        idx = INDEXES_BY_NAME[name]
        if name in by_name:
            req(f"/api/collections/{by_name[name]['id']}", "PATCH", rules, token)
            print(f"· {name} 已存在，规则已刷新")
        else:
            req("/api/collections", "POST", {
                "name": name, "type": "base", "fields": schema,
                "indexes": idx, **rules,
            }, token)
            print(f"✓ 已创建集合 {name}")
        cur = ensure_fields(name, schema, token)
        # indexes 单独补一次：PATCH 集合时不会重建索引，新装与升级走同一条路
        merged = list(dict.fromkeys((cur.get("indexes") or []) + idx))
        if merged != (cur.get("indexes") or []):
            req(f"/api/collections/{cur['id']}", "PATCH", {"indexes": merged}, token)

    print("\n· 完成。授权示例：")
    print("    python3 tools/set_admin.py you@example.com --role editor")
    print("    python3 tools/set_admin.py you@example.com --role admin")
    print("\n· 题库原文：管理员在站点「题库原文编辑」页直接改写 public/data 下三个 JSON，")
    print("  不记修订日志、不计入「已人工修订」；定期在「进度 → 数据管理」导出备份。")


if __name__ == "__main__":
    main()
