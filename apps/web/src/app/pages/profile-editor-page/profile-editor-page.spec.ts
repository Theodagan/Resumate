import { TestBed } from '@angular/core/testing';
import { PocketBaseService } from '../../core/services/pocketbase.service';
import { ProfileEditorPage } from './profile-editor-page';

describe('ProfileEditorPage', () => {
  let component: ProfileEditorPage;
  let pocketBaseService: { updateCurrentUserCvProfile: jest.Mock; getCurrentUserCvProfileEditorData: jest.Mock };

  beforeEach(() => {
    pocketBaseService = {
      updateCurrentUserCvProfile: jest.fn().mockResolvedValue({}),
      getCurrentUserCvProfileEditorData: jest.fn().mockResolvedValue(editorData()),
    };

    TestBed.configureTestingModule({
      providers: [{ provide: PocketBaseService, useValue: pocketBaseService }],
    });

    component = TestBed.runInInjectionContext(() => new ProfileEditorPage());
    component.editorState.set(state());
  });

  afterEach(() => {
    component.ngOnDestroy();
    jest.useRealTimers();
  });

  it('adds and removes relation ids without duplicating them', () => {
    component.addRelation('jobs', 'job-2');
    component.addRelation('jobs', 'job-2');
    expect(component.editorState()?.profile.jobs).toEqual(['job-1', 'job-2']);

    component.removeRelation('jobs', 'job-1');
    expect(component.editorState()?.profile.jobs).toEqual(['job-2']);
  });

  it('sets professional summary', () => {
    component.setProfessionalSummary('New summary');
    expect(component.editorState()?.profile.professionalSummary).toBe('New summary');
    component.setProfessionalSummary('');
    expect(component.editorState()?.profile.professionalSummary).toBeUndefined();
  });

  it('sets link override field', () => {
    component.setLinkOverrideField('github', 'https://github.com/test');
    expect(component.editorState()?.profile.linkOverrides?.github).toBe('https://github.com/test');
    component.setLinkOverrideField('github', '');
    expect(component.editorState()?.profile.linkOverrides?.github).toBeUndefined();
  });

  it('sets status', () => {
    component.setStatus('sent');
    expect(component.editorState()?.profile.status).toBe('sent');
  });

  it('autosaves profile fields with a focused payload', async () => {
    component.editorState.update((current) => ({
      ...current!,
      profile: {
        ...current!.profile,
        label: 'Updated label',
        profileName: 'Updated name',
        template: 'modern',
        public: false,
        status: 'sent',
        profilePictureFile: 'picture-2',
        coverPictureFile: 'picture-3',
      },
    }));

    await component.saveProfileFields();

    expect(pocketBaseService.updateCurrentUserCvProfile).toHaveBeenCalledWith('profile-1', expect.objectContaining({
      label: 'Updated label',
      profileName: 'Updated name',
      public: false,
      template: 'modern',
      profilePictureFile: 'picture-2',
      coverPictureFile: 'picture-3',
      status: 'sent',
      jobs: ['job-1'],
      projects: ['project-1'],
      skills: ['skill-1'],
      degrees: ['degree-1'],
      achievements: ['achievement-1'],
      hobbies: ['hobby-1'],
      extra: { classic: { hero: 'Existing hero', visible: true, featuredProjects: ['project-1'] } },
    }));
    expect(pocketBaseService.getCurrentUserCvProfileEditorData).toHaveBeenCalledWith('profile-1');
    expect(component.profileSaveMessage()).toBe('Profil CV enregistre.');
  });

  it('rejects profile autosave when profile name is blank', async () => {
    component.setProfileName('   ');

    await component.saveProfileFields();

    expect(component.errorMessage()).toBe('Le nom du profil est obligatoire.');
    expect(pocketBaseService.updateCurrentUserCvProfile).not.toHaveBeenCalled();
  });

  it('gets status option for known and unknown statuses', () => {
    const opt = component.getStatusOption('sent');
    expect(opt).toBeDefined();
    const unsent = component.getStatusOption(undefined);
    expect(unsent?.value).toBe('unsent');
    const unknown = component.getStatusOption('nonexistent' as never);
    expect(unknown).toBeUndefined();
  });

  it('reads and writes template extra values', () => {
    const field = { id: 'hero', label: 'Hero', type: 'text' } as never;
    const sourceField = { id: 'featuredProjects', label: 'Featured projects', type: 'source-list', source: 'projects' } as never;
    const current = component.editorState()!;

    expect(component.getExtraTextValue(current, field)).toBe('Existing hero');
    expect(component.getExtraBooleanValue(current, { id: 'visible' } as never)).toBe(true);
    expect(component.getExtraStringArrayValue(current, sourceField)).toEqual(['project-1']);

    component.setExtraValue(field, 'Updated hero');
    expect(component.getExtraTextValue(component.editorState()!, field)).toBe('Updated hero');

    component.addExtraSourceValue(sourceField, 'project-2');
    component.addExtraSourceValue(sourceField, 'project-2');
    expect(component.getExtraStringArrayValue(component.editorState()!, sourceField)).toEqual(['project-1', 'project-2']);
    component.removeExtraSourceValue(sourceField, 'project-1');
    expect(component.getExtraStringArrayValue(component.editorState()!, sourceField)).toEqual(['project-2']);
  });

  it('persists html and rich-text extras through the shared extra bucket', () => {
    const htmlField = { id: 'backPageHtml', label: 'Verso', type: 'html' } as never;
    const richTextField = { id: 'fitRichText', label: 'Pourquoi moi', type: 'richtext' } as never;

    component.setExtraValue(htmlField, '<section class="atelier">Atelier</section>');
    expect(component.getExtraTextValue(component.editorState()!, htmlField)).toBe('<section class="atelier">Atelier</section>');

    component.setExtraRichTextValue(richTextField, '<p>Je <strong>documente</strong>.</p>');
    expect(component.getExtraTextValue(component.editorState()!, richTextField)).toBe('<p>Je <strong>documente</strong>.</p>');

    // A pull quote is legitimate rich text: the summary-only quote stripping must not touch it.
    component.setExtraRichTextValue(richTextField, '<p>"Livré en 3 semaines"</p>');
    expect(component.getExtraTextValue(component.editorState()!, richTextField)).toBe('<p>"Livré en 3 semaines"</p>');
    component.setProfessionalSummary('<p>"Livré en 3 semaines"</p>');
    expect(component.editorState()?.profile.professionalSummary).toBe('<p>Livré en 3 semaines</p>');

    // An emptied Quill instance must not persist its placeholder markup.
    component.setExtraRichTextValue(richTextField, '<p><br></p>');
    expect(component.getExtraTextValue(component.editorState()!, richTextField)).toBe('');
    component.setExtraRichTextValue(richTextField, '');
    expect(component.getExtraTextValue(component.editorState()!, richTextField)).toBe('');

    // Both extras live in the selected template bucket alongside the pre-existing ones.
    expect(component.editorState()?.profile.extra?.['classic']).toEqual({
      hero: 'Existing hero',
      visible: true,
      featuredProjects: ['project-1'],
      backPageHtml: '<section class="atelier">Atelier</section>',
      fitRichText: '',
    });
  });

  it('updates profile summary, link overrides and status', () => {
    component.setProfessionalSummary('Summary');
    component.setLinkOverrideField('github', 'https://github.test/me');
    component.setStatus('sent');

    expect(component.editorState()?.profile.professionalSummary).toBe('Summary');
    expect(component.editorState()?.profile.linkOverrides?.github).toBe('https://github.test/me');
    expect(component.editorState()?.profile.status).toBe('sent');
    expect(component.getStatusOption(undefined)?.value).toBe('unsent');
    expect(component.getStatusOption('sent')?.label).toBe('Envoye');
  });

  it('returns linked and available records for all relation types', () => {
    const current = component.editorState()!;

    expect(component.getLinkedJobs(current).map((item) => item.id)).toEqual(['job-1']);
    expect(component.getAvailableJobs(current).map((item) => item.id)).toEqual(['job-2']);
    expect(component.getLinkedProjects(current).map((item) => item.id)).toEqual(['project-1']);
    expect(component.getAvailableProjects(current).map((item) => item.id)).toEqual(['project-2']);
    expect(component.getLinkedSkills(current).map((item) => item.id)).toEqual(['skill-1']);
    expect(component.getAvailableSkills(current).map((item) => item.id)).toEqual(['skill-2']);
    expect(component.getLinkedDegrees(current).map((item) => item.id)).toEqual(['degree-1']);
    expect(component.getAvailableDegrees(current).map((item) => item.id)).toEqual(['degree-2']);
    expect(component.getLinkedAchievements(current).map((item) => item.id)).toEqual(['achievement-1']);
    expect(component.getAvailableAchievements(current).map((item) => item.id)).toEqual(['achievement-2']);
    expect(component.getLinkedHobbies(current).map((item) => item.id)).toEqual(['hobby-1']);
    expect(component.getAvailableHobbies(current).map((item) => item.id)).toEqual(['hobby-2']);
  });

  it('describes extra source records and selected pictures', () => {
    const current = component.editorState()!;

    expect(component.getExtraSourceRecordTitle(current.availableJobs[0])).toBe('ACME');
    expect(component.getExtraSourceRecordDescription(current.availableJobs[0])).toBe('Developer');
    expect(component.getExtraSourceRecordTitle(current.availableProjects[0])).toBe('Project One');
    expect(component.getExtraSourceRecordDescription(current.availableProjects[0])).toBe('2024');
    expect(component.getSkillDescription(current.availableSkills[0])).toBe('Framework · Frontend');
    expect(component.getExtraSourceRecordDescription(current.availableDegrees[0])).toBe('School');
    expect(component.getExtraSourceRecordDescription(current.availableAchievements[0])).toBe('Achievement description');
    expect(component.getPicturePreview(current, 'profilePictureFile')).toBe('https://files.test/avatar.png');
    expect(component.getSelectedPictureName(current, 'profilePictureFile')).toBe('Avatar');
  });

  it('saves a valid profile and reports validation errors', async () => {
    await component.save();

    expect(pocketBaseService.updateCurrentUserCvProfile).toHaveBeenCalledWith('profile-1', expect.objectContaining({
      profileName: 'Jane Doe',
      jobs: ['job-1'],
      public: true,
    }));
    expect(component.successMessage()).toBe('Profil enregistre.');

    const invalidState = state() as { profile: { profileName: string } };
    component.editorState.set({ ...invalidState, profile: { ...invalidState.profile, profileName: '   ' } } as never);
    await component.save();
    expect(component.errorMessage()).toBe('Le nom du profil est obligatoire.');
  });

  it('loads editor data and handles load failures', async () => {
    component.editorState.set(null);
    await (component as unknown as { loadEditorData: (profileId: string) => Promise<void> }).loadEditorData('profile-1');

    expect(component.editorState()?.profile.jobs).toEqual(['job-1']);
    expect(component.isLoading()).toBe(false);

    pocketBaseService.getCurrentUserCvProfileEditorData.mockRejectedValueOnce(new Error('Load failed'));
    await (component as unknown as { loadEditorData: (profileId: string) => Promise<void> }).loadEditorData('profile-1');
    expect(component.editorState()).toBeNull();
    expect(component.errorMessage()).toBe('Load failed');
  });

  it('keeps no-op state for null editor state branches', () => {
    component.editorState.set(null);

    component.addRelation('jobs', 'job-1');
    component.removeRelation('jobs', 'job-1');
    component.setExtraValue({ id: 'hero' } as never, 'Hero');
    component.setProfessionalSummary('Summary');
    component.setLinkOverrideField('github', 'https://github.test/me');
    component.setStatus('sent');
    component.addExtraSourceValue({ id: 'featuredProjects' } as never, 'project-1');
    component.removeExtraSourceValue({ id: 'featuredProjects' } as never, 'project-1');

    expect(component.editorState()).toBeNull();
  });

  it('covers extra source record sources and fallback descriptions', () => {
    const current = component.editorState()!;

    const privateApi = component as unknown as { getExtraSourceRecords: (state: unknown, source: string | undefined) => unknown[] };
    expect(privateApi.getExtraSourceRecords(current, 'jobs')).toHaveLength(2);
    expect(privateApi.getExtraSourceRecords(current, 'projects')).toHaveLength(2);
    expect(privateApi.getExtraSourceRecords(current, 'skills')).toHaveLength(2);
    expect(privateApi.getExtraSourceRecords(current, 'degrees')).toHaveLength(2);
    expect(privateApi.getExtraSourceRecords(current, 'achievements')).toHaveLength(2);
    expect(privateApi.getExtraSourceRecords(current, 'hobbies')).toHaveLength(2);
    expect(privateApi.getExtraSourceRecords(current, undefined)).toEqual([]);
    expect(component.getLinkedExtraSourceRecords(current, { id: 'featuredProjects', source: 'projects' } as never)).toHaveLength(1);
    expect(component.getAvailableExtraSourceRecords(current, { id: 'featuredProjects', source: 'projects' } as never)).toHaveLength(1);

    expect(component.getExtraSourceRecordDescription({ id: 'project', name: 'Project', date: '' } as never)).toBe('Sans date');
    expect(component.getExtraSourceRecordDescription({ id: 'skill', name: 'Skill', type: '', category: '' } as never)).toBe('Sans type');
    expect(component.getExtraSourceRecordDescription({ id: 'degree', title: 'Degree', school: '' } as never)).toBe('Sans ecole');
    expect(component.getExtraSourceRecordDescription({ id: 'achievement', title: 'Achievement', description: '' } as never)).toBe('Sans description');
    expect(component.getExtraSourceRecordDescription({ id: 'hobby', name: 'Hobby' } as never)).toBe('Sans description');
    expect(component.getPicturePreview({ ...current, profile: { ...current.profile, profilePictureFile: '', coverPictureFile: '' } } as never, 'coverPictureFile')).toBe('fallback-cover.png');
    expect(component.getSelectedPictureName({ ...current, availablePictures: [{ id: 'picture-1', alt: 'Alt only' }] } as never, 'profilePictureFile')).toBe('Alt only');
    expect(component.getSelectedPictureName({ ...current, availablePictures: [{ id: 'picture-1' }] } as never, 'profilePictureFile')).toBe('Image selectionnee');
  });

  it('handles save no-op and save errors', async () => {
    component.editorState.set(null);
    await component.save();
    expect(pocketBaseService.updateCurrentUserCvProfile).not.toHaveBeenCalled();

    component.editorState.set(state());
    pocketBaseService.updateCurrentUserCvProfile.mockRejectedValueOnce(new Error('Save failed'));
    await component.save();
    expect(component.errorMessage()).toBe('Save failed');
    expect(component.isSaving()).toBe(false);
  });

  it('handles saveProfileFields no-state and error branches', async () => {
    component.editorState.set(null);
    await component.saveProfileFields();
    expect(pocketBaseService.updateCurrentUserCvProfile).not.toHaveBeenCalled();
    expect(component.isProfileSaving()).toBe(false);

    component.editorState.set(state());
    pocketBaseService.updateCurrentUserCvProfile.mockRejectedValueOnce(new Error('Save fields failed'));
    await component.saveProfileFields();
    expect(component.errorMessage()).toBe('Save fields failed');
    expect(component.isProfileSaving()).toBe(false);
  });

  it('covers setter wrappers and template-related fallbacks', async () => {
    jest.spyOn(component, 'saveProfileFields').mockResolvedValue(undefined);

    component.setProfileLabel('New label');
    expect(component.editorState()?.profile.label).toBe('New label');

    component.setProfileTemplate('modern');
    expect(component.editorState()?.profile.template).toBe('modern');

    component.setProfileTemplate('');
    expect(component.editorState()?.profile.template).toBeUndefined();

    component.setProfilePublic(false);
    expect(component.editorState()?.profile.public).toBe(false);

    component.setProfilePictureFile('picture-2');
    expect(component.editorState()?.profile.profilePictureFile).toBe('picture-2');

    component.setProfilePictureFile('');
    expect(component.editorState()?.profile.profilePictureFile).toBeUndefined();

    component.setCoverPictureFile('picture-3');
    expect(component.editorState()?.profile.coverPictureFile).toBe('picture-3');

    component.setCoverPictureFile('');
    expect(component.editorState()?.profile.coverPictureFile).toBeUndefined();

    component.setStatusAndSave('rejected');
    expect(component.editorState()?.profile.status).toBe('rejected');
    expect(component.saveProfileFields).toHaveBeenCalledTimes(8);

    const current = component.editorState()!;
    const noTemplateState = { ...current, profile: { ...current.profile, template: '' } } as never;

    expect(component.getSelectedTemplateExtraSchema(noTemplateState)).toEqual([]);
    expect(component.getExtraValue(noTemplateState, { id: 'hero' } as never)).toBeUndefined();

    component.editorState.set(noTemplateState);
    component.setExtraValue({ id: 'hero' } as never, 'Should not set');
    expect(component.getExtraTextValue(component.editorState()!, { id: 'hero' } as never)).toBe('');

    component.editorState.set(null);
    component.setProfileTemplate('classic');
    expect(component.editorState()).toBeNull();
  });

  it('handles save payload with label, public, and extra fallbacks', async () => {
    const s = state() as Record<string, unknown>;
    const profile = s['profile'] as Record<string, unknown>;
    component.editorState.set({
      ...(s as object),
      profile: {
        ...profile,
        label: undefined,
        public: undefined,
        extra: undefined,
        jobs: undefined,
        projects: undefined,
        skills: undefined,
        degrees: undefined,
        achievements: undefined,
        hobbies: undefined,
        profilePictureFile: undefined,
        coverPictureFile: undefined,
      },
    } as never);

    await component.save();

    expect(pocketBaseService.updateCurrentUserCvProfile).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({
        label: '',
        public: true,
        extra: {},
        jobs: [],
        projects: [],
        skills: [],
        degrees: [],
        achievements: [],
        hobbies: [],
        profilePictureFile: '',
        coverPictureFile: '',
      }),
    );
  });

  it('guards against stale loadEditorData success and error', async () => {
    const defSuccess = deferred();
    pocketBaseService.getCurrentUserCvProfileEditorData
      .mockReturnValueOnce(defSuccess.promise);

    const load = (component as unknown as { loadEditorData: (id: string) => Promise<void> }).loadEditorData.bind(component);
    const firstLoad = load('profile-1');

    await load('profile-1');
    expect(component.editorState()).not.toBeNull();
    expect(component.isLoading()).toBe(false);

    defSuccess.resolve(editorData());
    await firstLoad;

    expect(component.editorState()?.profile.jobs).toEqual(['job-1']);

    const defError = deferred();
    pocketBaseService.getCurrentUserCvProfileEditorData
      .mockReturnValueOnce(defError.promise);

    const firstErrorLoad = load('profile-2');
    await load('profile-2');

    defError.reject(new Error('Stale error'));
    await firstErrorLoad;

    expect(component.errorMessage()).not.toBe('Stale error');
    expect(component.isLoading()).toBe(false);
  });

  it('covers toEditorState defaults, description skill-type branch, and record helper fallbacks', async () => {
    pocketBaseService.getCurrentUserCvProfileEditorData.mockResolvedValue({
      profile: { id: 'p1', profileName: 'Minimal', template: 'classic' },
      availableJobs: [],
      availableProjects: [],
      availableSkills: [],
      availableDegrees: [],
      availableAchievements: [],
      availableHobbies: [],
      availablePictures: [],
    });

    component.editorState.set(null);
    await (component as unknown as { loadEditorData: (id: string) => Promise<void> }).loadEditorData('p1');

    const current = component.editorState()!;
    expect(current.profile.jobs).toEqual([]);
    expect(current.profile.projects).toEqual([]);
    expect(current.profile.skills).toEqual([]);
    expect(current.profile.degrees).toEqual([]);
    expect(current.profile.achievements).toEqual([]);
    expect(current.profile.hobbies).toEqual([]);
    expect(current.profile.extra).toEqual({});

    component.editorState.set(state());
    const full = component.editorState()!;

    expect(component.getExtraSourceRecordDescription({ id: 'skill', name: 'Skill', type: 'Library' } as never)).toBe('Library');
    expect(component.getExtraSourceRecordDescription({ id: 'skill', name: 'Skill', type: '' } as never)).toBe('Sans type');
    expect(component.getExtraSourceRecordTitle({ id: 'degree', title: 'Degree title' } as never)).toBe('Degree title');
    expect(component.getSkillDescription({ id: 'skill', type: '', expand: { category: { id: 'c1', name: 'Frontend' } } } as never)).toBe('Frontend');

    expect(component.getLinkedJobs({ ...full, profile: { ...full.profile, jobs: undefined as unknown as string[] } } as never)).toEqual([]);
    const privateApi = component as unknown as { getLinkedRecords: (r: unknown[], ids: unknown) => unknown[] };
    expect(privateApi.getLinkedRecords(full.availableJobs, undefined)).toEqual([]);

    const notFoundState = { ...full, profile: { ...full.profile, profilePictureFile: 'picture-99' } } as never;
    expect(component.getPicturePreview(notFoundState, 'profilePictureFile')).toBe('fallback-profile.png');
    expect(component.getSelectedPictureName(notFoundState, 'profilePictureFile')).toBe('Image selectionnee');

    const noFileState = { ...full, availablePictures: [{ id: 'picture-1', name: 'Pic' }] } as never;
    expect(component.getPicturePreview(noFileState, 'profilePictureFile')).toBeUndefined();
  });

  it('computes completion percentage and maps status tones', () => {
    expect(component.completionPercentage()).toBe(75);
    expect(component.getStatusTone('sent')).toBe('blue');
    expect(component.getStatusTone('unsent')).toBe('muted');
    expect(component.getStatusTone('unanswered')).toBe('yellow');
    expect(component.getStatusTone(undefined)).toBe('muted');
    expect(component.getStatusTone('nonexistent' as never)).toBe('muted');

    component.setActiveTab('relations');
    expect(component.activeTab()).toBe('relations');

    component.editorState.set(null);
    expect(component.completionPercentage()).toBe(0);
  });

  function state() {
    return {
      profile: {
        id: 'profile-1',
        label: 'Jane CV',
        profileName: 'Jane Doe',
        template: 'classic',
        public: true,
        jobs: ['job-1'],
        projects: ['project-1'],
        skills: ['skill-1'],
        degrees: ['degree-1'],
        achievements: ['achievement-1'],
        hobbies: ['hobby-1'],
        profilePictureFile: 'picture-1',
        profilePicture: 'fallback-profile.png',
        coverPicture: 'fallback-cover.png',
        status: 'unsent',
        extra: { classic: { hero: 'Existing hero', visible: true, featuredProjects: ['project-1'] } },
      },
      availableJobs: [
        { id: 'job-1', company: 'ACME', position: 'Developer' },
        { id: 'job-2', company: 'Globex', position: 'Lead' },
      ],
      availableProjects: [
        { id: 'project-1', name: 'Project One', date: '2024' },
        { id: 'project-2', name: 'Project Two', date: '' },
      ],
      availableSkills: [
        { id: 'skill-1', name: 'Angular', type: 'Framework', expand: { category: { id: 'cat-1', name: 'Frontend' } } },
        { id: 'skill-2', name: 'Bun', type: '' },
      ],
      availableDegrees: [
        { id: 'degree-1', title: 'Degree One', school: 'School' },
        { id: 'degree-2', title: 'Degree Two', school: '' },
      ],
      availableAchievements: [
        { id: 'achievement-1', title: 'Achievement One', description: 'Achievement description' },
        { id: 'achievement-2', title: 'Achievement Two', description: '' },
      ],
      availableHobbies: [
        { id: 'hobby-1', name: 'Music', description: 'Guitar' },
        { id: 'hobby-2', name: 'Running', description: '' },
      ],
      availablePictures: [
        { id: 'picture-1', name: 'Avatar', file: 'https://files.test/avatar.png' },
        { id: 'picture-2', name: 'Avatar 2', file: 'https://files.test/avatar-2.png' },
        { id: 'picture-3', name: 'Cover 2', file: 'https://files.test/cover-2.png' },
      ],
    } as never;
  }

  function editorData() {
    return state();
  }

  function deferred<T = unknown>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
});
