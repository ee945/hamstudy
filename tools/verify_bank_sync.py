# -*- coding: utf-8 -*-
"""题库「发布同步」回归：/bank/write 的 sync-status / sync 两个 action。

覆盖：
  · 游客 / 编辑员被挡，站点 admin 与超管放行
  · status 用内容比较识别差异（不靠 size/mtime），返回待同步清单
  · sync 把 public/data 原样同步到 dist/data，逐字节一致；重复执行幂等
  · 源文件 JSON 损坏时整体中止，不写坏运行目录
  · 全程不写 hs_edits / hs_pending / hs_edit_logs

⚠️ 本脚本会临时改动 public/data 与 dist/data 的文件内容，finally 里逐字节还原。
   跑之前别在别的窗口做题库编辑。钩子是启动时加载的，改完 pb_hooks 必须先重启
   PocketBase 再跑本脚本，否则 /bank/write 不认识 sync-status 这个 action。

用法：python3 tools/verify_bank_sync.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pb_admin  # noqa: E402

PB = pb_admin.PB
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
DIST = os.path.join(ROOT, "dist", "data")
FILES = ["meta.json", "q_technician.json", "q_general.json", "q_extra.json"]
MARK = "【同步测试标记】"
PWD = "BankSync@Test123"
results = []


def ok(cond, name, extra=""):
    results.append((bool(cond), name, extra))
    print(("  ✓ " if cond else "  ✗ ") + name + (("  — " + str(extra)) if extra else ""))


def req(path, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(PB + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", token)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:200]}


def call(action, token=None):
    return req("/bank/write", "POST", {"action": action}, token)


def bytes_of(base, name):
    with open(os.path.join(base, name), "rb") as f:
        return f.read()


def put_bytes(base, name, raw):
    with open(os.path.join(base, name), "wb") as f:
        f.write(raw)


def doc_with_mark(raw):
    """在 q_technician.json 首题的中文题干后加标记，保持结构与紧凑格式。"""
    doc = json.loads(raw.decode("utf-8"))
    doc["qs"][0]["qZh"] = doc["qs"][0]["qZh"] + MARK
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def state_of(files, name):
    for f in files:
        if f.get("name") == name:
            return f.get("state")
    return "?"


def business_counts(admin):
    out = {}
    for col in ("hs_edits", "hs_pending", "hs_edit_logs"):
        st, d = req(f"/api/collections/{col}/records?perPage=1", token=admin)
        out[col] = d.get("totalItems") if st == 200 else -1
    return out


def main():
    print("=== 题库发布同步回归 ===")
    admin = pb_admin.admin_token()
    created = []
    # 逐字节快照：无论中途哪一步失败，finally 都把 8 个文件还原
    snapshot = {("public", n): bytes_of(DATA, n) for n in FILES}
    snapshot.update({("dist", n): bytes_of(DIST, n) for n in FILES})
    before_counts = business_counts(admin)

    def mk_user(role, tag):
        email = f"{tag}{int(time.time() * 1000)}@ham.test"
        st, u = req("/api/collections/users/records", "POST", {
            "email": email, "password": PWD, "passwordConfirm": PWD, "nickname": tag,
        }, admin)
        if st >= 400:
            raise RuntimeError(f"创建临时账号失败 {st}: {u}")
        req(f"/api/collections/users/records/{u['id']}", "PATCH", {"role": role}, admin)
        created.append(u["id"])
        _, a = req("/api/collections/users/auth-with-password", "POST",
                   {"identity": email, "password": PWD})
        return a.get("token")

    try:
        editor_t = mk_user("editor", "banksync-editor-")
        site_admin_t = mk_user("admin", "banksync-admin-")

        # ---- 权限 ----
        print("\n【一】权限边界")
        st, _ = call("sync-status")
        ok(st == 401, "游客被拒", st)
        st, _ = call("sync-status", editor_t)
        ok(st == 403, "编辑员被拒", st)
        st, d = call("sync-status", site_admin_t)
        ok(st == 200 and d.get("ok") is True, "站点 admin 可查状态", f"{st} {d.get('error','')}")
        st, d = call("sync-status", admin)
        ok(st == 200 and d.get("ok") is True, "超管可查状态", st)
        st, _ = call("sync", editor_t)
        ok(st == 403, "编辑员不能执行同步", st)

        # ---- 初始状态 ----
        print("\n【二】初始状态")
        st, d = call("sync-status", admin)
        ok(st == 200 and len(d.get("files", [])) == 4, "返回四个题库文件", len(d.get("files", [])))
        ok(d.get("pending") == 0 and all(f["state"] == "same" for f in d.get("files", [])),
           "初始两处内容一致", d.get("pending"))

        # ---- 场景 A：只改 dist（模拟运行目录被外部动过）----
        print("\n【三】dist/data 落后时同步修复")
        put_bytes(DIST, "q_technician.json", doc_with_mark(snapshot[("public", "q_technician.json")]))
        st, d = call("sync-status", admin)
        ok(d.get("pending") == 1 and state_of(d.get("files", []), "q_technician.json") == "diff",
           "状态正确识别出 1 个待同步文件", d.get("pending"))
        st, d = call("sync", admin)
        ok(st == 200 and d.get("ok") is True, "同步成功", f"{st} {d.get('error','')}")
        ok("q_technician.json" in d.get("synced", []), "只同步有差异的那一个", d.get("synced"))
        ok(len(d.get("skipped", [])) == 3, "其余三个被跳过", d.get("skipped"))
        ok(bytes_of(DATA, "q_technician.json") == bytes_of(DIST, "q_technician.json"),
           "dist/data 与 public/data 逐字节一致")
        ok(MARK not in bytes_of(DIST, "q_technician.json").decode("utf-8"),
           "运行目录里的假标记已被权威源覆盖")

        # ---- 幂等 ----
        print("\n【四】重复执行幂等")
        st, d = call("sync", admin)
        ok(st == 200 and d.get("synced") == [] and len(d.get("skipped", [])) == 4,
           "第二次同步不写任何文件", f"{st} {d.get('synced')}")
        st, d = call("sync-status", admin)
        ok(d.get("pending") == 0, "同步后待发布数为 0", d.get("pending"))

        # ---- 场景 B：改 public（真实场景：git pull 拉到新译文）----
        print("\n【五】public/data 有新译文时发布到运行目录")
        new_pub = doc_with_mark(snapshot[("public", "q_technician.json")])
        put_bytes(DATA, "q_technician.json", new_pub)
        st, d = call("sync-status", admin)
        ok(d.get("pending") == 1, "状态检测到新译文", d.get("pending"))
        st, d = call("sync", admin)
        ok(st == 200 and d.get("ok") is True and d.get("pending") == 0,
           "发布成功且无残留", f"{st} {d.get('error','')}")
        ok(bytes_of(DIST, "q_technician.json") == new_pub,
           "运行目录拿到新译文（逐字节一致）")

        # ---- 坏文件保护 ----
        print("\n【六】源文件损坏时整体中止")
        dist_meta_before = bytes_of(DIST, "meta.json")
        put_bytes(DATA, "meta.json", b'{"levels":')
        st, d = call("sync", admin)
        ok(st == 400 and "不是合法 JSON" in str(d.get("error", "")),
           "非法 JSON 被拒", f"{st} {d.get('error','')}")
        ok(bytes_of(DIST, "meta.json") == dist_meta_before,
           "拒绝时运行目录未被写入")
        put_bytes(DATA, "meta.json", snapshot[("public", "meta.json")])

        # ---- 业务层无痕 ----
        print("\n【七】不写任何修订日志")
        after_counts = business_counts(admin)
        ok(before_counts == after_counts,
           "hs_edits / hs_pending / hs_edit_logs 记录数不变",
           f"{before_counts} → {after_counts}")

    finally:
        print("\n【清理】还原八个文件 + 删除临时账号")
        for (where, name), raw in snapshot.items():
            put_bytes(DATA if where == "public" else DIST, name, raw)
        # 让运行目录回到与仓库一致的状态（若钩子可用）
        try:
            call("sync", admin)
        except Exception:
            pass
        for n in FILES:
            if bytes_of(DATA, n) != bytes_of(DIST, n):
                put_bytes(DIST, n, bytes_of(DATA, n))
        for uid in created:
            req(f"/api/collections/users/records/{uid}", "DELETE", token=admin)
        st, d = req("/api/collections/users/records?perPage=200", token=admin)
        for u in d.get("items", []):
            if (u.get("email") or "").endswith("@ham.test"):
                req(f"/api/collections/users/records/{u['id']}", "DELETE", token=admin)
        ok(all(bytes_of(DATA, n) == snapshot[("public", n)] for n in FILES),
           "public/data 已逐字节还原")
        ok(all(bytes_of(DIST, n) == snapshot[("dist", n)] for n in FILES),
           "dist/data 已逐字节还原")

    passed = sum(1 for x in results if x[0])
    print(f"\n结果: {passed}/{len(results)} 通过")
    if passed != len(results):
        for good, name, detail in results:
            if not good:
                print("  失败项:", name, detail)
        sys.exit(1)


if __name__ == "__main__":
    main()
