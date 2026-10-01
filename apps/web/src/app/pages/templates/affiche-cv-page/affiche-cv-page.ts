import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { CvData } from '../../../core/models/cv-data.model';
import { CvProfile, CvProfileExtraValue } from '../../../core/models/cv-profile.model';
import { Job } from '../../../core/models/job.model';
import { Project } from '../../../core/models/project.model';
import { Skill } from '../../../core/models/skill.model';
import { CvProfileExtraService } from '../../../core/services/cv-profile-extra.service';
import { PocketBaseService } from '../../../core/services/pocketbase.service';
import { getErrorMessage } from '../../../core/utils/error-message';
import QRCode from 'qrcode';

const AFFICHE_EXTRA_KEY = 'affiche';
const MAX_PROJECT_ROWS = 4;
const MAX_GALLERY_ITEMS = 3;

/** Sub-pixel slack absorbing rounding noise in `getBoundingClientRect` measurements. */
const FIT_TOLERANCE = 1;

/** Reset sentinel meaning "lay every achievement out", used before each measurement pass. */
const FIT_ALL_BLOCKS = Number.MAX_SAFE_INTEGER;

/**
 * Forces the print geometry onto the live DOM so the fit can be measured against the sheet that
 * will actually be printed, whatever the current viewport does to the layout.
 */
const PRINT_LAYOUT_CLASS = 'is-printing';

interface AfficheMission {
  id: string;
  year: string;
  label: string;
}

interface AfficheGalleryItem {
  id: string;
  imageUrl: string;
  title: string;
  caption: string;
}

@Component({
  selector: 'app-affiche-cv-page',
  templateUrl: './affiche-cv-page.html',
  styleUrl: './affiche-cv-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AfficheCvPage implements OnInit, OnDestroy {
  private readonly pocketBaseService = inject(PocketBaseService);
  private readonly cvProfileExtra = inject(CvProfileExtraService);
  private readonly injector = inject(Injector);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private requestId = 0;
  private qrRequestId = 0;
  private fitFrame: number | null = null;
  private stopPrintQueryWatch: (() => void) | null = null;

  readonly cvProfileId = input<string | null>(null);
  readonly previewData = input<CvData | null>(null);
  readonly cvData = signal<CvData | null>(null);
  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly qrCodeUrl = signal<string | null>(null);

  private readonly fitPanelRef = viewChild<ElementRef<HTMLElement>>('fitPanel');
  private readonly fitBodyRef = viewChild<ElementRef<HTMLElement>>('fitBody');

  /** Second sheet is opt-in: an absent `showAllPages` keeps the render to the recto only. */
  readonly showAllPages = computed(() => this.afficheBoolean(this.cvData()?.profile, 'showAllPages'));

  /** Non-empty markup replaces the generated « Univers » gallery on the verso. */
  readonly backPageHtml = computed(() => this.afficheText(this.cvData()?.profile, 'backPageHtml') ?? '');

  readonly fitRichTextHtml = computed(() => this.afficheText(this.cvData()?.profile, 'fitRichText') ?? '');

  /** How many leading achievement blocks still fit the fixed « Pourquoi moi » panel. */
  readonly visibleFitBlockCount = signal(FIT_ALL_BLOCKS);

  ngOnInit(): void {
    effect(
      () => {
        const previewData = this.previewData();

        if (previewData) {
          this.cvData.set(previewData);
          this.isLoading.set(false);
          this.errorMessage.set(null);
          return;
        }

        const cvProfileId = this.cvProfileId();

        if (!cvProfileId) {
          this.cvData.set(null);
          this.isLoading.set(false);
          return;
        }

        void this.loadCvData(cvProfileId);
      },
      { injector: this.injector },
    );

    effect(
      () => {
        const data = this.cvData();
        const targetUrl = data ? this.getProfileUrl(data) : null;
        // The editor preview re-runs this on every edit, so several encodings overlap: only the
        // newest one may write, otherwise a late arrival leaves a QR for an abandoned URL.
        const currentQrRequestId = ++this.qrRequestId;

        if (!targetUrl) {
          this.qrCodeUrl.set(null);
          return;
        }

        QRCode.toDataURL(targetUrl, {
          width: 216,
          margin: 0,
          color: { dark: '#16130f', light: '#fffdf7' },
        })
          .then((dataUrl) => {
            if (currentQrRequestId === this.qrRequestId) {
              this.qrCodeUrl.set(dataUrl);
            }
          })
          .catch(() => {
            if (currentQrRequestId === this.qrRequestId) {
              this.qrCodeUrl.set(null);
            }
          });
      },
      { injector: this.injector },
    );

    // Any content change invalidates the previous fit, so re-measure the achievement blocks.
    effect(
      () => {
        this.cvData();
        this.fitRichTextHtml();
        this.scheduleFitMeasure();
      },
      { injector: this.injector },
    );

    effect(
      (onCleanup) => {
        const panel = this.fitPanelRef()?.nativeElement;
        const body = this.fitBodyRef()?.nativeElement;

        if (!panel || !body) {
          return;
        }

        // First pass once the verso is actually in the DOM; later passes come from the observer.
        this.scheduleFitMeasure();
        onCleanup(this.watchFitLayout(panel, body));
      },
      { injector: this.injector },
    );

    this.stopPrintQueryWatch = this.watchPrintQuery();
  }

  ngOnDestroy(): void {
    if (this.fitFrame !== null) {
      cancelAnimationFrame(this.fitFrame);
      this.fitFrame = null;
    }

    this.stopPrintQueryWatch?.();
    this.stopPrintQueryWatch = null;
  }

  // ---------- 01 · Profil -------------------------------------------------

  protected getDisplayName(data: CvData): string {
    const userName = [data.user?.firstName, data.user?.lastName].filter(Boolean).join(' ').trim();
    return userName || data.profile.profileName || 'Curriculum Vitae';
  }

  protected getRole(data: CvData): string {
    return data.profile.profileName;
  }

  protected getStatus(data: CvData): string {
    return this.afficheText(data.profile, 'availability') ?? 'Disponible';
  }

  protected getIntro(data: CvData): string {
    return this.stripHtml(data.profile.professionalSummary);
  }

  protected getSkillChips(skills: Skill[]): Skill[] {
    return skills.filter((skill) => !this.isLanguage(skill));
  }

  protected getLanguages(skills: Skill[]): string {
    return skills
      .filter((skill) => this.isLanguage(skill))
      .map((skill) => skill.name)
      .join(' · ');
  }

  protected getProfileUrl(data: CvData): string | null {
    if (data.user?.website) {
      return data.user.website;
    }

    if (!data.profile.slug) {
      return null;
    }

    if (typeof window === 'undefined') {
      return data.profile.slug;
    }

    return `${window.location.origin}/${data.profile.slug}`;
  }

  // ---------- 02 · Parcours -----------------------------------------------

  protected getSortedJobs(jobs: Job[]): Job[] {
    return [...jobs].sort((left, right) => this.getTime(right.startDate) - this.getTime(left.startDate));
  }

  /** Freelance work has its own list below the timeline, so it must not appear in both. */
  protected getTimelineJobs(jobs: Job[]): Job[] {
    return this.getSortedJobs(jobs).filter((job) => job.type !== 'freelance');
  }

  protected getJobDateRange(job: Job): string {
    const start = this.getDate(job.startDate) || 'Début';
    const end = this.getDate(job.endDate) || "Aujourd'hui";
    return `${start} — ${end}`;
  }

  protected getFreelanceMissions(jobs: Job[]): AfficheMission[] {
    return this.getSortedJobs(jobs)
      .filter((job) => job.type === 'freelance')
      .map((job) => ({
        id: job.id,
        year: this.getYear(job.startDate),
        label: [job.position, job.company].filter(Boolean).join(' · '),
      }));
  }

  // ---------- 03 · Projets ------------------------------------------------

  protected getHeroProject(projects: Project[]): Project | null {
    return projects[0] ?? null;
  }

  protected getProjectRows(projects: Project[]): Project[] {
    return projects.slice(1, 1 + MAX_PROJECT_ROWS);
  }

  protected getProjectIndex(position: number): string {
    return String(position + 2).padStart(2, '0');
  }

  protected getProjectImage(project: Project): string | null {
    return project.picture || project.expand?.file?.file || null;
  }

  protected getProjectMeta(project: Project): string {
    return this.getYear(project.date);
  }

  // ---------- 04–05 · Univers ---------------------------------------------

  protected getGalleryItems(projects: Project[]): AfficheGalleryItem[] {
    return projects
      .map((project) => ({ project, imageUrl: this.getProjectImage(project) }))
      .filter((entry): entry is { project: Project; imageUrl: string } => !!entry.imageUrl)
      .slice(0, MAX_GALLERY_ITEMS)
      .map(({ project, imageUrl }) => ({
        id: project.id,
        imageUrl,
        title: project.name,
        caption: this.stripHtml(project.description),
      }));
  }

  // ---------- 06 · Pourquoi moi -------------------------------------------

  protected getFitLead(data: CvData): string {
    return (
      this.afficheText(data.profile, 'fitLead') ??
      "Ce que j'apporte à l'équipe, au-delà de la liste des postes."
    );
  }

  protected getMark(position: number): string {
    return String(position + 1).padStart(2, '0');
  }

  protected isFitBlockHidden(position: number): boolean {
    return position >= this.visibleFitBlockCount();
  }

  // ---------- Ajustement du volet « Pourquoi moi » ------------------------

  /**
   * Watches the panel and its achievement list so the fit is recomputed when the sheet is resized
   * or when late content (rich text images, web fonts) shifts the layout. Returns the teardown.
   */
  private watchFitLayout(panel: HTMLElement, body: HTMLElement): () => void {
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => this.scheduleFitMeasure();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    const observer = new ResizeObserver(() => this.scheduleFitMeasure());
    observer.observe(panel);
    observer.observe(body);

    return () => observer.disconnect();
  }

  /**
   * The print snapshot is taken as soon as this handler returns, so everything here is synchronous:
   * the class swaps the sheet to the print geometry, `measureFit` reflows against it, and the view
   * is refreshed by hand — the signal alone would only reach the DOM on the next tick, after the
   * snapshot. Without this, printing from a window narrower than 900px keeps every achievement laid
   * out (the unfolded sheet never overflows) and the fixed print sheet then clips them mid-block.
   */
  @HostListener('window:beforeprint')
  protected onBeforePrint(): void {
    this.elementRef.nativeElement.classList.add(PRINT_LAYOUT_CLASS);
    this.measureFit();
    this.changeDetectorRef.detectChanges();
  }

  @HostListener('window:afterprint')
  protected onAfterPrint(): void {
    this.elementRef.nativeElement.classList.remove(PRINT_LAYOUT_CLASS);
    this.scheduleFitMeasure();
  }

  /**
   * Safari fires neither `beforeprint` nor `afterprint`, leaving the print media query as its only
   * signal. Best effort: Safari flips the query while the job is already being prepared, so the
   * re-measure can land late — the event path above stays the reliable one.
   */
  private watchPrintQuery(): () => void {
    const noop = () => undefined;

    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return noop;
    }

    const printQuery = window.matchMedia('print');

    if (typeof printQuery?.addEventListener !== 'function') {
      return noop;
    }

    const onPrintChange = (event: MediaQueryListEvent) =>
      event.matches ? this.onBeforePrint() : this.onAfterPrint();

    printQuery.addEventListener('change', onPrintChange);
    return () => printQuery.removeEventListener('change', onPrintChange);
  }

  private scheduleFitMeasure(): void {
    if (typeof requestAnimationFrame === 'undefined') {
      return;
    }

    if (this.fitFrame !== null) {
      cancelAnimationFrame(this.fitFrame);
    }

    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = null;
      this.measureFit();
    });
  }

  /**
   * Measures with every block laid out, so trailing blocks can come back once space frees up, and
   * keeps only the leading blocks whose full box stays inside the panel — never a partial block.
   */
  private measureFit(): void {
    const panel = this.fitPanelRef()?.nativeElement;
    const body = this.fitBodyRef()?.nativeElement;

    if (!panel || !body) {
      return;
    }

    const blocks = Array.from(body.querySelectorAll<HTMLElement>('.fit-block'));

    if (blocks.length === 0) {
      return;
    }

    // Inline display beats the hiding class, so the whole list is measurable in one frame.
    blocks.forEach((block) => block.style.setProperty('display', 'grid'));

    try {
      this.visibleFitBlockCount.set(this.countFittingBlocks(panel, blocks));
    } finally {
      blocks.forEach((block) => block.style.removeProperty('display'));
    }
  }

  private countFittingBlocks(panel: HTMLElement, blocks: HTMLElement[]): number {
    // Stacked layouts (narrow screens) let the panel grow, so nothing ever needs to be dropped.
    if (panel.scrollHeight - panel.clientHeight <= FIT_TOLERANCE) {
      return blocks.length;
    }

    const paddingBottom = Number.parseFloat(window.getComputedStyle(panel).paddingBottom) || 0;
    const footerHeight = panel.querySelector('.cta')?.getBoundingClientRect().height ?? 0;
    const limit = panel.getBoundingClientRect().bottom - paddingBottom - footerHeight;

    let fitting = 0;

    for (const block of blocks) {
      if (block.getBoundingClientRect().bottom > limit + FIT_TOLERANCE) {
        break;
      }

      fitting++;
    }

    return fitting;
  }

  // ---------- Formatage partagé -------------------------------------------

  protected getDate(dateStr: string | null | undefined): string {
    const date = this.pocketBaseService.toDate(dateStr);

    if (!date || Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short' });
  }

  protected getYear(dateStr: string | null | undefined): string {
    const date = this.pocketBaseService.toDate(dateStr);

    if (!date || Number.isNaN(date.getTime())) {
      return '';
    }

    return String(date.getFullYear());
  }

  protected stripUrlProtocol(url: string | null | undefined): string {
    if (!url) {
      return '';
    }

    return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  }

  protected stripHtml(html: string | null | undefined): string {
    if (!html) {
      return '';
    }

    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  protected extra(key: string): CvProfileExtraValue | undefined {
    return this.cvProfileExtra.get(this.cvData()?.profile, key);
  }

  /**
   * Reads the `affiche` extra bucket first so the template keeps its own settings even when the
   * profile is rendered through another template id (preview, template switching).
   */
  private afficheText(profile: CvProfile | null | undefined, key: string): string | null {
    const value = profile?.extra?.[AFFICHE_EXTRA_KEY]?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    const fallback = this.cvProfileExtra.text(profile, key);
    return fallback?.trim() || null;
  }

  private afficheBoolean(profile: CvProfile | null | undefined, key: string): boolean {
    return profile?.extra?.[AFFICHE_EXTRA_KEY]?.[key] === true || this.cvProfileExtra.boolean(profile, key);
  }

  private isLanguage(skill: Skill): boolean {
    return skill.type?.toLowerCase() === 'language';
  }

  private getTime(dateStr: string | null | undefined): number {
    const date = this.pocketBaseService.toDate(dateStr);
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  }

  private async loadCvData(cvProfileId: string): Promise<void> {
    const currentRequestId = ++this.requestId;
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const cvData = await this.pocketBaseService.getCvDataByProfileId(cvProfileId);

      if (currentRequestId !== this.requestId) {
        return;
      }

      this.cvData.set(cvData);
    } catch (error: unknown) {
      if (currentRequestId !== this.requestId) {
        return;
      }

      this.cvData.set(null);
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      if (currentRequestId === this.requestId) {
        this.isLoading.set(false);
      }
    }
  }
}
