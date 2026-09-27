/// <reference path="../pb_data/types.d.ts" />

// Owners may edit their own users record, but never the MCP service-account flag:
// every service clause in the API rules trusts @request.auth.isMcpServiceAccount,
// so a self-set flag would grant cross-tenant access. Superusers bypass rules and
// keep provisioning the service account. hooks/security.pb.js enforces the same
// guard (plus billing fields) as a second layer.

const USERS_COLLECTION_ID = '_pb_users_auth_';
const PREVIOUS_UPDATE_RULE = '@request.auth.id != "" && id = @request.auth.id';
const HARDENED_UPDATE_RULE = '@request.auth.id != "" && id = @request.auth.id && @request.body.isMcpServiceAccount:isset = false';

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId(USERS_COLLECTION_ID);
    users.updateRule = HARDENED_UPDATE_RULE;
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId(USERS_COLLECTION_ID);
    users.updateRule = PREVIOUS_UPDATE_RULE;
    app.save(users);
  },
);
