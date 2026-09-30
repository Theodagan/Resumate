/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_');
    users.fields.add(new Field({ id: 'boolmcpaccesscv1', name: 'mcpCvEnabled', type: 'bool' }));
    users.fields.add(new Field({ id: 'boolmcpaccessmt1', name: 'mcpMaterialsEnabled', type: 'bool' }));
    // 1779072000 reset users reads to owner-only. The existing MCP service user
    // needs to read account preferences for both API keys and OAuth sessions.
    users.listRule = '@request.auth.id != "" && (id = @request.auth.id || @request.auth.isMcpServiceAccount = true)';
    users.viewRule = users.listRule;
    app.save(users);

    // PocketBase Boolean fields default to false. Preserve existing CV connections.
    for (const user of app.findAllRecords('_pb_users_auth_')) {
      user.set('mcpCvEnabled', true);
      user.set('mcpMaterialsEnabled', false);
      app.save(user);
    }
  },
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_');
    users.fields.removeByName('mcpCvEnabled');
    users.fields.removeByName('mcpMaterialsEnabled');
    users.listRule = '@request.auth.id != "" && id = @request.auth.id';
    users.viewRule = users.listRule;
    app.save(users);
  },
);
