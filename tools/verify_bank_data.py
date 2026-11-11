# -*- coding: utf-8 -*-
"""题库完整性校验：以 public/data 下三个 q_*.json 为唯一基准。

本站点已完全剥离最初的 Excel 导入总表。三个 q_*.json 就是出厂原文，
也是唯一权威数据源；管理员通过「题库原文编辑」直接改写它们，
编辑员的修订另存 hs_edits / hs_edit_logs 并叠加在原文之上。

因此本脚本只做 JSON 自身的结构断言与历史修复点回归，
不再读取、比对或依赖任何外部表格，也不需要 openpyxl。

用法：
    python3 tools/verify_bank_data.py
"""
import glob
import json
import os
import sys
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "public", "data")
SLUGS = ("technician", "general", "extra")
TOTAL = 1431


def site_base():
    """HTTP 头校验用的站点地址，端口跟随 .env 的 SITE_PORT（云端常为 80）。"""
    port = "8091"
    try:
        with open(os.path.join(BASE, ".env"), encoding="utf-8") as f:
            for line in f:
                if line.startswith("SITE_PORT="):
                    port = line.split("=", 1)[1].strip() or port
    except OSError:
        pass
    return f"http://127.0.0.1:{port}"

results = []


def ok(cond, name, detail=""):
    results.append((bool(cond), name, detail))
    print(("  ✓ " if cond else "  ✗ ") + name + (f"  ({detail})" if detail else ""))


def load_json():
    qmap, docs = {}, {}
    files = sorted(glob.glob(os.path.join(DATA, "q_*.json")))
    for fp in files:
        with open(fp, encoding="utf-8") as f:
            doc = json.load(f)
        docs[os.path.basename(fp)] = doc
        for q in doc["qs"]:
            qmap[q["id"]] = (q, os.path.basename(fp))
    return qmap, docs, files


def main():
    print("=== 题库完整性校验（以三个 JSON 为唯一基准）===")
    qmap, docs, files = load_json()
    print("题库文件:", ", ".join(os.path.basename(f) for f in files))
    print("站点题数:", len(qmap))

    # ---- 1. 权威数据源就是这三个文件 ----
    print("\n【一】权威数据源")
    ok(sorted(os.path.basename(f) for f in files) ==
       sorted(f"q_{s}.json" for s in SLUGS), "恰好三个级别题库文件")
    ok(len(qmap) == TOTAL, f"题数 {TOTAL}", str(len(qmap)))
    ok(all(isinstance(d.get("qs"), list) and d["qs"] for d in docs.values()),
       "每个文件都有非空 qs 数组")
    ok(len(qmap) == sum(len(d["qs"]) for d in docs.values()), "题号全局唯一，无重复")

    # ---- 2. meta.json 考试配置 ----
    print("\n【二】meta.json 考试配置")
    meta_path = os.path.join(DATA, "meta.json")
    meta = json.load(open(meta_path, encoding="utf-8"))
    got = {lv["slug"]: lv["exam"].get("minutes") for lv in meta["levels"]}
    ok(got == {"technician": 60, "general": 60, "extra": 75},
       "三个级别时长 60 / 60 / 75 均在 meta.json", str(got))
    for lv in meta["levels"]:
        ids = [i for b in lv.get("blocks", []) for s in b.get("secs", []) for i in s.get("ids", [])]
        ok(len(ids) == len(set(ids)) and all(i in qmap for i in ids),
           f"{lv['slug']} 结构树中的题号都存在且不重复", f"{len(ids)} 题")

    # ---- 3. 全库选项 / 答案 / 必填字段 ----
    print("\n【三】全库结构与答案完整性")
    bad_opt, bad_ans, suspicious, bad_core = [], [], [], []
    for qid, (q, fp) in qmap.items():
        for name in ("optEn", "optZh"):
            arr = q.get(name) or []
            if len(arr) != 4 or any(not isinstance(v, str) or not v.strip() for v in arr):
                bad_opt.append((qid, name, arr))
        a = q.get("ans", "")
        if len(a) != 1 or a not in "ABCD":
            bad_ans.append((qid, a))
        else:
            i = "ABCD".index(a)
            for name in ("optEn", "optZh"):
                arr = q.get(name) or []
                if i >= len(arr) or not str(arr[i]).strip():
                    bad_ans.append((qid, f"答案 {a} 指向空 {name}[{i}]"))
        for name in ("optEn", "optZh"):
            for v in q.get(name) or []:
                if isinstance(v, str) and v.strip() in ("是", "乙", "甲", "丙", "丁"):
                    suspicious.append((qid, name, v))
        if not str(q.get("qZh", "")).strip() or not str(q.get("qEn", "")).strip():
            bad_core.append((qid, "qZh/qEn 为空"))
        if not str(q.get("sec", "")).strip() or not isinstance(q.get("ansIdx"), int):
            bad_core.append((qid, "sec/ansIdx 缺失"))
    ok(not bad_opt, "全库中英文选项均非空且各 4 项", f"异常 {len(bad_opt)} 处")
    for b in bad_opt[:8]:
        print("     ", b)
    ok(not bad_ans, "所有答案字母合法且指向非空选项", f"异常 {len(bad_ans)} 处")
    for b in bad_ans[:8]:
        print("     ", b)
    ok(not bad_core, "题干与结构字段齐全", f"异常 {len(bad_core)} 处")
    for b in bad_core[:8]:
        print("     ", b)
    ok(not suspicious, "选项里无「甲/乙/丙/丁/是」等天干误写残留",
       f"残留 {len(suspicious)} 处")
    for b in suspicious[:8]:
        print("     ", b)

    # ---- 4. 历史修复点逐题断言（防止改译文时误伤官方原题）----
    print("\n【四】关键修复点")
    t1 = qmap["T1B06"][0]
    ok(t1["optEn"][0] == "None", "T1B06 A(英文) = None（官方原题）",
       repr(t1["optEn"][0]))
    e1 = qmap["E1C12"][0]
    ok(e1["optEn"][0] == "None", "E1C12 A(英文) = None（官方原题）",
       repr(e1["optEn"][0]))
    g5 = qmap["G5A11"][0]
    ok(g5["optEn"] == ["Z", "X", "B", "Y"] and g5["ans"] == "B",
       "G5A11 选项 A.Z B.X C.B D.Y，答案 B", str(g5["optEn"]))
    e5 = qmap["E5B02"][0]
    ok(e5["optEn"] == ["G", "X", "Y", "B"] and e5["ans"] == "D",
       "E5B02 选项 A.G B.X C.Y D.B，答案 D", str(e5["optEn"]))
    ok(all(x.strip() for x in e5["optZh"]) and bool(e5["qZh"].strip()),
       "E5B02 中文题干与四项中文选项已补齐")

    # ---- 5. 与旧数据源彻底解绑：Excel 总表 + 数据库级更正 ----
    print("\n【五】旧数据源已彻底剥离")
    ok(not os.path.exists(os.path.join(BASE, "tools", "export_data.py")),
       "不再存在从 xlsx 生成题库的导出脚本")
    py = ""
    for fp in glob.glob(os.path.join(BASE, "tools", "*.py")):
        if os.path.basename(fp) == "verify_bank_data.py":
            continue  # 本脚本的断言文字里会出现这些关键词
        with open(fp, encoding="utf-8") as f:
            py += f.read()
    ok("openpyxl" not in py and "SRC_XLSX" not in py and "POOL_ERRATA" not in py,
       "tools 下无 openpyxl / 源表路径 / 官方勘误表依赖")
    ok("hs_bank_fixes" not in py and "bankfix" not in py,
       "tools 下无数据库级更正层残留")
    pkg = open(os.path.join(BASE, "package.json"), encoding="utf-8").read()
    ok("export_data.py" not in pkg, "package.json 不再有生成题库的 data 脚本")

    ok(not os.path.exists(os.path.join(BASE, "src", "stores", "bankfix.js")),
       "前端不再加载数据库级更正 store")
    ok(not glob.glob(os.path.join(BASE, "pb", "pb_migrations", "*hs_bank_fixes*")),
       "迁移里不再创建 hs_bank_fixes 集合")
    src_txt = ""
    for fp in (glob.glob(os.path.join(BASE, "src", "**", "*.js"), recursive=True) +
               glob.glob(os.path.join(BASE, "src", "**", "*.vue"), recursive=True)):
        with open(fp, encoding="utf-8") as f:
            src_txt += f.read()
    ok("hs_bank_fixes" not in src_txt and "useBankFixes" not in src_txt and
       "applyFix" not in src_txt,
       "前端题面只剩「JSON 原文 → hs_edits 人工修订」两层")

    # ---- 6. 数据投递：别让浏览器缓存把「已修复」挡在页面之外 ----
    print("\n【六】题库投递 / 缓存策略")
    bank_src = open(os.path.join(BASE, "src", "stores", "bank.js"), encoding="utf-8").read()
    app_src = open(os.path.join(BASE, "src", "App.vue"), encoding="utf-8").read()
    ok("cache: 'no-cache'" in bank_src and bank_src.count("DATA_FETCH") >= 3,
       "meta / q_*.json / refreshAll 三处请求均强制校验最新版")
    ok("async refreshAll()" in bank_src and "bank.refreshAll()" in app_src,
       "切回前台标签页会自动校验题库，长开页面也能看到修复")
    ok("sameShape" in bank_src and "Object.assign(old, nw)" in bank_src,
       "重算题面时原地写回，已打开页面持有的题目引用不会停在旧数据")
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        SITE = site_base()
        with opener.open(f"{SITE}/data/q_technician.json", timeout=3) as resp:
            cc = resp.headers.get("Cache-Control", "")
            etag = resp.headers.get("ETag", "")
        ok("no-cache" in cc.lower(),
           "nginx /data/ 不再强缓存（旧配置 1h 导致修复最长一小时不可见）", cc)
        ok(bool(etag), "题库响应仍带 ETag，未变更时走 304 不重复下载", etag)
        with opener.open(f"{SITE}/", timeout=3) as resp:
            cc_html = resp.headers.get("Cache-Control", "")
        ok("no-cache" in cc_html.lower(), "入口 index.html 也不强缓存", cc_html)
    except Exception as e:
        print("  · 站点未启动，跳过 HTTP 头校验：", e)

    # ---- 7. 配置收敛：端口只允许在 .env 一处定义 ----
    print("\n【七】端口配置已收敛到 .env")
    env_tpl = open(os.path.join(BASE, ".env.example"), encoding="utf-8").read()
    ok("PB_PORT=" in env_tpl and "SITE_PORT=" in env_tpl,
       ".env.example 把两个端口列为唯一来源")
    ok(os.path.exists(os.path.join(BASE, "tools", "config.py")),
       "统一配置模块 tools/config.py 存在")
    hs = open(os.path.join(BASE, "hamstudy"), encoding="utf-8").read()
    ok("${PB_PORT:-8199}" not in hs and "${SITE_PORT:-8091}" not in hs and
       '"$CFG" ports' in hs and 'eval "$CFG_PORTS"' in hs,
       "hamstudy 不再写死默认端口，改由 .env 派生")
    pa = open(os.path.join(BASE, "tools", "pb_admin.py"), encoding="utf-8").read()
    em = open(os.path.join(BASE, "tools", "_env.mjs"), encoding="utf-8").read()
    ok("PB_PORT" in pa and "PB_PORT" in em,
       "Python / Node 运维脚本都按 PB_PORT 派生直连地址")
    gi = open(os.path.join(BASE, ".gitignore"), encoding="utf-8").read()
    ok("deploy/*.generated.*" in gi,
       "渲染出的部署配置不会误入版本库")

    # ---- 结论 ----
    passed = sum(1 for x in results if x[0])
    total = len(results)
    print(f"\n结果: {passed}/{total} 通过")
    if passed != total:
        for good, name, detail in results:
            if not good:
                print("  失败项:", name, detail)
        sys.exit(1)


if __name__ == "__main__":
    main()
