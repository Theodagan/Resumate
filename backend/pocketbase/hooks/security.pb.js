// Privileged users fields may only be changed by superusers. The users update rule
// lets owners edit their own record, so without this guard any user could PATCH
// isMcpServiceAccount=true and match every service-account clause in the API rules.
// Handlers run in isolated JSVM contexts, so the field list is declared inline.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const record = e.record;
  if (!record) {
    throw new BadRequestError('User record is missing.');
  }

  const collection = record.collection();
  for (const fieldName of ['isMcpServiceAccount', 'bypassBilling', 'subscriptionStatus', 'stripeCustomerId', 'stripeSubscriptionId']) {
    if (!collection.fields.getByName(fieldName)) continue;

    const value = record.get(fieldName);
    if (value !== null && value !== undefined && value !== false && value !== '') {
      throw new ForbiddenError('You cannot set this field.');
    }
  }

  return e.next();
}, 'users');

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const record = e.record;
  if (!record) {
    throw new BadRequestError('User record is missing.');
  }

  const original = record.original();
  const collection = record.collection();
  for (const fieldName of ['isMcpServiceAccount', 'bypassBilling', 'subscriptionStatus', 'stripeCustomerId', 'stripeSubscriptionId']) {
    if (!collection.fields.getByName(fieldName)) continue;

    if (record.getString(fieldName) !== original.getString(fieldName)) {
      throw new ForbiddenError('You cannot change this field.');
    }
  }

  return e.next();
}, 'users');

// Owned material records must never be handed to another user on update. The
// update rules only check the stored owner, not @request.body.user.
onRecordUpdateRequest((e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentication required.');
  }

  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const record = e.record;
  if (!record) {
    throw new BadRequestError('Record is missing.');
  }

  if (record.getString('user') !== record.original().getString('user')) {
    throw new ForbiddenError('You cannot change the owner of this record.');
  }

  return e.next();
}, 'jobs', 'skills', 'projects', 'achievements', 'degrees', 'hobbies', 'files', 'skill_categories');

onRecordCreateRequest((e) => {
  try {
    if (!e.auth) {
      throw new UnauthorizedError('Authentication required.');
    }

    const hasSuperuserAccess = e.hasSuperuserAuth();
    const record = e.record;
    if (!record) {
      throw new BadRequestError('CV profile record is missing.');
    }

    const requestedOwnerId = record.getString('user');
    const isMcpServiceAccount = e.auth.getBool('isMcpServiceAccount');
    const assertImageAssetsBelongToOwner = () => {
      const ownerId = record.getString('user');

      for (const fieldName of ['profilePictureFile', 'coverPictureFile']) {
        const fileId = record.getString(fieldName);

        if (!fileId) {
          continue;
        }

        let file;
        try {
          file = $app.findRecordById('files', fileId);
        } catch {
          throw new ForbiddenError('CV profile image assets must belong to the profile owner.');
        }

        if (!file || file.getString('user') !== ownerId) {
          throw new ForbiddenError('CV profile image assets must belong to the profile owner.');
        }
      }
    };

    if (hasSuperuserAccess) {
      return e.next();
    }

    if (isMcpServiceAccount && requestedOwnerId) {
      assertImageAssetsBelongToOwner();
      return e.next();
    }

    record.set('user', e.auth.id);
    assertImageAssetsBelongToOwner();
    return e.next();
  } catch (error) {
    console.error('[cv_profiles] Create hook failed:', error?.message || error);
    throw error;
  }
}, 'cv_profiles');

onRecordUpdateRequest((e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentication required.');
  }

  const hasSuperuserAccess = e.hasSuperuserAuth();
  const record = e.record;
  if (!record) {
    throw new BadRequestError('CV profile record is missing.');
  }

  // e.record already carries the request body; the stored owner lives on original().
  const currentOwnerId = record.original().getString('user');
  const isMcpServiceAccount = e.auth.getBool('isMcpServiceAccount');

  if (!hasSuperuserAccess && !isMcpServiceAccount && currentOwnerId && currentOwnerId !== e.auth.id) {
    throw new ForbiddenError('You cannot edit another user\'s CV profile.');
  }

  if (!hasSuperuserAccess && isMcpServiceAccount && record.getString('user') !== currentOwnerId) {
    throw new ForbiddenError('You cannot change the owner of a CV profile.');
  }

  if (!hasSuperuserAccess && !isMcpServiceAccount) {
    record.set('user', e.auth.id);
  }
  const ownerId = record.getString('user');

  for (const fieldName of ['profilePictureFile', 'coverPictureFile']) {
    const fileId = record.getString(fieldName);

    if (!fileId) {
      continue;
    }

    let file;
    try {
      file = $app.findRecordById('files', fileId);
    } catch {
      throw new ForbiddenError('CV profile image assets must belong to the profile owner.');
    }

    if (!file || file.getString('user') !== ownerId) {
      throw new ForbiddenError('CV profile image assets must belong to the profile owner.');
    }
  }

  return e.next();
}, 'cv_profiles');

onRecordCreateRequest((e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentication required.');
  }

  const record = e.record;
  if (!record) {
    throw new BadRequestError('API key record is missing.');
  }

  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  record.set('user', e.auth.id);
  record.set('status', 'active');
  record.set('lastUsedAt', null);
  return e.next();
}, 'ai_tokens');

onRecordUpdateRequest((e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentication required.');
  }

  const record = e.record;
  if (!record) {
    throw new BadRequestError('API key record is missing.');
  }

  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  // e.record already carries the request body; the stored values live on original().
  const original = record.original();
  const currentOwnerId = original.getString('user');
  const isMcpServiceAccount = e.auth.getBool('isMcpServiceAccount');

  if (!isMcpServiceAccount && currentOwnerId && currentOwnerId !== e.auth.id) {
    throw new ForbiddenError('You cannot edit another user\'s API key.');
  }

  // Key material, ownership and expiry are fixed at creation, and revocation is
  // final: a stolen session must not be able to re-enable a revoked key.
  for (const fieldName of ['user', 'token_hash', 'token_prefix', 'expiresAt']) {
    if (record.getString(fieldName) !== original.getString(fieldName)) {
      throw new ForbiddenError('You cannot change this API key field.');
    }
  }

  if (original.getString('status') === 'revoked' && record.getString('status') !== 'revoked') {
    throw new ForbiddenError('A revoked API key cannot be re-activated.');
  }

  return e.next();
}, 'ai_tokens');

onRecordCreateRequest((e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentication required.');
  }
  if (!e.hasSuperuserAuth()) {
    e.record.set('user', e.auth.id);
  }
  return e.next();
}, 'profile_metadata');

onRecordUpdateRequest((e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentication required.');
  }
  if (!e.hasSuperuserAuth()) {
    e.record.set('user', e.auth.id);
  }
  return e.next();
}, 'profile_metadata');

onRecordCreateRequest((e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentication required.');
  }

  const record = e.record;
  if (!record) {
    throw new BadRequestError('Project record is missing.');
  }

  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  record.set('user', e.auth.id);
  return e.next();
}, 'projects');

onRecordUpdateRequest((e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentication required.');
  }

  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  return e.next();
}, 'projects');

// File fields are unprotected at the schema level because some CV images must
// remain viewable without a login. Enforce the actual per-record policy here:
// only owners (with a short-lived file token) and images used by a public CV.
onFileDownloadRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();

  const collection = e.collection.name;
  const field = e.fileField.name;
  const record = e.record;
  const ownerId = collection === 'users' ? record.id : record.getString('user');
  const allowedFields = {
    users: ['avatar', 'profilePicture', 'coverPicture'],
    cv_profiles: ['profilePicture', 'coverPicture'],
    files: ['file'],
    projects: ['picture'],
    skills: ['icon'],
  };

  if (!ownerId || !allowedFields[collection]?.includes(field)) {
    throw new NotFoundError('File not found.');
  }

  const token = e.requestInfo().query.token;
  if (token) {
    try {
      const fileAuth = $app.findAuthRecordByToken(token, 'file');
      if (fileAuth.id === ownerId || fileAuth.isSuperuser()) return e.next();
    } catch (_) {
      // Invalid, expired or unrelated file token: fall through to public CV policy.
    }
  }

  // Direct API clients can also use their Authorization header; img tags use
  // the short-lived ?token= URL above because browsers don't attach the SDK JWT.
  if (e.auth?.id === ownerId) return e.next();

  // Don't expose PDFs (or arbitrary uploads mislabeled as images) through a
  // public CV relation. Only images selected on that owner's public CV qualify.
  if (!/\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(e.servedName) ||
      (collection === 'files' && record.getString('kind') !== 'image')) {
    throw new NotFoundError('File not found.');
  }

  let publicProfiles;
  try {
    publicProfiles = $app.findRecordsByFilter(
      'cv_profiles', 'public = true && user = {:owner}', '', 0, 0, { owner: ownerId },
    );
  } catch (_) {
    throw new NotFoundError('File not found.');
  }

  const selected = (profile, relation) => Array.from(profile.get(relation) || []);
  let publicImage = false;
  if (collection === 'cv_profiles') {
    publicImage = record.getBool('public');
  } else if (collection === 'users') {
    // The CV response includes these two identity images, but not the avatar.
    publicImage = field !== 'avatar' && publicProfiles.length > 0;
  } else if (collection === 'projects' || collection === 'skills') {
    publicImage = publicProfiles.some((profile) => selected(profile, collection).includes(record.id));
  } else if (collection === 'files') {
    publicImage = publicProfiles.some((profile) => {
      if (profile.getString('profilePictureFile') === record.id ||
          profile.getString('coverPictureFile') === record.id) return true;

      return selected(profile, 'projects').some((projectId) => {
        try {
          const project = $app.findRecordById('projects', projectId);
          return project.getString('user') === ownerId && project.getString('file') === record.id;
        } catch (_) {
          return false;
        }
      });
    });
  }

  if (!publicImage) throw new NotFoundError('File not found.');
  return e.next();
});

// A public CV record is readable through PocketBase's built-in view endpoint,
// not just the custom by-slug response. Keep dashboard-only metadata private
// across built-in view, list, expansions and realtime enrichments.
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!e.requestInfo.hasSuperuserAuth() &&
      auth?.id !== e.record.getString('user') &&
      !auth?.getBool('isMcpServiceAccount')) {
    e.record.hide('label');
    e.record.hide('status');
  }
  return e.next();
}, 'cv_profiles');

onRecordCreateRequest((e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentication required.');
  }

  const record = e.record;
  if (!record) {
    throw new BadRequestError('Achievement record is missing.');
  }

  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  record.set('user', e.auth.id);
  return e.next();
}, 'achievements');

onRecordUpdateRequest((e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentication required.');
  }

  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  return e.next();
}, 'achievements');

const revokeAiTokenHandler = (e) => {
  const id = e.request.pathValue('id');
  const auth = e.auth;
  if (!auth) {
    throw new UnauthorizedError('Authentication required.');
  }

  let record;
  try {
    record = $app.findRecordById('ai_tokens', id);
  } catch (_) {
    throw new NotFoundError('API key not found.');
  }

  const ownerId = record.getString('user');
  if (ownerId !== auth.id && !e.hasSuperuserAuth()) {
    throw new ForbiddenError('Not your API key.');
  }

  if (record.getString('status') === 'revoked') {
    return e.json(200, { id: record.id, status: 'revoked', message: 'Already revoked.' });
  }

  record.set('status', 'revoked');

  try {
    $app.save(record);
  } catch (saveError) {
    console.error('[ai-tokens] Revoke save failed:', saveError?.message || saveError);
    throw new BadRequestError('Failed to revoke API key.');
  }

  const saved = $app.findRecordById('ai_tokens', id);
  const savedStatus = saved.getString('status');
  if (savedStatus !== 'revoked') {
    console.error('[ai-tokens] Revoke verification failed: status=' + savedStatus);
    throw new BadRequestError('Failed to revoke API key.');
  }

  console.log('[ai-tokens] API key revoked successfully:', id);
  return e.json(200, { id: record.id, status: 'revoked' });
};

routerAdd('POST', '/api/custom/ai-tokens/{id}/revoke', revokeAiTokenHandler);
routerAdd('PATCH', '/api/custom/ai-tokens/{id}/revoke', revokeAiTokenHandler);

const getPublicCvDataBySlugHandler = (e) => {
  const toArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;

    try {
      return Array.from(value);
    } catch (_) {
      return [];
    }
  };

  const serializeRecord = (record, fieldNames) => {
    // The SDK needs collectionId to turn file names in this custom response
    // into download URLs (including those of expanded public CV images).
    const result = { id: record.id, collectionId: record.collection().id, collectionName: record.collection().name };

    for (const fieldName of fieldNames) {
      result[fieldName] = record.get(fieldName);
    }

    return result;
  };

  const findLinkedRecords = (collectionName, ids, fieldNames, ownerId) => {
    const records = [];

    for (const id of ids) {
      try {
        const record = $app.findRecordById(collectionName, id);
        const recordOwnerId = record.getString('user');

        if (recordOwnerId && recordOwnerId !== ownerId) continue;

        records.push(serializeRecord(record, fieldNames));
      } catch (_) {
        // Keep public rendering resilient to stale relation ids.
      }
    }

    return records;
  };

  const slug = e.request.pathValue('slug');
  let profileRecord;

  try {
    profileRecord = $app.findFirstRecordByFilter('cv_profiles', 'slug={:slug}', { slug });
  } catch (_) {
    throw new NotFoundError('CV profile not found.');
  }

  const ownerId = profileRecord.getString('user');
  const isOwner = !!e.auth && e.auth.id === ownerId;
  const isPublic = profileRecord.getBool('public');

  if (!isPublic && !isOwner) {
    if (!e.auth) {
      throw new UnauthorizedError('Authentication required.');
    }

    throw new ForbiddenError('Not your CV profile.');
  }

  const profile = serializeRecord(profileRecord, [
    'slug',
    'label',
    'profileName',
    'template',
    'public',
    'user',
    'professionalSummary',
    'achievements',
    'projects',
    'hobbies',
    'jobs',
    'degrees',
    'skills',
    'profilePicture',
    'coverPicture',
    'profilePictureFile',
    'coverPictureFile',
    'extra',
    'linkOverrides',
    'status',
    'updated_at',
  ]);

  const publicProfile = serializeRecord(profileRecord, [
    'slug',
    'profileName',
    'template',
    'public',
    'professionalSummary',
    'profilePicture',
    'coverPicture',
    'extra',
    'linkOverrides',
    'updated_at',
  ]);

  const canSeeInternalProfileFields = isOwner || e.hasSuperuserAuth() || e.auth?.getBool('isMcpServiceAccount');
  const responseProfile = canSeeInternalProfileFields ? profile : publicProfile;

  responseProfile.expand = {};
  for (const fieldName of ['profilePictureFile', 'coverPictureFile']) {
    if (!profile[fieldName]) continue;

    try {
      const fileRecord = $app.findRecordById('files', profile[fieldName]);
      if (fileRecord.getString('user') !== ownerId) continue;

      responseProfile.expand[fieldName] = serializeRecord(
        fileRecord,
        isOwner ? ['user', 'name', 'file', 'alt', 'kind', 'sortOrder'] : ['name', 'file', 'alt', 'kind', 'sortOrder'],
      );
    } catch (_) {
      // Missing image relations should not block rendering the rest of the CV.
    }
  }

  let user = null;
  try {
    const userRecord = $app.findRecordById('users', ownerId);
    // Contact PII (email/phone) is only exposed to the owner, or publicly when the
    // owner has opted in via emailVisibility. Otherwise anonymous viewers of a public
    // CV would be able to scrape every owner's direct contact details.
    const exposeContact = isOwner || userRecord.getBool('emailVisibility');
    const userFields = ['firstName', 'lastName', 'linkedin', 'github', 'website', 'profilePicture', 'coverPicture'];
    if (exposeContact) {
      userFields.push('email', 'phone');
    }
    user = serializeRecord(userRecord, userFields);
  } catch (_) {
    user = null;
  }

  return e.json(200, {
    profile: responseProfile,
    user,
    jobs: findLinkedRecords('jobs', toArray(profile.jobs), [
      ...(isOwner ? ['user'] : []),
      'label',
      'company',
      'position',
      'location',
      'startDate',
      'endDate',
      'responsibilities',
      'bulletPointSummary',
      'sortOrder',
      'type',
      'skills',
      'projects',
      'achievements',
    ], ownerId),
    projects: findLinkedRecords('projects', toArray(profile.projects), [
      ...(isOwner ? ['user'] : []),
      'name',
      'description',
      'url',
      'date',
      'picture',
      'type',
      'file',
      'sortOrder',
      'achievements',
    ], ownerId),
    skills: findLinkedRecords('skills', toArray(profile.skills), [...(isOwner ? ['user'] : []), 'name', 'category', 'type', 'level', 'sortOrder', 'icon'], ownerId),
    degrees: findLinkedRecords('degrees', toArray(profile.degrees), [...(isOwner ? ['user'] : []), 'title', 'school', 'year', 'level', 'sortOrder'], ownerId),
    achievements: findLinkedRecords('achievements', toArray(profile.achievements), [...(isOwner ? ['user'] : []), 'title', 'description', 'sortOrder'], ownerId),
    hobbies: findLinkedRecords('hobbies', toArray(profile.hobbies), [...(isOwner ? ['user'] : []), 'name', 'description', 'sortOrder'], ownerId),
  });
};

routerAdd('GET', '/api/custom/cv-data/by-slug/{slug}', getPublicCvDataBySlugHandler);

onRecordsListRequest((e) => {
  try {
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = new Date(Date.now() - twoWeeksMs);

    for (const record of e.records ?? []) {
      if (record.getString('status') !== 'sent') continue;

      const updatedAt = record.getDateTime('updated_at');
      if (!updatedAt) continue;

      const updatedAtDate = new Date(updatedAt);
      if (Number.isNaN(updatedAtDate.getTime()) || updatedAtDate >= twoWeeksAgo) continue;

      record.set('status', 'unanswered');
      try {
        $app.save(record);
        console.log('[cv_profiles] Auto-transitioned to unanswered:', record.id);
      } catch (err) {
        console.error('[cv_profiles] Auto-transition failed for', record.id, ':', err?.message || err);
      }
    }
  } catch (err) {
    console.error('[cv_profiles] Auto-transition hook error:', err?.message || err);
  }

  return e.next();
}, 'cv_profiles');
