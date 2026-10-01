import { ChangeDetectorRef, ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CvProfileExtraService } from '../../core/services/cv-profile-extra.service';
import { PocketBaseService } from '../../core/services/pocketbase.service';
import { AfficheCvPage } from './affiche-cv-page/affiche-cv-page';
import { BentoCvPage } from './bento-cv-page/bento-cv-page';
import { MinimalCvPage } from './minimal-cv-page/minimal-cv-page';
import { ModernCvPage } from './modern-cv-page/modern-cv-page';
import { SupaCVPage } from './supa-cv-page/supa-cv-page';

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,qr') },
}));

describe('CV template page logic', () => {
  const pocketBaseService = {
    toDate: jest.fn((value?: string | null) => (value ? new Date(value.replace(' ', 'T')) : undefined)),
    getCvDataByProfileId: jest.fn().mockResolvedValue(cvData()),
  };

  beforeEach(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      imports: [MinimalCvPage, ModernCvPage, SupaCVPage, BentoCvPage, AfficheCvPage],
      providers: [
        CvProfileExtraService,
        { provide: PocketBaseService, useValue: pocketBaseService },
        { provide: ChangeDetectorRef, useValue: { detectChanges: jest.fn(), markForCheck: jest.fn() } },
        { provide: ElementRef, useValue: new ElementRef(document.createElement('div')) },
      ],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('covers minimal template formatting helpers and load states', async () => {
    const component = TestBed.runInInjectionContext(() => new MinimalCvPage());
    const api = component as unknown as {
      getDate: (value?: string | null) => string;
      stripUrlProtocol: (value?: string | null) => string;
      loadCvData: (id: string) => Promise<void>;
    };

    expect(api.getDate('2024-01-02')).toContain('2024');
    expect(api.getDate(null)).toBe('');
    expect(api.stripUrlProtocol('https://example.test/path')).toBe('example.test/path');
    expect(api.stripUrlProtocol(null)).toBe('');

    await api.loadCvData('profile-1');
    expect(component.cvData()?.profile.id).toBe('profile-1');
    expect(component.isLoading()).toBe(false);

    pocketBaseService.getCvDataByProfileId.mockRejectedValueOnce(new Error('Broken minimal'));
    await api.loadCvData('profile-1');
    expect(component.errorMessage()).toBe('Broken minimal');
  });

  it('covers modern template extra helpers and load states', async () => {
    const component = TestBed.runInInjectionContext(() => new ModernCvPage());
    const api = component as unknown as {
      getDate: (value?: string | null) => string;
      extra: (key: string) => unknown;
      extraText: (key: string) => string | null;
      loadCvData: (id: string) => Promise<void>;
    };

    component.cvData.set(cvData() as never);
    expect(api.getDate('2024-01-02')).toContain('2024');
    expect(api.getDate(undefined)).toBe('');
    expect(api.extra('hero')).toBe('Hero text');
    expect(api.extraText('hero')).toBe('Hero text');
    expect(api.extraText('featuredProjects')).toBeNull();

    await api.loadCvData('profile-1');
    expect(component.cvData()?.profile.id).toBe('profile-1');
  });

  it('covers supa template grouping, classes and source calculations', () => {
    const component = TestBed.runInInjectionContext(() => new SupaCVPage());
    component.cvData.set(cvData() as never);
    const api = component as never as Record<string, (...args: unknown[]) => unknown>;
    const data = cvData() as never as { skills: unknown[]; jobs: unknown[] };

    expect(api['getDate']('2024-01-02')).toContain('2024');
    expect(api['extraBoolean']('visible')).toBe(true);
    expect(api['extraStringArray']('featuredProjects')).toEqual(['project-1']);
    expect(api['visibleSkills'](data.skills)).toHaveLength(2);
    expect(api['skillCategories'](data.skills)).toEqual(['Frontend', 'Tooling']);
    expect(api['skillCategoryLabel'](data.skills[0])).toBe('Frontend');
    expect(api['skillCategoryClass'](data.skills[0], data.skills)).toBe('skill--tone-0');
    expect((api['chronologicalJobs'](data.jobs) as { id: string }[]).map((job) => job.id)).toEqual(['job-1', 'job-2']);

    component.ngOnDestroy();
  });

  it('covers bento template display, role and experience helpers', () => {
    const component = TestBed.runInInjectionContext(() => new BentoCvPage());
    component.cvData.set(cvData() as never);
    const api = component as never as Record<string, (...args: unknown[]) => unknown>;
    const data = cvData() as never as { jobs: unknown[]; skills: unknown[] };

    expect(api['getDisplayName'](data)).toBe('Jane Doe');
    expect(api['getInitials'](data)).toBe('JD');
    expect(api['getRoleLines'](data)).toEqual(['Senior Engineer', 'Architect']);
    expect(api['getExperienceYears'](data.jobs)).toBeGreaterThan(0);
    expect(api['getStrengthSkills'](data.skills)).toHaveLength(2);
    expect(api['getExperienceItems'](data)).toHaveLength(3);
    expect(api['getVisibleExperienceItems'](data)).toHaveLength(3);

    component.ngOnDestroy();
  });

  it('covers bento fallback helpers and A4 fitting branches', () => {
    const component = TestBed.runInInjectionContext(() => new BentoCvPage());
    const api = component as never as Record<string, (...args: unknown[]) => unknown>;
    const data = cvData() as never as { jobs: unknown[]; skills: unknown[]; degrees: unknown[]; profile: { slug: string }; user: { website?: string } | null };

    expect(api['getDisplayName']({ ...data, user: null, profile: { ...data.profile, profileName: 'Profile Name' } })).toBe('Profile Name');
    expect(api['getDisplayName']({ ...data, user: null, profile: { ...data.profile, profileName: '' } })).toBe('Curriculum Vitae');
    expect(api['getInitials']({ ...data, user: null, profile: { ...data.profile, profileName: 'Solo' } })).toBe('S');
    expect(api['getRoleLines']({ ...data, profile: { ...data.profile, profileName: '' } })).toEqual(['Profil professionnel']);
    expect(api['getExperienceYears']([])).toBe(1);
    expect(api['getStrengthSkills']([{ id: 'lang', name: 'English', type: 'Language' }])).toHaveLength(1);
    expect(api['getJobSkills']({ skills: ['missing'] }, data.skills)).toHaveLength(2);
    expect(api['getVisibleDegrees']([1, 2, 3, 4, 5])).toHaveLength(4);
    component.mode.set('tight');
    expect(api['getVisibleDegrees']([1, 2, 3, 4, 5])).toHaveLength(3);
    expect(api['getDateRange']({ startDate: null, endDate: null })).toBe("Debut - Aujourd'hui");
    expect(api['getDate']('bad-date')).toBe('');
    expect(api['extra']('missing')).toBeUndefined();
    expect(api['extraText']('featuredProjects')).toBeNull();
    expect(api['getProfileUrl']({ ...data, user: null })).toContain('/classic--profile-1');

    component.cvData.set({ ...data, jobs: data.jobs, projects: [{ id: 'project-1' }, { id: 'project-2' }, { id: 'project-3' }] } as never);
    (component as never as { bentoSheet?: { nativeElement: { scrollHeight: number } } }).bentoSheet = { nativeElement: { scrollHeight: 10_000 } };
    api['fitToA4']();
    expect(component.mode()).toBe('tight');
    expect(component.visibleJobCount()).toBeGreaterThanOrEqual(4);

    (component as never as { bentoSheet?: { nativeElement: { scrollHeight: number } } }).bentoSheet = { nativeElement: { scrollHeight: 100 } };
    api['fitToA4']();
    expect(component.mode()).toBe('full');
  });

  it('covers supa loading, project ordering and fitting branches', async () => {
    const component = TestBed.runInInjectionContext(() => new SupaCVPage());
    component.cvData.set(cvData() as never);
    const api = component as never as Record<string, (...args: unknown[]) => unknown>;
    const data = cvData() as never as { projects: { id: string }[]; skills: unknown[]; jobs: unknown[] };

    expect(api['getDate']('bad-date')).toBe('');
    expect(api['skillCategoryLabel']({ name: 'No category' })).toBe('Autre');
    expect(api['skillCategoryClass']('Unknown', data.skills)).toBe('skill--tone-0');
    expect(api['getVisibleProjects']([{ id: 'project-2' }, { id: 'project-1' }])).toEqual([{ id: 'project-2' }, { id: 'project-1' }]);
    component.cvData.set({ ...(cvData() as object), profile: { ...(cvData() as never as { profile: object }).profile, extra: { classic: { featuredProjectIds: ['project-1'] } } } } as never);
    expect(api['getVisibleProjects']([{ id: 'project-2' }, { id: 'project-1' }])).toEqual([{ id: 'project-1' }, { id: 'project-2' }]);

    await api['loadCvData']('profile-1');
    expect(component.isLoading()).toBe(false);

    expect(api['mainFits']()).toBe(true);
    const root = { getBoundingClientRect: () => ({ top: 0 }) };
    const main = { scrollHeight: 10_000, getBoundingClientRect: () => ({ top: 0 }) };
    (component as never as { resumeRoot?: { nativeElement: unknown }; resumeMain?: { nativeElement: unknown } }).resumeRoot = { nativeElement: root };
    (component as never as { resumeRoot?: { nativeElement: unknown }; resumeMain?: { nativeElement: unknown } }).resumeMain = { nativeElement: main };
    expect(api['mainFits']()).toBe(false);
    api['fitSectionsToA4']();
    // Page never fits: the full ladder runs. Project descriptions are trimmed/hidden and the
    // current/last job description is only removed as a last resort, before the section fallbacks.
    expect(component.projectDescriptionMode()).toBe('hide-linked');
    expect(component.experienceDescriptions()).toBe('none');
    expect(component.sectionModes().skills).toBe('compact');
    expect(component.sectionModes().diplomas).toBe('compact');
    expect(component.sectionModes().projects).toBe('compact');
    expect(component.visibleProjectCount()).toBeGreaterThanOrEqual(1);

    (main as { scrollHeight: number }).scrollHeight = 100;
    api['fitSectionsToA4']();
    expect(component.sectionModes().experience).toBe('full');
    expect(component.experienceDescriptions()).toBe('all');
    expect(component.projectDescriptionMode()).toBe('full');

    // highlightedJob: with no endDate on any job, the most recent (job-2) is highlighted.
    const jobs = data.jobs as { id: string; endDate?: string }[];
    expect((api['highlightedJob'](jobs) as { id: string }).id).toBe('job-2');
    // When one job is current (no endDate) it wins over an earlier ended job.
    const mixedJobs = [
      { id: 'ended', startDate: '2023-01-01', endDate: '2023-12-01' },
      { id: 'current', startDate: '2021-01-01' },
    ];
    expect((api['highlightedJob'](mixedJobs) as { id: string }).id).toBe('current');
    expect(api['highlightedJob']([])).toBeNull();

    // isJobDescriptionVisible respects the experience-description mode.
    component.experienceDescriptions.set('all');
    expect(api['isJobDescriptionVisible'](jobs[0])).toBe(true);
    component.experienceDescriptions.set('none');
    expect(api['isJobDescriptionVisible'](jobs[1])).toBe(false);
    component.experienceDescriptions.set('highlighted');
    expect(api['isJobDescriptionVisible']({ id: 'job-2' })).toBe(true);
    expect(api['isJobDescriptionVisible']({ id: 'job-1' })).toBe(false);
  });

  it('covers affiche template mapping helpers and load states', async () => {
    const component = TestBed.runInInjectionContext(() => new AfficheCvPage());
    component.cvData.set(cvData() as never);
    const api = component as never as Record<string, (...args: unknown[]) => unknown>;
    const data = cvData() as never as {
      profile: { slug: string; profileName: string; extra: Record<string, Record<string, unknown>> };
      user: { website?: string } | null;
      jobs: unknown[];
      projects: unknown[];
      skills: unknown[];
    };

    // Identity, role and status pill.
    expect(api['getDisplayName'](data)).toBe('Jane Doe');
    expect(api['getDisplayName']({ ...data, user: null })).toBe('Senior Engineer / Architect');
    expect(api['getDisplayName']({ ...data, user: null, profile: { ...data.profile, profileName: '' } })).toBe('Curriculum Vitae');
    expect(api['getRole'](data)).toBe('Senior Engineer / Architect');
    expect(api['getStatus'](data)).toBe('Disponible');
    expect(api['getStatus']({ ...data, profile: { ...data.profile, extra: { affiche: { availability: ' Disponible · Rennes ' } } } })).toBe('Disponible · Rennes');
    expect(api['getStatus']({ ...data, profile: { ...data.profile, template: 'affiche', extra: { affiche: { availability: 42 } } } })).toBe('Disponible');

    // Intro and skills / languages split.
    expect(api['getIntro'](data)).toBe('');
    expect(api['getIntro']({ ...data, profile: { ...data.profile, professionalSummary: '<p>Je <b>construis</b> &amp; documente.</p>' } })).toBe('Je construis & documente.');
    expect((api['getSkillChips'](data.skills) as { id: string }[]).map((skill) => skill.id)).toEqual(['skill-1', 'skill-2']);
    expect(api['getLanguages'](data.skills)).toBe('English');
    expect(api['getLanguages']([])).toBe('');

    // Parcours: most recent first, freelance missions extracted.
    expect((api['getSortedJobs'](data.jobs) as { id: string }[]).map((job) => job.id)).toEqual(['job-2', 'job-1']);
    // The timeline drops freelance work: it already has its own list right below.
    expect((api['getTimelineJobs'](data.jobs) as { id: string }[]).map((job) => job.id)).toEqual(['job-1']);
    expect(api['getTimelineJobs']([{ id: 'job-3', type: 'freelance' }])).toEqual([]);
    expect(api['getJobDateRange']({ startDate: '2020-01-01', endDate: '2022-01-01' })).toContain('—');
    expect(api['getJobDateRange']({ startDate: null, endDate: null })).toBe("Début — Aujourd'hui");
    const missions = api['getFreelanceMissions'](data.jobs) as { id: string; year: string; label: string }[];
    expect(missions).toHaveLength(1);
    expect(missions[0].id).toBe('job-2');
    expect(missions[0].year).toMatch(/^\d{4}$/);
    expect(missions[0].label).toBe('Lead · Globex');

    // Projets: first project is the hero, the rest become numbered rows (capped at 4).
    expect((api['getHeroProject'](data.projects) as { id: string }).id).toBe('project-1');
    expect(api['getHeroProject']([])).toBeNull();
    expect(api['getProjectRows'](data.projects)).toHaveLength(0);
    const manyProjects = Array.from({ length: 8 }, (_, index) => ({ id: `p-${index}`, name: `P${index}` }));
    expect(api['getProjectRows'](manyProjects)).toHaveLength(4);
    expect(api['getProjectIndex'](0)).toBe('02');
    expect(api['getProjectIndex'](2)).toBe('04');
    expect(api['getProjectImage'](data.projects[0])).toBeNull();
    expect(api['getProjectImage']({ picture: 'https://cdn.test/a.png' })).toBe('https://cdn.test/a.png');
    expect(api['getProjectImage']({ expand: { file: { file: 'https://cdn.test/b.png' } } })).toBe('https://cdn.test/b.png');
    expect(api['getProjectMeta'](data.projects[0])).toMatch(/^\d{4}$/);

    // Univers: only projects carrying an image, first one featured.
    expect(api['getGalleryItems'](data.projects)).toHaveLength(0);
    const gallery = api['getGalleryItems']([
      { id: 'p-1', name: 'One', picture: 'https://cdn.test/1.png', description: '<p>Un</p>' },
      { id: 'p-2', name: 'Two' },
      { id: 'p-3', name: 'Three', expand: { file: { file: 'https://cdn.test/3.png' } } },
      { id: 'p-4', name: 'Four', picture: 'https://cdn.test/4.png' },
      { id: 'p-5', name: 'Five', picture: 'https://cdn.test/5.png' },
    ]) as { id: string; caption: string }[];
    expect(gallery.map((item) => item.id)).toEqual(['p-1', 'p-3', 'p-4']);
    expect(gallery[0].caption).toBe('Un');
    expect(gallery[1].caption).toBe('');

    // Pourquoi moi.
    expect(api['getFitLead'](data)).toContain("j'apporte");
    expect(api['getFitLead']({ ...data, profile: { ...data.profile, extra: { affiche: { fitLead: 'Je reprends des socles existants.' } } } })).toBe('Je reprends des socles existants.');
    expect(api['getMark'](0)).toBe('01');
    expect(api['getMark'](9)).toBe('10');

    // Shared formatting and profile URL.
    expect(api['getDate']('2024-01-02')).toContain('2024');
    expect(api['getDate']('bad-date')).toBe('');
    expect(api['getYear']('bad-date')).toBe('');
    expect(api['stripUrlProtocol']('https://example.test/path')).toBe('example.test/path');
    expect(api['stripUrlProtocol'](null)).toBe('');
    expect(api['stripHtml'](null)).toBe('');
    expect(api['stripHtml']('&lt;a&gt; &quot;b&quot; &#39;c&#39;&nbsp;d')).toBe('<a> "b" \'c\' d');
    expect(api['extra']('hero')).toBe('Hero text');
    expect(api['getProfileUrl'](data)).toBe('https://jane.test');
    expect(api['getProfileUrl']({ ...data, user: null })).toContain('/classic--profile-1');
    expect(api['getProfileUrl']({ ...data, user: null, profile: { ...data.profile, slug: '' } })).toBeNull();

    // Load states.
    await api['loadCvData']('profile-1');
    expect(component.cvData()?.profile.id).toBe('profile-1');
    expect(component.isLoading()).toBe(false);

    pocketBaseService.getCvDataByProfileId.mockRejectedValueOnce(new Error('Broken affiche'));
    await api['loadCvData']('profile-1');
    expect(component.errorMessage()).toBe('Broken affiche');
  });

  it('renders the affiche template from preview data and builds its QR code', async () => {
    const fixture = TestBed.createComponent(AfficheCvPage);
    fixture.componentRef.setInput('previewData', cvData());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    // No `showAllPages` extra on this fixture, so the verso stays out of the render.
    expect(host.querySelectorAll('.page')).toHaveLength(1);
    expect(host.querySelector('.display')?.textContent?.trim()).toBe('Jane Doe');
    // Two jobs on the fixture, one of them freelance: the timeline keeps the salaried one and the
    // freelance one shows up once, in the missions list.
    expect(host.querySelectorAll('.timeline-item')).toHaveLength(1);
    expect(host.querySelector('.timeline-item h3')?.textContent?.trim()).toBe('Developer');
    expect(host.querySelectorAll('.missions li')).toHaveLength(1);
    expect(host.querySelector('.missions li')?.textContent).toContain('Lead · Globex');
    expect(host.querySelector('.project-hero h3')?.textContent?.trim()).toBe('Project One');
    expect(host.querySelector('.universe-gallery')).toBeNull();
    expect(fixture.componentInstance.qrCodeUrl()).toBe('data:image/png;base64,qr');
  });

  it('covers template pages error and previewData load paths', async () => {
    // Test loadCvData error for each template
    const ctors = [SupaCVPage, BentoCvPage, ModernCvPage, MinimalCvPage, AfficheCvPage];
    for (const Ctor of ctors) {
      pocketBaseService.getCvDataByProfileId.mockRejectedValueOnce(new Error('Load error'));
      const component = TestBed.runInInjectionContext(() => new Ctor());
      const c = component as unknown as { loadCvData: (id: string) => Promise<void>; errorMessage: () => string | null; cvData: () => unknown; ngOnDestroy?: () => void };
      await c.loadCvData('profile-1');
      expect(c.errorMessage()).toBe('Load error');
      expect(c.cvData()).toBeNull();
      c.ngOnDestroy?.();
    }
  });

  it('ignores stale successful template loads', async () => {
    const ctors = [SupaCVPage, BentoCvPage, ModernCvPage, MinimalCvPage, AfficheCvPage];
    for (const Ctor of ctors) {
      const staleLoad = deferred<unknown>();
      const freshData = { ...(cvData() as object), profile: { ...(cvData() as never as { profile: object }).profile, id: 'profile-2' } };
      pocketBaseService.getCvDataByProfileId
        .mockReturnValueOnce(staleLoad.promise)
        .mockResolvedValueOnce(freshData);

      const component = TestBed.runInInjectionContext(() => new Ctor());
      const c = component as unknown as { loadCvData: (id: string) => Promise<void>; cvData: () => { profile: { id: string } } | null; ngOnDestroy?: () => void };
      const stalePromise = c.loadCvData('profile-1');

      await c.loadCvData('profile-2');
      staleLoad.resolve(cvData());
      await stalePromise;

      expect(c.cvData()?.profile.id).toBe('profile-2');
      c.ngOnDestroy?.();
    }
  });

  it('ignores stale failed template loads', async () => {
    const ctors = [SupaCVPage, BentoCvPage, ModernCvPage, MinimalCvPage, AfficheCvPage];
    for (const Ctor of ctors) {
      const staleLoad = deferred<unknown>();
      pocketBaseService.getCvDataByProfileId
        .mockReturnValueOnce(staleLoad.promise)
        .mockResolvedValueOnce(cvData());

      const component = TestBed.runInInjectionContext(() => new Ctor());
      const c = component as unknown as { loadCvData: (id: string) => Promise<void>; errorMessage: () => string | null; cvData: () => unknown; ngOnDestroy?: () => void };
      const stalePromise = c.loadCvData('profile-1');

      await c.loadCvData('profile-2');
      staleLoad.reject(new Error('Stale load failed'));
      await stalePromise;

      expect(c.errorMessage()).toBeNull();
      expect(c.cvData()).toBeTruthy();
      c.ngOnDestroy?.();
    }
  });

  function cvData(): unknown {
    return {
      profile: {
        id: 'profile-1',
        user: 'user-1',
        profileName: 'Senior Engineer / Architect',
        template: 'classic',
        slug: 'classic--profile-1',
        extra: { classic: { hero: 'Hero text', visible: true, featuredProjects: ['project-1'] } },
      },
      user: {
        id: 'user-1',
        firstName: 'Jane',
        lastName: 'Doe',
        github: 'https://github.test/jane',
        website: 'https://jane.test',
      },
      jobs: [
        { id: 'job-1', label: 'Developer', company: 'ACME', position: 'Developer', type: 'work project', startDate: '2020-01-01', sortOrder: 1, skills: ['skill-1'] },
        { id: 'job-2', label: 'Lead', company: 'Globex', position: 'Lead', type: 'freelance', startDate: '2022-01-01', sortOrder: 2, skills: ['skill-2'] },
      ],
      projects: [{ id: 'project-1', name: 'Project One', type: 'sideproject', date: '2024-01-01', description: 'Project', url: 'https://project.test' }],
      skills: [
        { id: 'skill-1', name: 'Angular', type: 'Framework', expand: { category: { id: 'cat-1', name: 'Frontend' } } },
        { id: 'skill-2', name: 'Bun', type: 'Tooling' },
        { id: 'skill-3', name: 'English', type: 'Language' },
      ],
      degrees: [{ id: 'degree-1', title: 'Master', school: 'School', year: '2020' }],
      achievements: [{ id: 'achievement-1', title: 'Award', description: 'Won' }],
      hobbies: [{ id: 'hobby-1', name: 'Music' }],
    } as never;
  }

  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });

    return { promise, resolve, reject };
  }
});
