# -*- coding: utf-8 -*-
"""题库原文直写接口回归（pb/pb_hooks/bank_files.pb.js）。

覆盖：
  · 游客 / 编辑员被挡，站点 admin 与超管放行
  · 字段白名单与结构校验（选项必须 4 项非空、题号合法）
  · 保存后 public/data 与 dist/data 同步，题面内容不变（幂等写回）
  · 备份恢复接口的成功与失败路径
  · 全程不写 hs_edits / hs_pending / hs_edit_logs（业务层无痕）

临时账号只使用 @ham.test 后缀，跑完即删，绝不改动现有账号角色。
用法：python3 tools/verify_bank_write.py
"""
import hashlib
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
PWD = "BankWrite@Test123"
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
        with urllib.request.urlopen(r, timeout=10) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:200]}


def write(b, token=None):
    return req("/bank/write", "POST", b, token)


def md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def doc_of(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    print("=== 题库原文直写接口回归 ===")
    admin = pb_admin.admin_token()
    created = []

    def mk_user(role, tag):
        email = f"{tag}{int(time.time() * 1000)}@ham.test"
        st, u = req("/api/collections/users/records", "POST", {
            "email": email, "password": PWD, "passwordConfirm": PWD, "nickname": tag,
        }, admin)
        if st >= 400:
            raise RuntimeError(f"创建临时账号失败 {st}: {u}")
        req(f"/api/collections/users/records/{u['id']}", "PATCH", {"role": role}, admin)
        created.append(u["id"])
        st, a = req("/api/collections/users/auth-with-password", "POST",
                    {"identity": email, "password": PWD})
        return a.get("token")

    try:
        editor_t = mk_user("editor", "bankwrite-editor-")
        admin_t = mk_user("admin", "bankwrite-admin-")

        # ---- 权限 ----
        print("\n【一】权限边界")
        st, _ = write({"qid": "T1A01", "fields": {"qZh": "x"}})
        ok(st == 401, "游客被拒", st)
        st, d = write({"qid": "T1A01", "fields": {"qZh": "x"}}, editor_t)
        ok(st == 403, "编辑员被拒", st)
        st, d = write({"qid": "T1A01", "fields": {}}, admin_t)
        ok(st == 400 and d.get("error") == "没有需要保存的字段",
           "站点 admin 通过鉴权（进入业务校验）", f"{st} {d.get('error')}")
        st, d = write({"qid": "T1A01", "fields": {}}, admin)
        ok(st == 400 and d.get("ok") is False, "超管通过鉴权", st)

        # ---- 结构校验（都不落盘）----
        print("\n【二】结构校验")
        st, d = write({"qid": "T1A01", "fields": {"optZh": ["a", "b", "c"]}}, admin)
        ok(st == 400 and "4 项" in str(d.get("error")), "选项不是 4 项被拒", d.get("error"))
        st, d = write({"qid": "Z9Z99", "fields": {"qZh": "x"}}, admin)
        ok(st == 400 and "题号无效" in str(d.get("error")), "非法题号被拒", d.get("error"))
        st, d = write({"qid": "T1A01", "fields": {"ans": "B"}}, admin)
        ok(st == 400 and "没有需要保存" in str(d.get("error")),
           "非白名单字段（答案）被忽略且不落盘", d.get("error"))
        st, d = write({"qid": "T1A01", "fields": {"qZh": ""}}, admin)
        ok(st == 400 and "题干" in str(d.get("error")), "空题干被拒", d.get("error"))

        # ---- 幂等写回：用原值保存，内容不应发生任何变化 ----
        print("\n【三】写回与双目录同步")
        before_pub = doc_of(os.path.join(DATA, "q_technician.json"))
        q = next(x for x in before_pub["qs"] if x["id"] == "T1A01")
        original_qzh = q["qZh"]
        st, d = write({"qid": "T1A01", "fields": {"qZh": original_qzh}}, admin)
        ok(st == 200 and d.get("ok") is True, "单题保存成功", f"{st} {d}")
        ok(d.get("distSynced") is True, "dist/data 已同步，线上立即生效", d.get("distSynced"))
        after_pub = doc_of(os.path.join(DATA, "q_technician.json"))
        q2 = next(x for x in after_pub["qs"] if x["id"] == "T1A01")
        ok(q2 == q, "写回后题目对象逐字段不变（幂等）")
        ok(md5(os.path.join(DATA, "q_technician.json")) == md5(os.path.join(DIST, "q_technician.json")),
           "public/data 与 dist/data 内容一致")

        # ---- 备份恢复 ----
        print("\n【四】备份恢复")
        st, d = write({"action": "restore", "kind": "bad", "files": {}}, admin)
        ok(st == 400 and "不是有效" in str(d.get("error")), "非法备份被拒", d.get("error"))
        st, d = write({"action": "restore", "kind": "hamstudy-bank-backup",
                       "files": {"meta.json": doc_of(os.path.join(DATA, "meta.json"))}}, admin)
        ok(st == 200 and d.get("restored") == ["meta.json"],
           "合法备份可恢复（仅回写原值）", f"{st} {d}")

        # ---- 业务层无痕 ----
        print("\n【五】不写任何修订日志")
        for col in ("hs_edits", "hs_pending", "hs_edit_logs"):
            st, d = req(f"/api/collections/{col}/records?perPage=1", token=admin)
            ok(st == 200 and d.get("totalItems") == 0,
               f"{col} 保持为空", d.get("totalItems"))
    finally:
        print("\n【清理】删除临时测试账号")
        for uid in created:
            req(f"/api/collections/users/records/{uid}", "DELETE", token=admin)
        # 兜底：别的回归若中途失败会留下 @ham.test 账号，写死「恢复为 2 个」
        # 会被这些无关残留带偏，所以按后缀清一遍再断言「无测试账号」。
        st, d = req("/api/collections/users/records?perPage=200", token=admin)
        for u in d.get("items", []):
            if (u.get("email") or "").endswith("@ham.test"):
                req(f"/api/collections/users/records/{u['id']}", "DELETE", token=admin)
        st, d = req("/api/collections/users/records?perPage=200", token=admin)
        real = [u.get("email") for u in d.get("items", [])]
        ok(all("@ham.test" not in e for e in real),
           "测试账号已清空，只剩真实账号", f"{len(real)} 个")

    passed = sum(1 for x in results if x[0])
    print(f"\n结果: {passed}/{len(results)} 通过")
    if passed != len(results):
        for good, name, detail in results:
            if not good:
                print("  失败项:", name, detail)
        sys.exit(1)


if __name__ == "__main__":
    main()
