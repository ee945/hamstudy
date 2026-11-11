// 题库原文（三个 q_*.json）的服务端直写能力。
//
// 三个 JSON 是本站点唯一权威数据源，不再有任何 Excel 总表。管理员通过
// 「题库原文编辑」页直接改写它们；编辑员的 hs_edits / hs_edit_logs 修订流
// 保持独立叠加与留痕，本钩子不碰那两张表，也不产生任何历史版本或备份。
//
// 安全边界（改之前务必看完）：
//   1) 路由白名单：只认固定四个文件名，绝不接受路径参数，杜绝目录穿越。
//   2) 中间件 $apis.requireAuth("users", "_superusers") 由服务端校验 token
//      归属；handler 再要求站点 role = admin，或 PocketBase 超级管理员。
//      站点里 editor / 普通用户即便拿到接口地址也一律 403。
//   3) 字段白名单：只改 qZh/qEn/optZh/optEn/mnem/expl/diff，
//      id / sec / chapter / ans / ansIdx / rev / img 天然不会被触碰。
//   4) 写回前后都做结构断言；先全部校验通过再一次性写入完整 JSON，
//      写坏半个文件就等于把唯一权威源毁了。
//   5) 同时写 public/data（构建输入）与 dist/data（nginx 实际读取），
//      所以点保存立刻生效，不必再 npm run build。
//   6) 这个接口等于把本机文件写权限交给了站点管理员账号，
//      仅适用于本机 / 内网部署，不要把 8091 暴露到公网。
//
// 重要：PocketBase 的路由回调会在请求时独立的 goja 运行时中执行，
// 拿不到本文件顶层声明的函数或变量（实测报 ReferenceError: guard is not defined）。
// 因此所有 helper 必须内联在 handler 函数体内，不要抽到外面去。
// 钩子脚本是启动时加载的，改完本文件必须重启 PocketBase 才生效。

routerAdd("POST", "/bank/write", function (e) {
  // ---------------- 内联 helper（不可提到 handler 外） ----------------
  var BANK_FILES = {
    T: "q_technician.json",
    G: "q_general.json",
    E: "q_extra.json"
  }
  var ALL_FILES = ["meta.json", "q_technician.json", "q_general.json", "q_extra.json"]
  var EDITABLE = ["qZh", "qEn", "optZh", "optEn", "mnem", "expl", "diff"]
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k) }

  function rootDir() {
    var env = ""
    try { env = $os.getenv("HAMSTUDY_ROOT") || "" } catch (_) {}
    var cwd = ""
    try { cwd = $os.getwd() || "" } catch (_) {}
    // hamstudy start 以项目根为 cwd；npm run pb 则以 pb/ 为 cwd
    var candidates = [env, cwd, cwd + "/.."]
    for (var i = 0; i < candidates.length; i++) {
      var r = candidates[i]
      if (!r) continue
      try {
        $os.stat(r + "/public/data/q_technician.json")
        return r
      } catch (_) {}
    }
    return ""
  }

  function readDoc(path) {
    // $os.readFile 返回的是 UTF-8 字节数组（Array<number>），不是字符串。
    // 运行时内置的 toString() 会按 UTF-8 正确解码，直接 String(raw) 会得到
    // "123,34,..." 这种逗号拼接的字节串，中文题干会全毁。
    var raw = $os.readFile(path)
    return JSON.parse(typeof raw === "string" ? raw : toString(raw))
  }

  function writeDoc(path, doc) {
    // 一次写入完整 JSON。原先的 tmp + rename 在 dist/ 上覆盖已存在文件会
    // 被运行环境拒绝（EPERM），且会留下 .tmp 残片；这里的内容已经过完整
    // 结构校验，os.WriteFile 的截断写入足以避免半截文件。
    $os.writeFile(path, JSON.stringify(doc), 420)
  }

  // 返回 dist/data 是否也同步到了（尚未构建时只写 public/data）
  function writeBoth(root, name, doc) {
    writeDoc(root + "/public/data/" + name, doc)
    try {
      $os.stat(root + "/dist/data/" + name)
      writeDoc(root + "/dist/data/" + name, doc)
      return { ok: true, error: "" }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  function guard(event) {
    try { if (event.hasSuperuserAuth()) return true } catch (_) {}
    try {
      var a = event.auth
      return !!a && String(a.get("role") || "") === "admin"
    } catch (_) {
      return false
    }
  }

  // Go map 转纯 JS 对象，避免 goja 里数组 / 字典的行为差异
  function body(event) {
    try { return JSON.parse(JSON.stringify(event.requestInfo().body)) || {} }
    catch (_) { return {} }
  }

  function arr4(v) {
    if (!v || typeof v.length !== "number" || v.length !== 4) return null
    var out = []
    for (var i = 0; i < 4; i++) {
      if (typeof v[i] !== "string" || !v[i].trim()) return null
      out.push(v[i])
    }
    return out
  }

  function validatePatch(p) {
    var out = {}
    for (var i = 0; i < EDITABLE.length; i++) {
      var k = EDITABLE[i]
      if (!has(p, k)) continue
      var v = p[k]
      if (k === "optZh" || k === "optEn") {
        var a = arr4(v)
        if (!a) return { error: k + " 必须是 4 项非空字符串数组" }
        out[k] = a
      } else if (k === "diff") {
        var n = Number(v)
        if (!isFinite(n) || n < 0 || n > 10) return { error: "diff 必须是 0–10 的数字" }
        out[k] = n
      } else {
        if (typeof v !== "string") return { error: k + " 必须是字符串" }
        out[k] = v
      }
    }
    return { patch: out }
  }

  function validateDoc(name, doc) {
    if (!doc || typeof doc !== "object") return "文件内容不是对象"
    if (name === "meta.json") {
      return (typeof doc.levels !== "undefined" && doc.levels.length === 3) ? "" : "meta.json 缺少三个级别"
    }
    if (typeof doc.qs === "undefined" || typeof doc.qs.length !== "number" || !doc.qs.length) {
      return name + " 缺少非空 qs 数组"
    }
    var seen = {}
    for (var i = 0; i < doc.qs.length; i++) {
      var q = doc.qs[i]
      if (!q || typeof q.id !== "string" || !q.id) return name + " 存在无题号的题目"
      if (seen[q.id]) return name + " 题号重复：" + q.id
      seen[q.id] = 1
      if (!String(q.qZh || "").trim() || !String(q.qEn || "").trim()) return q.id + " 题干为空"
      if (!arr4(q.optZh) || !arr4(q.optEn)) return q.id + " 选项不是 4 项非空"
      if (String(q.ans || "").length !== 1 || "ABCD".indexOf(q.ans) < 0) return q.id + " 答案非法"
      if (!String(q.sec || "").trim()) return q.id + " 缺少小节"
    }
    return ""
  }

  // ---------------- 请求分发 ----------------
  if (!guard(e)) return e.json(403, { ok: false, error: "仅管理员可直接改写题库原文" })
  var root = rootDir()
  if (!root) return e.json(500, { ok: false, error: "未找到题库目录（public/data）" })
  var b = body(e)

  // 整份备份恢复：把导出的题库备份写回服务器，用于数据库 / 站点故障后重建
  if (b.action === "restore") {
    if (b.kind !== "hamstudy-bank-backup" || !b.files) {
      return e.json(400, { ok: false, error: "不是有效的题库备份文件" })
    }
    var pending = []
    for (var i = 0; i < ALL_FILES.length; i++) {
      var name = ALL_FILES[i]
      if (!has(b.files, name)) continue
      var err = validateDoc(name, b.files[name])
      if (err) return e.json(400, { ok: false, error: err })
      pending.push([name, b.files[name]])
    }
    if (!pending.length) return e.json(400, { ok: false, error: "备份里没有可恢复的题库文件" })
    try {
      var restored = []
      for (var j = 0; j < pending.length; j++) {
        writeBoth(root, pending[j][0], pending[j][1])
        restored.push(pending[j][0])
      }
      return e.json(200, { ok: true, restored: restored })
    } catch (err) {
      return e.json(500, { ok: false, error: String(err) })
    }
  }

  // 单题写回：管理员在编辑页改完一道题点保存
  var qid = String(b.qid || "").trim().toUpperCase()
  var file = BANK_FILES[qid.charAt(0)]
  if (!file) return e.json(400, { ok: false, error: "题号无效：" + qid })

  var checked = validatePatch(b.fields || {})
  if (checked.error) return e.json(400, { ok: false, error: checked.error })
  if (!Object.keys(checked.patch).length) return e.json(400, { ok: false, error: "没有需要保存的字段" })

  try {
    var path = root + "/public/data/" + file
    var doc = readDoc(path)
    var idx = -1
    for (var m = 0; m < doc.qs.length; m++) {
      if (doc.qs[m].id === qid) { idx = m; break }
    }
    if (idx < 0) return e.json(404, { ok: false, error: "题库中找不到 " + qid })

    var q = doc.qs[idx]
    for (var k in checked.patch) {
      if (has(checked.patch, k)) q[k] = checked.patch[k]
    }
    if (!String(q.qZh || "").trim() || !String(q.qEn || "").trim()) {
      return e.json(400, { ok: false, error: "题干中英文不能为空" })
    }
    var w = writeBoth(root, file, doc)
    return e.json(200, { ok: true, qid: qid, file: file, distSynced: w.ok, distError: w.error })
  } catch (err) {
    return e.json(500, { ok: false, error: String(err) })
  }
}, $apis.requireAuth("users", "_superusers"))
