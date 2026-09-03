import { ChangeDetectionStrategy, Component, Injector, OnInit, effect, inject, input, signal } from '@angular/core';
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
export class AfficheCvPage implements OnInit {
  private readonly pocketBaseService = inject(PocketBaseService);
  private readonly cvProfileExtra = inject(CvProfileExtraService);
  private readonly injector = inject(Injector);
  private requestId = 0;

  readonly cvProfileId = input<string | null>(null);
  readonly previewData = input<CvData | null>(null);
  readonly cvData = signal<CvData | null>(null);
  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly qrCodeUrl = signal<string | null>(null);

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

        if (!targetUrl) {
          this.qrCodeUrl.set(null);
          return;
        }

        QRCode.toDataURL(targetUrl, {
          width: 216,
          margin: 0,
          color: { dark: '#16130f', light: '#fffdf7' },
        })
          .then((dataUrl) => this.qrCodeUrl.set(dataUrl))
          .catch(() => this.qrCodeUrl.set(null));
      },
      { injector: this.injector },
    );
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
  private afficheText(profile: CvProfile, key: string): string | null {
    const value = profile.extra?.[AFFICHE_EXTRA_KEY]?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    const fallback = this.cvProfileExtra.text(profile, key);
    return fallback?.trim() || null;
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
