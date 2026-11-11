# -*- coding: utf-8 -*-
"""把云端的人工修订固化回题库 JSON。

页面里改的译文/选项/难度/要点/解析存在 PocketBase 的 hs_edits 里，
服务运行时动态叠加；本脚本把它们写回 public/data/q_*.json，
让题库文件本身就是最新内容 —— 重新构建、换机部署都不会丢改动。

用法：
    python3 tools/apply_edits.py            # 先备份再写回
    python3 tools/apply_edits.py --dry-run  # 只看会改哪些题，不动文件

环境：PB_URL（默认 http://127.0.0.1:8199）、PB_ADMIN、PB_ADMIN_PWD
"""
import json, os, sys, time, urllib.request, urllib.error, urllib.parse, shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pb_admin  # noqa: E402

PB = pb_admin.PB
ADMIN_EMAIL = pb_admin.ADMIN_EMAIL
ADMIN_PWD = pb_admin.ADMIN_PWD

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
SLUGS = ["technician", "general", "extra"]

# 云端字段 -> 题库字段
SCALAR = {"qzh": "qZh", "qen": "qEn", "mnem": "mnem", "expl": "expl"}
ARRAYS = {"optzh": "optZh", "opten": "optEn"}

DRY = "--dry-run" in sys.argv


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
        sys.exit(f"[ERROR] {method} {path} -> {e.code}\n{e.read().decode()[:600]}")


def admin_token():
    return req("/api/collections/_superusers/auth-with-password", "POST",
               {"identity": ADMIN_EMAIL, "password": ADMIN_PWD})["token"]


def has(v):
    """云端取值是否有实质内容：空串 / 空数组 / 0 都表示沿用原文"""
    if v is None:
        return False
    if isinstance(v, list):
        return any(str(x or "").strip() for x in v)
    if isinstance(v, (int, float)):
        return float(v) > 0
    return bool(str(v).strip())


def fetch_edits(token):
    out, page = [], 1
    while True:
        d = req(f"/api/collections/hs_edits/records?perPage=500&page={page}&sort=qid", token=token)
        items = d.get("items", [])
        out.extend(items)
        if page >= d.get("totalPages", 1) or not items:
            break
        page += 1
    return out


def main():
    token = admin_token()
    edits = fetch_edits(token)
    print(f"云端修订 {len(edits)} 条")

    if not edits:
        print("没有需要固化的修订。")
        return

    by_file = {}          # slug -> list of edit records
    unknown = []
    for e in edits:
        qid = str(e.get("qid") or "").strip()
        c = qid[:1].upper()
        slug = {"T": "technician", "G": "general", "E": "extra"}.get(c)
        if slug:
            by_file.setdefault(slug, []).append(e)
        else:
            unknown.append(qid)

    # 备份
    if not DRY:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        bdir = os.path.join(ROOT, "data_backup", stamp)
        os.makedirs(bdir, exist_ok=True)
        for s in SLUGS:
            src = os.path.join(DATA, f"q_{s}.json")
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(bdir, f"q_{s}.json"))
        print(f"已备份到 data_backup/{stamp}/")

    total_changed = 0
    for slug in SLUGS:
        path = os.path.join(DATA, f"q_{slug}.json")
        if not os.path.exists(path):
            print(f"· 跳过 {slug}（文件不存在）")
            continue
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        qs = doc.get("qs", [])
        index = {q["id"]: q for q in qs}

        changed = 0
        missing = []
        for e in by_file.get(slug, []):
            qid = str(e.get("qid") or "").strip()
            q = index.get(qid)
            if not q:
                missing.append(qid)
                continue
            n = 0
            for k, qk in SCALAR.items():
                if has(e.get(k)):
                    q[qk] = str(e[k]).strip()
                    n += 1
            for k, qk in ARRAYS.items():
                v = e.get(k) or []
                if isinstance(v, list) and has(v):
                    q[qk] = [str(x or "").strip() for x in v]
                    n += 1
            if has(e.get("diff")):
                q["diff"] = int(e["diff"])
                n += 1
            if n:
                changed += 1
                print(f"  · {qid} 改了 {n} 处")

        print(f"{slug}: {changed} 题被更新" + (f"，{len(missing)} 个题号没找到：{missing}" if missing else ""))
        total_changed += changed
        if not DRY and changed:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, path)

    if unknown:
        print(f"题号无法识别，已忽略：{unknown}")
    print(f"\n{'[预演] ' if DRY else ''}共更新 {total_changed} 题")
    if not DRY and total_changed:
        print("题库文件已写回。云端副本保留着，下次重跑结果一致（幂等）。")


if __name__ == "__main__":
    main()
