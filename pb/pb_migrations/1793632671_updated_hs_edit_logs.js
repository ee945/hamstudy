/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2324438201")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @request.body.userId = @request.auth.id && ((@request.auth.role = \"editor\" && (@request.body.action = \"submit\" || @request.body.action = \"withdraw\")) || (@request.auth.role = \"admin\" && @request.body.action != \"submit\"))"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2324438201")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @request.body.userId = @request.auth.id && ((@request.auth.role = \"editor\" && @request.body.action = \"submit\") || (@request.auth.role = \"admin\" && @request.body.action != \"submit\"))"
  }, collection)

  return app.save(collection)
})
