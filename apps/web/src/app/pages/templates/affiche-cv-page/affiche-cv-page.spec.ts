import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CvProfileExtraValue } from '../../../core/models/cv-profile.model';
import { CvProfileExtraService } from '../../../core/services/cv-profile-extra.service';
import { PocketBaseService } from '../../../core/services/pocketbase.service';
import { AfficheCvPage } from './affiche-cv-page';
import QRCode from 'qrcode';

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,qr') },
}));

describe('AfficheCvPage extras', () => {
  const pocketBaseService = {
    toDate: jest.fn((value?: string | null) => (value ? new Date(value.replace(' ', 'T')) : undefined)),
    getCvDataByProfileId: jest.fn(),
  };

  beforeEach(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      imports: [AfficheCvPage],
      providers: [CvProfileExtraService, { provide: PocketBaseService, useValue: pocketBaseService }],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------- Visibilité des feuilles -------------------------------------

  it('renders the recto only when showAllPages is absent or false', () => {
    expect(render({}).nativeElement.querySelectorAll('.page')).toHaveLength(1);
    expect(render({ showAllPages: false }).nativeElement.querySelectorAll('.page')).toHaveLength(1);
    // A non-boolean value must not be coerced into an opt-in.
    expect(render({ showAllPages: 'yes' }).nativeElement.querySelectorAll('.page')).toHaveLength(1);
  });

  it('renders the verso when showAllPages is enabled', () => {
    const host = render({ showAllPages: true }).nativeElement;

    expect(host.querySelectorAll('.page')).toHaveLength(2);
    expect(host.querySelector('.panel.fit')).not.toBeNull();
    expect(host.querySelector('.fit-lead')?.textContent).toContain("j'apporte");
  });

  // ---------- Markup personnalisé du verso --------------------------------

  it('replaces the generated gallery with backPageHtml and sanitizes it', () => {
    const host = render({
      showAllPages: true,
      backPageHtml: '<h3>Atelier</h3><img src="https://cdn.test/x.png" alt="Atelier"><script>alert(1)</script>',
    }).nativeElement;

    const custom = host.querySelector('.universe-custom');
    expect(custom).not.toBeNull();
    expect(custom?.querySelector('h3')?.textContent).toBe('Atelier');
    expect(custom?.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/x.png');
    // Plain [innerHTML] goes through Angular's sanitizer — no bypass API is involved.
    expect(custom?.querySelector('script')).toBeNull();

    // The generated region is gone, intro paragraph included.
    expect(host.querySelector('.universe-gallery')).toBeNull();
    expect(host.querySelector('.universe-intro')).toBeNull();
  });

  it('keeps the generated gallery when backPageHtml is empty or blank', () => {
    for (const backPageHtml of ['', '   ']) {
      const host = render({ showAllPages: true, backPageHtml }).nativeElement;

      expect(host.querySelector('.universe-custom')).toBeNull();
      expect(host.querySelector('.universe-intro')).not.toBeNull();
      expect(host.querySelectorAll('.universe-item')).toHaveLength(2);
    }
  });

  // ---------- Texte enrichi de « Pourquoi moi » ---------------------------

  it('renders fitRichText sanitized, immediately before the achievements', () => {
    const host = render({
      showAllPages: true,
      fitRichText: '<p>Je <strong>documente</strong>.</p><script>alert(1)</script>',
    }).nativeElement;

    const richText = host.querySelector('.fit-rich-text');
    expect(richText?.querySelector('strong')?.textContent).toBe('documente');
    expect(richText?.querySelector('script')).toBeNull();
    expect(richText?.nextElementSibling?.classList.contains('fit-body')).toBe(true);
    expect(host.querySelector('.fit-lead')?.nextElementSibling).toBe(richText);
  });

  it('omits the rich text container when fitRichText is unset', () => {
    const host = render({ showAllPages: true }).nativeElement;

    expect(host.querySelector('.fit-rich-text')).toBeNull();
    expect(host.querySelector('.fit-lead')?.nextElementSibling?.classList.contains('fit-body')).toBe(true);
  });

  // ---------- Ajustement progressif ---------------------------------------

  it('keeps every achievement while the panel does not overflow', () => {
    const fixture = renderFixture({ showAllPages: true });
    const host = fixture.nativeElement as HTMLElement;

    stubPanel(host, { panelBottom: 300, clientHeight: 300, scrollHeight: 300, ctaHeight: 60 });
    stubBlocks(host, [80, 160, 240, 320]);

    measure(fixture);

    expect(hiddenFlags(host)).toEqual([false, false, false, false]);
  });

  it('drops whole trailing achievements that no longer fit the fixed panel', () => {
    const fixture = renderFixture({ showAllPages: true });
    const host = fixture.nativeElement as HTMLElement;

    // Panel bottom 300, 20px padding-bottom, 60px footer ⇒ blocks must end by 220.
    stubPanel(host, { panelBottom: 300, clientHeight: 300, scrollHeight: 520, ctaHeight: 60 });
    stubBlocks(host, [80, 160, 240, 320]);

    measure(fixture);

    expect(fixture.componentInstance.visibleFitBlockCount()).toBe(2);
    // The third block is dropped as a whole: no mid-block clipping, order preserved.
    expect(hiddenFlags(host)).toEqual([false, false, true, true]);
    // Measurement leaves no inline display override behind, so the class stays authoritative.
    expect(blocksOf(host).every((block) => block.style.display === '')).toBe(true);
  });

  it('brings trailing achievements back when the panel stops overflowing', () => {
    const fixture = renderFixture({ showAllPages: true });
    const host = fixture.nativeElement as HTMLElement;

    stubPanel(host, { panelBottom: 300, clientHeight: 300, scrollHeight: 520, ctaHeight: 60 });
    stubBlocks(host, [80, 160, 240, 320]);
    measure(fixture);
    expect(fixture.componentInstance.visibleFitBlockCount()).toBe(2);

    stubPanel(host, { panelBottom: 900, clientHeight: 900, scrollHeight: 900, ctaHeight: 60 });
    measure(fixture);

    expect(hiddenFlags(host)).toEqual([false, false, false, false]);
  });

  it('re-measures on window resize when ResizeObserver is unavailable, and stops on destroy', () => {
    const fixture = renderFixture({ showAllPages: true });
    const host = fixture.nativeElement as HTMLElement;
    const measureSpy = jest.spyOn(
      fixture.componentInstance as unknown as { measureFit: () => void },
      'measureFit',
    );

    stubPanel(host, { panelBottom: 300, clientHeight: 300, scrollHeight: 520, ctaHeight: 60 });
    stubBlocks(host, [80, 160, 240, 320]);

    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();

    expect(measureSpy).toHaveBeenCalled();
    expect(fixture.componentInstance.visibleFitBlockCount()).toBe(2);

    fixture.destroy();
    measureSpy.mockClear();
    window.dispatchEvent(new Event('resize'));

    expect(measureSpy).not.toHaveBeenCalled();
  });

  it('observes the panel and its achievement list when ResizeObserver exists, and disconnects on destroy', () => {
    const observe = jest.fn();
    const disconnect = jest.fn();
    let notify: (() => void) | undefined;

    (window as unknown as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe = observe;
      unobserve = jest.fn();
      disconnect = disconnect;
    };

    try {
      const fixture = renderFixture({ showAllPages: true });
      const host = fixture.nativeElement as HTMLElement;

      expect(observe).toHaveBeenCalledTimes(2);
      expect(observe.mock.calls.map(([element]) => (element as HTMLElement).className)).toEqual([
        expect.stringContaining('fit'),
        expect.stringContaining('fit-body'),
      ]);

      stubPanel(host, { panelBottom: 300, clientHeight: 300, scrollHeight: 520, ctaHeight: 60 });
      stubBlocks(host, [80, 160, 240, 320]);
      notify?.();
      fixture.detectChanges();

      expect(fixture.componentInstance.visibleFitBlockCount()).toBe(2);

      fixture.destroy();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });

  it('skips measuring when the verso is not rendered', () => {
    const fixture = renderFixture({});

    measure(fixture);

    expect(fixture.nativeElement.querySelector('.fit-body')).toBeNull();
    expect(fixture.componentInstance.visibleFitBlockCount()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('leaves the count untouched when the panel holds no achievement block', () => {
    const fixture = renderFixture({ showAllPages: true }, []);

    measure(fixture);

    expect(fixture.nativeElement.querySelector('.fit-body')).toBeNull();
    expect(fixture.componentInstance.visibleFitBlockCount()).toBe(Number.MAX_SAFE_INTEGER);
  });

  // ---------- Parcours : pas de doublon freelance --------------------------

  it('renders a freelance job in the missions list only, never in the timeline too', () => {
    const host = render({}, defaultAchievements(), {
      jobs: [salariedJob('job-1'), freelanceJob('job-2')],
    }).nativeElement;

    const timeline = Array.from(host.querySelectorAll('.timeline .job h3')).map((node) => node.textContent);
    const missions = Array.from(host.querySelectorAll('.missions li')).map((node) => node.textContent);

    expect(timeline).toEqual(['Developer']);
    expect(missions).toHaveLength(1);
    expect(missions[0]).toContain('Lead · Globex');
  });

  it('renders no timeline when every job is freelance', () => {
    const host = render({}, defaultAchievements(), { jobs: [freelanceJob('job-1')] }).nativeElement;

    expect(host.querySelector('.timeline')).toBeNull();
    expect(host.querySelectorAll('.missions li')).toHaveLength(1);
  });

  // ---------- Univers : galerie vide ---------------------------------------

  it('drops the « Univers » intro when no project can feed the gallery', () => {
    const host = render({ showAllPages: true }, defaultAchievements(), {
      projects: [{ id: 'project-1', name: 'One', description: '<p>Un</p>' }],
    }).nativeElement;

    expect(host.querySelector('.universe-gallery')).toBeNull();
    expect(host.querySelector('.universe-intro')).toBeNull();
  });

  // ---------- Ajustement à l'impression -----------------------------------

  it('re-measures against the print geometry before printing, then restores the screen layout', () => {
    const fixture = renderFixture({ showAllPages: true });
    const host = fixture.nativeElement as HTMLElement;

    stubPanel(host, { panelBottom: 300, clientHeight: 300, scrollHeight: 520, ctaHeight: 60 });
    stubBlocks(host, [80, 160, 240, 320]);

    window.dispatchEvent(new Event('beforeprint'));

    // Everything has to land synchronously: the print snapshot follows the handler immediately.
    expect(host.classList.contains('is-printing')).toBe(true);
    expect(fixture.componentInstance.visibleFitBlockCount()).toBe(2);
    expect(hiddenFlags(host)).toEqual([false, false, true, true]);

    window.dispatchEvent(new Event('afterprint'));

    expect(host.classList.contains('is-printing')).toBe(false);
  });

  it('mirrors the print hooks onto the print media query for browsers without the events', () => {
    const listeners: ((event: MediaQueryListEvent) => void)[] = [];
    const removeEventListener = jest.fn();
    const originalMatchMedia = window.matchMedia;

    (window as unknown as { matchMedia: unknown }).matchMedia = jest.fn(() => ({
      matches: false,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.push(listener),
      removeEventListener,
    }));

    try {
      const fixture = renderFixture({ showAllPages: true });
      const host = fixture.nativeElement as HTMLElement;

      stubPanel(host, { panelBottom: 300, clientHeight: 300, scrollHeight: 520, ctaHeight: 60 });
      stubBlocks(host, [80, 160, 240, 320]);
      expect(listeners).toHaveLength(1);

      listeners[0]({ matches: true } as MediaQueryListEvent);
      expect(host.classList.contains('is-printing')).toBe(true);
      expect(fixture.componentInstance.visibleFitBlockCount()).toBe(2);

      listeners[0]({ matches: false } as MediaQueryListEvent);
      expect(host.classList.contains('is-printing')).toBe(false);

      fixture.destroy();
      expect(removeEventListener).toHaveBeenCalledWith('change', listeners[0]);
    } finally {
      (window as unknown as { matchMedia: unknown }).matchMedia = originalMatchMedia;
    }
  });

  // ---------- QR code : encodages concurrents ------------------------------

  it('keeps the QR code of the newest profile URL when encodings settle out of order', async () => {
    const toDataURL = QRCode.toDataURL as unknown as jest.Mock;
    const pending: { url: string; resolve: (dataUrl: string) => void }[] = [];

    toDataURL.mockReset();
    toDataURL.mockImplementation(
      (url: string) => new Promise<string>((resolve) => pending.push({ url, resolve })),
    );

    try {
      const fixture = TestBed.createComponent(AfficheCvPage);
      fixture.componentRef.setInput('previewData', cvData({}, defaultAchievements(), { user: userAt('https://first.test') }));
      fixture.detectChanges();
      fixture.componentRef.setInput('previewData', cvData({}, defaultAchievements(), { user: userAt('https://second.test') }));
      fixture.detectChanges();

      expect(pending.map((entry) => entry.url)).toEqual(['https://first.test', 'https://second.test']);

      // The newest encoding settles first, the abandoned one after: the stale result is dropped.
      pending[1].resolve('data:image/png;base64,second');
      pending[0].resolve('data:image/png;base64,first');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fixture.componentInstance.qrCodeUrl()).toBe('data:image/png;base64,second');
    } finally {
      toDataURL.mockReset();
      toDataURL.mockResolvedValue('data:image/png;base64,qr');
    }
  });

  // ---------- Helpers ------------------------------------------------------

  function renderFixture(
    extra: Record<string, CvProfileExtraValue | string>,
    achievements = defaultAchievements(),
    overrides: Record<string, unknown> = {},
  ): ComponentFixture<AfficheCvPage> {
    const fixture = TestBed.createComponent(AfficheCvPage);
    fixture.componentRef.setInput('previewData', cvData(extra, achievements, overrides));
    fixture.detectChanges();
    return fixture;
  }

  function render(
    extra: Record<string, CvProfileExtraValue | string>,
    achievements = defaultAchievements(),
    overrides: Record<string, unknown> = {},
  ): { nativeElement: HTMLElement } {
    return { nativeElement: renderFixture(extra, achievements, overrides).nativeElement as HTMLElement };
  }

  function measure(fixture: ComponentFixture<AfficheCvPage>): void {
    (fixture.componentInstance as unknown as { measureFit: () => void }).measureFit();
    fixture.detectChanges();
  }

  function blocksOf(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.fit-block'));
  }

  function hiddenFlags(host: HTMLElement): boolean[] {
    return blocksOf(host).map((block) => block.classList.contains('fit-block--hidden'));
  }

  function stubPanel(
    host: HTMLElement,
    geometry: { panelBottom: number; clientHeight: number; scrollHeight: number; ctaHeight: number },
  ): void {
    const panel = host.querySelector<HTMLElement>('.panel.fit')!;
    const cta = host.querySelector<HTMLElement>('.cta')!;

    stubBox(panel, 0, geometry.panelBottom);
    Object.defineProperty(panel, 'clientHeight', { configurable: true, value: geometry.clientHeight });
    Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: geometry.scrollHeight });
    stubBox(cta, geometry.panelBottom - geometry.ctaHeight, geometry.panelBottom);

    const realGetComputedStyle = window.getComputedStyle.bind(window);
    jest
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((element: Element, pseudo?: string | null) =>
        element === panel
          ? ({ paddingBottom: '20px' } as CSSStyleDeclaration)
          : realGetComputedStyle(element, pseudo),
      );
  }

  function stubBlocks(host: HTMLElement, bottoms: number[]): void {
    blocksOf(host).forEach((block, index) => stubBox(block, bottoms[index] - 80, bottoms[index]));
  }

  function stubBox(element: HTMLElement, top: number, bottom: number): void {
    element.getBoundingClientRect = () =>
      ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;
  }

  function defaultAchievements() {
    return [
      { id: 'achievement-1', title: 'Award one', description: 'Won one' },
      { id: 'achievement-2', title: 'Award two', description: 'Won two' },
      { id: 'achievement-3', title: 'Award three', description: 'Won three' },
      { id: 'achievement-4', title: 'Award four', description: 'Won four' },
    ];
  }

  function cvData(
    extra: Record<string, CvProfileExtraValue | string>,
    achievements: unknown[],
    overrides: Record<string, unknown> = {},
  ): unknown {
    return {
      profile: {
        id: 'profile-1',
        user: 'user-1',
        profileName: 'Senior Engineer',
        template: 'affiche',
        slug: 'affiche--profile-1',
        extra: { affiche: extra },
      },
      user: { id: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.test' },
      jobs: [],
      projects: [
        { id: 'project-1', name: 'One', picture: 'https://cdn.test/1.png', description: '<p>Un</p>' },
        { id: 'project-2', name: 'Two', picture: 'https://cdn.test/2.png' },
      ],
      skills: [],
      degrees: [],
      achievements,
      hobbies: [],
      ...overrides,
    } as never;
  }

  function salariedJob(id: string) {
    return { id, position: 'Developer', company: 'ACME', type: 'work project', startDate: '2020-01-01' };
  }

  function freelanceJob(id: string) {
    return { id, position: 'Lead', company: 'Globex', type: 'freelance', startDate: '2022-01-01' };
  }

  function userAt(website: string) {
    return { id: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.test', website };
  }
});
