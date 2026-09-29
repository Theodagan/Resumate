import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { PocketBaseClientService } from './pocketbase-client.service';
import { PocketBaseService } from './pocketbase.service';

jest.mock('../utils/ai-token', () => ({
  generateAiTokenSecret: jest.fn(() => 'resm_mock_secret_value'),
  getAiTokenPrefix: jest.fn((token: string) => token.slice(0, 16)),
  hashAiTokenSecret: jest.fn(async (token: string) => `hash:${token}`),
}));

describe('PocketBaseService', () => {
  let service: PocketBaseService;
  let collections: Record<string, Record<string, jest.Mock>>;
  let currentUserId: string | null;
  let pb: {
    collection: jest.Mock;
    files: { getURL: jest.Mock; getToken: jest.Mock };
    send: jest.Mock;
  };

  beforeEach(() => {
    currentUserId = 'user-1';
    collections = {};
    pb = {
      collection: jest.fn((name: string) => {
        collections[name] ??= {
          getOne: jest.fn(),
          getFirstListItem: jest.fn(),
          getFullList: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
          authWithPassword: jest.fn(),
        };
        return collections[name];
      }),
      files: {
        getURL: jest.fn((record, filename, options) =>
          `https://files.test/${record.id}/${filename}${options?.token ? `?token=${options.token}` : ''}`),
        getToken: jest.fn().mockResolvedValue('short-lived-file-token'),
      },
      send: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        PocketBaseService,
        { provide: PocketBaseClientService, useValue: { pb } },
        { provide: AuthService, useValue: { getCurrentUserId: () => currentUserId } },
      ],
    });

    service = TestBed.inject(PocketBaseService);
  });

  it('normalizes profiles, expanded users and file fields', async () => {
    collections['cv_profiles'] = {
      getOne: jest.fn().mockResolvedValue({
        id: 'profile-1',
        slug: 'classic--profile-1',
        profileName: 'Jane Doe',
        template: 'classic',
        user: 'user-1',
        profilePicture: 'profile.png',
        coverPicture: 'cover.png',
        expand: {
          user: { id: 'user-1', firstName: 'Jane', profilePicture: 'user.png' },
          profilePictureFile: { id: 'file-1', file: 'portrait.png' },
          coverPictureFile: { id: 'file-2', file: 'banner.png' },
        },
      }),
    } as never;

    const profile = await service.getCvProfileById('profile-1');

    expect(collections['cv_profiles']['getOne']).toHaveBeenCalledWith('profile-1', { expand: 'user,profilePictureFile,coverPictureFile' });
    expect(profile.extra).toEqual({});
    expect(profile.profilePicture).toBe('https://files.test/file-1/portrait.png?token=short-lived-file-token');
    expect(profile.coverPicture).toBe('https://files.test/file-2/banner.png?token=short-lived-file-token');
    expect(profile.expand?.user?.profilePicture).toBe('https://files.test/user-1/user.png?token=short-lived-file-token');
  });

  it('returns null for blank users and normalizes fetched users', async () => {
    expect(await service.getUser('')).toBeNull();
    collections['users'] = { getOne: jest.fn().mockResolvedValue({ id: 'user-1', profilePicture: 'me.png' }) } as never;

    await expect(service.getUser('user-1')).resolves.toMatchObject({ profilePicture: 'https://files.test/user-1/me.png?token=short-lived-file-token' });
  });

  it('refreshes the short-lived owner file token and never attaches it to another user’s images', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    pb.files.getToken.mockResolvedValueOnce('first-file-token').mockResolvedValueOnce('refreshed-file-token');
    collections['users'] = {
      getOne: jest.fn((id: string) => Promise.resolve({ id, profilePicture: 'photo.png' })),
    } as never;

    try {
      const own = await service.getUser('user-1');
      expect(own?.profilePicture).toContain('token=first-file-token');
      const other = await service.getUser('user-2');
      expect(other?.profilePicture).toBe('https://files.test/user-2/photo.png');

      clock.mockReturnValue(62_000);
      const refreshed = await service.getUser('user-1');
      expect(refreshed?.profilePicture).toContain('token=refreshed-file-token');
      expect(pb.files.getToken).toHaveBeenCalledTimes(2);

      currentUserId = null;
      const guest = await service.getUser('user-1');
      expect(guest?.profilePicture).toBe('https://files.test/user-1/photo.png');
    } finally {
      clock.mockRestore();
    }
  });

  it('honors the PocketBase file token expiry even when it is shorter than a minute', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const shortToken = `header.${btoa(JSON.stringify({ exp: 30 }))}.signature`;
    pb.files.getToken.mockResolvedValueOnce(shortToken).mockResolvedValueOnce('replacement-token');
    collections['users'] = {
      getOne: jest.fn().mockResolvedValue({ id: 'user-1', profilePicture: 'private.png' }),
    } as never;

    try {
      expect((await service.getUser('user-1'))?.profilePicture).toContain(`token=${shortToken}`);
      clock.mockReturnValue(16_000);
      expect((await service.getUser('user-1'))?.profilePicture).toContain('token=replacement-token');
      expect(pb.files.getToken).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('loads ordered related records in the requested order', async () => {
    collections['jobs'] = {
      getFullList: jest.fn().mockResolvedValue([{ id: 'job-2' }, { id: 'job-1' }]),
    } as never;

    await expect(service.getJobs(['job-1', 'missing', 'job-2'])).resolves.toEqual([{ id: 'job-1' }, { id: 'job-2' }]);
    expect(collections['jobs']['getFullList']).toHaveBeenCalledWith({
      filter: 'id="job-1" || id="missing" || id="job-2"',
      sort: '+sortOrder,-startDate',
      expand: undefined,
    });
    await expect(service.getJobs([])).resolves.toEqual([]);
  });

  it('creates, updates and deletes current user CV profiles', async () => {
    jest.spyOn(Date.prototype, 'getTime').mockReturnValue(1234);
    collections['cv_profiles'] = {
      create: jest.fn().mockResolvedValue({ id: 'profile-1', template: 'classic', slug: 'temp', user: 'user-1' }),
      update: jest.fn().mockResolvedValue({ id: 'profile-1', template: 'modern', slug: 'modern--profile-1', user: 'user-1' }),
      getFirstListItem: jest.fn().mockResolvedValue({ id: 'profile-1', template: 'classic', slug: 'classic--profile-1', user: 'user-1' }),
      delete: jest.fn().mockResolvedValue(undefined),
    } as never;

    await expect(service.createCurrentUserCvProfile(' Label ', ' Jane ', ' classic ')).resolves.toMatchObject({
      slug: 'modern--profile-1',
    });
    expect(collections['cv_profiles']['create']).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'profil--user-1--1234',
      label: 'Label',
      profileName: 'Jane',
      template: 'classic',
      user: 'user-1',
    }));
    expect(collections['cv_profiles']['update']).toHaveBeenCalledWith('profile-1', { slug: 'classic--profile-1' });

    await service.setTemplateForCurrentUserCvProfile('profile-1', 'modern', true);
    await service.setPublicForCurrentUserCvProfile('profile-1', false);
    await service.updateCurrentUserCvProfile('profile-1', { profileName: 'Jane Updated' });
    await service.deleteCurrentUserCvProfile('profile-1');

    expect(collections['cv_profiles']['delete']).toHaveBeenCalledWith('profile-1');
  });

  it('validates required CV profile creation fields and authentication', async () => {
    await expect(service.createCurrentUserCvProfile('', 'Jane', 'classic')).rejects.toThrow('Le label est obligatoire.');
    await expect(service.createCurrentUserCvProfile('Label', '', 'classic')).rejects.toThrow('Le nom du profil est obligatoire.');
    await expect(service.createCurrentUserCvProfile('Label', 'Jane', '')).rejects.toThrow('Le template est obligatoire.');

    currentUserId = null;
    await expect(service.getCurrentUserCvProfiles()).rejects.toThrow('Authentication required.');
  });

  it('creates and updates owned material records', async () => {
    for (const name of ['jobs', 'skills', 'skill_categories', 'projects', 'achievements', 'degrees', 'hobbies', 'files']) {
      collections[name] = {
        getFirstListItem: jest.fn().mockResolvedValue({ id: `${name}-1`, user: 'user-1' }),
        getFullList: jest.fn().mockResolvedValue([]),
        create: jest.fn((payload) => Promise.resolve({ id: `${name}-created`, ...formDataToObject(payload) })),
        update: jest.fn((id, payload) => Promise.resolve({ id, ...formDataToObject(payload) })),
      } as never;
    }

    await service.createCurrentUserJob({ label: 'Job', company: 'ACME', position: 'Dev', startDate: '2020-01-01', type: 'work project' });
    await service.updateCurrentUserJob('job-1', { label: 'Job', company: 'ACME', position: 'Dev', startDate: '2020-01-01', type: 'work project' });
    await service.createCurrentUserSkill({ name: 'Angular', category: '', type: 'Framework' });
    await service.updateCurrentUserSkill('skill-1', { name: 'Angular', category: '', type: 'Framework' });
    await service.createCurrentUserAchievement({ title: 'Won' });
    await service.updateCurrentUserAchievement('achievement-1', { title: 'Won' });
    await service.createCurrentUserDegree({ title: 'Degree' });
    await service.updateCurrentUserDegree('degree-1', { title: 'Degree' });
    await service.createCurrentUserHobby({ name: 'Music' });
    await service.updateCurrentUserHobby('hobby-1', { name: 'Music' });

    const picture = new File(['x'], 'picture.png');
    await expect(service.createCurrentUserProject({ name: 'Project', achievements: ['a1'], picture })).resolves.toMatchObject({
      name: 'Project',
      user: 'user-1',
    });
    await service.updateCurrentUserProject('project-1', { name: 'Project' });

    const file = new File(['x'], 'doc.pdf');
    await expect(service.createCurrentUserFile({ name: 'Doc', kind: 'document', file })).resolves.toMatchObject({ user: 'user-1' });
    await service.updateCurrentUserFile('file-1', { name: 'Doc' });

    await expect(service.createCurrentUserFile({ name: 'Doc' })).rejects.toThrow('Le fichier est obligatoire.');
  });

  it('reuses existing skill categories by normalized name', async () => {
    collections['skill_categories'] = {
      getFullList: jest.fn().mockResolvedValue([{ id: 'category-1', name: 'Developpement' }]),
      create: jest.fn(),
    } as never;

    await expect(service.createCurrentUserSkillCategory(' developpement ')).resolves.toMatchObject({ id: 'category-1' });
    await expect(service.createCurrentUserSkillCategory('')).rejects.toThrow('Le nom de la categorie est obligatoire.');
    expect(collections['skill_categories']['create']).not.toHaveBeenCalled();
  });

  it('handles AI tokens and user updates', async () => {
    collections['ai_tokens'] = {
      getFullList: jest.fn().mockResolvedValue([{ id: 'token-1', label: 'Token' }]),
      create: jest.fn().mockResolvedValue({ id: 'token-2', label: 'New token' }),
      getFirstListItem: jest.fn().mockResolvedValue({ id: 'token-1', label: 'Token' }),
    } as never;
    collections['users'] = { update: jest.fn().mockResolvedValue({ id: 'user-1', firstName: 'Jane' }) } as never;
    pb.send.mockResolvedValue(undefined);

    await expect(service.getCurrentUserAiTokens()).resolves.toEqual([{ id: 'token-1', label: 'Token' }]);
    await expect(service.createCurrentUserAiToken({ label: ' API ', expiresAt: '' })).resolves.toMatchObject({
      rawToken: 'resm_mock_secret_value',
    });
    expect(collections['ai_tokens']['create']).toHaveBeenCalledWith(expect.objectContaining({
      token_hash: 'hash:resm_mock_secret_value',
      token_prefix: 'resm_mock_secret',
      label: 'API',
      expiresAt: null,
    }));
    await expect(service.createCurrentUserAiToken({ label: ' ' })).rejects.toThrow('Le label de la cle API est obligatoire.');
    await service.revokeCurrentUserAiToken('token-1');
    expect(pb.send).toHaveBeenCalledWith('/api/custom/ai-tokens/token-1/revoke', { method: 'POST', requestKey: 'revoke-token-1' });
    await expect(service.updateCurrentUser({ firstName: 'Jane' })).resolves.toMatchObject({ id: 'user-1', firstName: 'Jane' });
  });

  it('loads, creates, and updates owner profile metadata outside users', async () => {
    collections['profile_metadata'] = {
      getFirstListItem: jest.fn()
        .mockRejectedValueOnce({ status: 404 })
        .mockRejectedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ id: 'metadata-1', user: 'user-1' }),
      create: jest.fn().mockResolvedValue({ id: 'metadata-1', user: 'user-1', writingStyleDescription: 'Concise' }),
      update: jest.fn().mockResolvedValue({ id: 'metadata-1', user: 'user-1', writingStyleDescription: 'Direct' }),
    } as never;

    await expect(service.getCurrentProfileMetadata()).resolves.toBeNull();
    await expect(service.saveCurrentProfileMetadata({ writingStyleDescription: 'Concise', writingStyleUrl: null }))
      .resolves.toMatchObject({ writingStyleDescription: 'Concise' });
    expect(collections['profile_metadata']['create']).toHaveBeenCalledWith({
      user: 'user-1',
      writingStyleDescription: 'Concise',
      writingStyleUrl: null,
    });

    collections['profile_metadata']['getFirstListItem'].mockResolvedValue({ id: 'metadata-1', user: 'user-1' });
    await expect(service.saveCurrentProfileMetadata({ writingStyleDescription: 'Direct', writingStyleUrl: null }))
      .resolves.toMatchObject({ writingStyleDescription: 'Direct' });
    expect(collections['profile_metadata']['update']).toHaveBeenCalledWith('metadata-1', {
      writingStyleDescription: 'Direct',
      writingStyleUrl: null,
    });
    expect(collections['users']).toBeUndefined();
  });

  it('builds complete CV data and resolves link overrides', async () => {
    jest.spyOn(service, 'getCvProfileById').mockResolvedValue({
      id: 'profile-1',
      user: 'user-1',
      jobs: ['job-1'],
      projects: ['project-1'],
      skills: ['skill-1'],
      degrees: ['degree-1'],
      achievements: ['achievement-1'],
      hobbies: ['hobby-1'],
      linkOverrides: { github: 'https://github.test/override' },
    } as never);
    jest.spyOn(service, 'getUser').mockResolvedValue({ id: 'user-1', github: 'https://github.test/original' } as never);
    jest.spyOn(service, 'getJobs').mockResolvedValue([{ id: 'job-1' }] as never);
    jest.spyOn(service, 'getProjects').mockResolvedValue([{ id: 'project-1' }] as never);
    jest.spyOn(service, 'getSkills').mockResolvedValue([{ id: 'skill-1' }] as never);
    jest.spyOn(service, 'getDegrees').mockResolvedValue([{ id: 'degree-1' }] as never);
    jest.spyOn(service, 'getAchievements').mockResolvedValue([{ id: 'achievement-1' }] as never);
    jest.spyOn(service, 'getHobbies').mockResolvedValue([{ id: 'hobby-1' }] as never);

    const data = await service.getCvDataByProfileId('profile-1');

    expect(data.user?.github).toBe('https://github.test/override');
    expect(data.jobs).toHaveLength(1);
    expect(service.resolveUserLinks({ linkOverrides: { website: 'https://site.test' } } as never, null)).toBeNull();
  });

  it('parses date strings safely', () => {
    expect(service.toDate()).toBeUndefined();
    expect(service.toDate('2024-01-02 03:04:05')?.getFullYear()).toBe(2024);
    expect(service.toDate(null as never)).toBeUndefined();
  });

  it('resolves user links with override, null, and missing fields', () => {
    const nullResult = service.resolveUserLinks({} as never, null);
    expect(nullResult).toBeNull();
    const user = { id: 'u1', firstName: 'A' } as never;
    const override = { linkedin: 'https://li.test' };
    const resolved = service.resolveUserLinks({ linkOverrides: override } as never, user);
    expect((resolved as unknown as Record<string, unknown>)['linkedin']).toBe('https://li.test');
    // Without overrides, should keep original
    const noOverride = service.resolveUserLinks({} as never, { id: 'u2', github: 'gh' } as never);
    expect((noOverride as unknown as Record<string, unknown>)['github']).toBe('gh');
  });

  it('gets CV data by slug through the public custom endpoint', async () => {
    pb.send.mockResolvedValue({
      profile: {
        id: 'profile-1', slug: 'classic--profile-1', user: 'user-1', profileName: 'Jane', profilePicture: 'p.png', profilePictureFile: 'file-1',
        linkOverrides: { github: 'https://github.test/override' },
        expand: { profilePictureFile: { id: 'file-1', file: 'portrait.png' } },
      },
      user: { id: 'user-1', firstName: 'Jane', github: 'https://github.test/original', profilePicture: 'u.png' },
      jobs: [{ id: 'job-1' }],
      projects: [{ id: 'project-1', picture: 'project.png' }],
      skills: [{ id: 'skill-1', name: 'Angular', icon: 'angular.svg' }],
      degrees: [{ id: 'degree-1' }],
      achievements: [{ id: 'achievement-1' }],
      hobbies: [{ id: 'hobby-1' }],
    });

    const data = await service.getCvDataBySlug('classic--profile-1');

    expect(pb.send).toHaveBeenCalledWith('/api/custom/cv-data/by-slug/classic--profile-1', {
      method: 'GET',
      requestKey: 'cv-data-by-slug-classic--profile-1',
    });
    expect(data.profile.profilePicture).toBe('https://files.test/file-1/portrait.png?token=short-lived-file-token');
    expect(data.user?.profilePicture).toBe('https://files.test/user-1/u.png?token=short-lived-file-token');
    expect(data.user?.github).toBe('https://github.test/override');
    expect(data.projects[0].picture).toBe('https://files.test/project-1/project.png');
    expect(data.skills[0].icon).toBe('https://files.test/skill-1/angular.svg');
  });

  it('gets profile by slug without using the owner-only cv_profiles list API or users getOne', async () => {
    pb.send.mockResolvedValue({
      profile: { id: 'profile-1', slug: 'classic--profile-1', user: 'user-1', profileName: 'Jane', profilePicture: 'p.png' },
      user: { id: 'user-1', firstName: 'Jane' },
      jobs: [],
      projects: [],
      skills: [],
      degrees: [],
      achievements: [],
      hobbies: [],
    });

    const profile = await service.getCvProfileBySlug('classic--profile-1');

    expect(profile.profilePicture).toBe('https://files.test/profile-1/p.png?token=short-lived-file-token');
    expect(collections['cv_profiles']).toBeUndefined();
    expect(collections['users']).toBeUndefined();
  });

  it('gets all CV profiles', async () => {
    collections['cv_profiles'] = {
      getFullList: jest.fn().mockResolvedValue([{
        id: 'profile-1', slug: 'a--p1', user: 'user-1', profileName: 'Test',
        expand: { user: { id: 'user-1', firstName: 'T' }, profilePictureFile: null, coverPictureFile: null },
      }]),
    } as never;
    const profiles = await service.getAllCvProfiles();
    expect(profiles).toHaveLength(1);
  });

  it('gets current user CV profile by id', async () => {
    collections['cv_profiles'] = {
      getFirstListItem: jest.fn().mockResolvedValue({ id: 'p1', slug: 's', user: 'user-1', profileName: 'P' }),
    } as never;
    const profile = await service.getCurrentUserCvProfileById('p1');
    expect(profile.id).toBe('p1');
    expect(collections['cv_profiles']['getFirstListItem']).toHaveBeenCalledWith('id="p1" && user="user-1"', {
      expand: 'user,profilePictureFile,coverPictureFile',
    });
  });

  it('sets link overrides for CV profile', async () => {
    collections['cv_profiles'] = {
      getFirstListItem: jest.fn().mockResolvedValue({ id: 'p1', user: 'user-1', profileName: 'P' }),
      update: jest.fn().mockResolvedValue({ id: 'p1', user: 'user-1', profileName: 'P', linkOverrides: { github: 'gh' } }),
    } as never;
    const profile = await service.setLinkOverridesForCvProfile('p1', { github: 'gh' });
    expect((profile as unknown as Record<string, unknown>)['linkOverrides']).toEqual({ github: 'gh' });
  });

  it('sets status for CV profile', async () => {
    collections['cv_profiles'] = {
      getFirstListItem: jest.fn().mockResolvedValue({ id: 'p1', user: 'user-1', profileName: 'P' }),
      update: jest.fn().mockResolvedValue({ id: 'p1', user: 'user-1', profileName: 'P', status: 'sent' }),
    } as never;
    const profile = await service.setStatusForCvProfile('p1', 'sent');
    expect(collections['cv_profiles']['getFirstListItem']).toHaveBeenCalledWith('id="p1" && user="user-1"', {
      expand: 'user,profilePictureFile,coverPictureFile',
    });
    expect(collections['cv_profiles']['update']).toHaveBeenCalledWith('p1', { status: 'sent' });
    expect((profile as unknown as Record<string, unknown>)['status']).toBe('sent');
  });

  it('updates sort orders', async () => {
    for (const col of ['jobs', 'skills']) {
      collections[col] = { update: jest.fn().mockResolvedValue({}) } as never;
    }
    await service.updateCurrentUserSortOrders('jobs', [{ id: 'j1', sortOrder: 1 }]);
    expect(collections['jobs']['update']).toHaveBeenCalled();
  });

  it('normalizes project with null throws', () => {
    expect(() => service['normalizeProject'](null as never)).toThrow('Project not found.');
  });

  it('normalizes skill with null throws', () => {
    expect(() => service['normalizeSkill'](null as never)).toThrow('Skill not found.');
  });

  it('normalizes media file with null throws', () => {
    expect(() => service['normalizeMediaFile'](null as never)).toThrow('File not found.');
  });

  it('normalizes CV profile with null throws', () => {
    expect(() => service['normalizeCvProfile'](null as never)).toThrow('CV profile not found.');
  });

  it('handles project creation without currentUserId', async () => {
    collections['projects'] = {
      create: jest.fn((payload: unknown) => Promise.resolve(formDataToObject(payload))),
    } as never;
    const picture = new File(['x'], 'p.png');
    const result = await service.createCurrentUserProject({ name: 'Proj', picture } as never);
    expect(result).toBeTruthy();
  });

  it('handles media file creation with user', async () => {
    collections['files'] = {
      create: jest.fn((payload: unknown) => Promise.resolve(formDataToObject(payload))),
    } as never;
    const file = new File(['x'], 'doc.pdf');
    const result = await service.createCurrentUserFile({ name: 'Doc', kind: 'document', file } as never);
    expect((result as unknown as Record<string, unknown>)['user']).toBe('user-1');
  });

  it('gets projects and skills with normalization', async () => {
    collections['projects'] = {
      getFullList: jest.fn().mockResolvedValue([{ id: 'p1', picture: 'pic.png' }]),
    } as never;
    const projects = await service.getProjects(['p1']);
    expect(projects).toHaveLength(1);
    expect(projects[0].picture).toBe('https://files.test/p1/pic.png');

    collections['skills'] = {
      getFullList: jest.fn().mockResolvedValue([{
        id: 's1', user: 'user-1', name: 'S', icon: 'skill.svg', expand: { category: { id: 'c1', name: 'Cat' } },
      }]),
    } as never;
    const skills = await service.getSkills(['s1']);
    expect(skills).toHaveLength(1);
    expect(skills[0].expand?.category?.name).toBe('Cat');
    expect(skills[0].icon).toBe('https://files.test/s1/skill.svg?token=short-lived-file-token');
  });

  it('gets editor data with all collections', async () => {
    collections['cv_profiles'] = {
      getFirstListItem: jest.fn().mockResolvedValue({
        id: 'p1', user: 'user-1', profileName: 'P',
        jobs: [], projects: [], skills: [], degrees: [], achievements: [], hobbies: [],
      }),
    } as never;
    for (const name of ['jobs', 'projects', 'skills', 'degrees', 'achievements', 'hobbies', 'files']) {
      collections[name] = {
        getFullList: jest.fn().mockResolvedValue([]),
      } as never;
    }
    const data = await service.getCurrentUserCvProfileEditorData('p1');
    expect(data.profile).toBeDefined();
  });

  it('gets profile material data', async () => {
    for (const name of ['jobs', 'skills', 'skill_categories', 'projects', 'achievements', 'degrees', 'hobbies', 'files']) {
      collections[name] = {
        getFullList: jest.fn().mockResolvedValue([]),
      } as never;
    }
    const data = await service.getCurrentUserProfileMaterialData();
    expect(data.jobs).toBeDefined();
    expect(data.files).toBeDefined();
  });

  it('creates AI token with expiresAt', async () => {
    collections['ai_tokens'] = {
      create: jest.fn().mockResolvedValue({ id: 'tok', label: 'T' }),
    } as never;
    const result = await service.createCurrentUserAiToken({ label: 'T', expiresAt: '2025-12-31' });
    expect(result.rawToken).toBeDefined();
  });

  it('normalizes skill without expand', async () => {
    collections['skills'] = {
      getFullList: jest.fn().mockResolvedValue([{ id: 's1', name: 'S' }]),
    } as never;
    const skills = await service.getSkills(['s1']);
    expect(skills).toHaveLength(1);
    expect(skills[0].expand).toBeUndefined();
  });

  function formDataToObject(payload: unknown): Record<string, unknown> {
    if (!(payload instanceof FormData)) {
      return payload as Record<string, unknown>;
    }

    return Object.fromEntries((payload as FormData & { entries: () => Iterable<[string, FormDataEntryValue]> }).entries());
  }
});
