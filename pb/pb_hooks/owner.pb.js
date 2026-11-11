// 强制把记录归属到当前登录用户，防止伪造 user 字段写入他人数据。
// 三个 hs_* 集合的 createRule 只校验「已登录」，真正的所有权在这里兜底。
//
// 踩过的坑，改这里之前务必先看：
//   1) onRecord*Request 是中间件钩子，必须 return e.next() 才能继续后续处理，
//      否则响应会被直接中断（日志表现为 status=0 且记录未落库）。
//   2) 想区分「普通用户 vs 管理员」时，千万别在钩子里做额外查询或读集合信息。
//      record.collectionName 在此版本恒为 undefined；record.collection()、record.get()
//      在管理员请求上调用会让请求直接 400；用 $app.findRecordById 查询 users 则会与
//      随后的写入抢 SQLite 锁，字段一多就崩，且服务端日志不留任何痕迹。
//      结论：这里只做最简单的一步——只要是已认证请求就把归属改写成自己。
//      管理员若要代管数据，请用普通用户身份登录操作，不要在后台面板里直接写。
//   3) 钩子脚本加载失败时 PocketBase 只是重启并忽略它，表现为「钩子静默失效」，
//      排查时先到服务日志里找 failed to execute 那一行。

var OWNED = ["hs_attempts", "hs_favorites", "hs_sessions"]

function forceOwner(e) {
  if (!e.auth || !e.auth.id) {
    // 未认证请求交给 API 规则处理
    return e.next()
  }
  e.record.set("user", e.auth.id)
  return e.next()
}

for (var i = 0; i < OWNED.length; i++) {
  onRecordCreateRequest(forceOwner, OWNED[i])
  onRecordUpdateRequest(forceOwner, OWNED[i])
}

// hs_edits 是共享的题库修订，不归谁私有；但最后改动必须落在当前登录者名下，
// 否则「谁把这条译文改成这样」就无从查起。
function stampAuthor(e) {
  if (e.auth && e.auth.id) e.record.set("author", e.auth.id)
  return e.next()
}

onRecordCreateRequest(stampAuthor, "hs_edits")
onRecordUpdateRequest(stampAuthor, "hs_edits")
