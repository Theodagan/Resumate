/// <reference path="../pb_data/types.d.ts" />

const OWNER_CREATE = '@request.auth.id != "" && @request.body.user = @request.auth.id';
const OWNER_UPDATE = '@request.auth.id != "" && user = @request.auth.id';
const SERVICE_CREATE = '@request.auth.id != "" && (@request.body.user = @request.auth.id || @request.auth.isMcpServiceAccount = true)';
const SERVICE_UPDATE = '@request.auth.id != "" && (user = @request.auth.id || @request.auth.isMcpServiceAccount = true)';

migrate(
  (app) => {
    for (const name of ['projects', 'achievements', 'skills', 'jobs', 'degrees', 'hobbies']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.createRule = SERVICE_CREATE;
      collection.updateRule = SERVICE_UPDATE;
      app.save(collection);
    }
  },
  (app) => {
    for (const name of ['projects', 'achievements', 'skills', 'jobs', 'degrees', 'hobbies']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.createRule = OWNER_CREATE;
      collection.updateRule = OWNER_UPDATE;
      app.save(collection);
    }
  },
);
