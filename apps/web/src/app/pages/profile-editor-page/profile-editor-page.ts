import { ChangeDetectionStrategy, Component, computed, effect, inject, Injector, input, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { QuillModule } from 'ngx-quill';
import { RouterLink } from '@angular/router';
import { Achievement } from '../../core/models/achievement.model';
import { CvProfile, CvProfileExtraValue, CvProfileLinkOverrides, CvProfileStatus } from '../../core/models/cv-profile.model';
import { Degree } from '../../core/models/degree.model';
import { MediaFile } from '../../core/models/file.model';
import { Hobby } from '../../core/models/hobby.model';
import { Job } from '../../core/models/job.model';
import { Project } from '../../core/models/project.model';
import { Skill } from '../../core/models/skill.model';
import { CurrentUserCvProfileEditorData, PocketBaseService } from '../../core/services/pocketbase.service';
import { CV_TEMPLATE_OPTIONS, CV_TEMPLATE_OPTIONS_BY_ID, CvTemplateExtraField, CvTemplateExtraFieldSource } from '../../core/templates/cv-template-registry';
import { getErrorMessage } from '../../core/utils/error-message';
import { Navbar } from '../../shared/components/navbar/navbar';

export const CV_PROFILE_STATUS_OPTIONS: { value: CvProfileStatus; label: string; tone: string }[] = [
  { value: 'unsent', label: 'Non envoye', tone: 'gray' },
  { value: 'sent', label: 'Envoye', tone: 'blue' },
  { value: 'rejected', label: 'Rejete', tone: 'red' },
  { value: 'responded', label: 'Repondu', tone: 'green' },
  { value: 'unanswered', label: 'Sans reponse', tone: 'yellow' },
];

export const CV_PROFILE_SELECTABLE_STATUS_OPTIONS = CV_PROFILE_STATUS_OPTIONS.filter((o) => o.value !== 'unanswered');

type RelationType = 'jobs' | 'projects' | 'skills' | 'degrees' | 'achievements' | 'hobbies';
type ExtraSourceRecord = Job | Project | Skill | Degree | Achievement | Hobby;

type EditorState = {
  profile: CvProfile;
  availableJobs: Job[];
  availableProjects: Project[];
  availableSkills: Skill[];
  availableDegrees: Degree[];
  availableAchievements: Achievement[];
  availableHobbies: Hobby[];
  availablePictures: MediaFile[];
};

type PictureField = 'profilePictureFile' | 'coverPictureFile';
type EditorTab = 'identity' | 'summary' | 'media' | 'relations' | 'template';

@Component({
  selector: 'app-profile-editor-page',
  imports: [FormsModule, Navbar, RouterLink, QuillModule],
  templateUrl: './profile-editor-page.html',
  styleUrls: ['./profile-editor-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileEditorPage implements OnInit, OnDestroy {
  private readonly pocketBaseService = inject(PocketBaseService);
  private readonly injector = inject(Injector);
  private requestId = 0;

  readonly profileId = input.required<string>();
  readonly templateOptions = CV_TEMPLATE_OPTIONS;
  readonly selectableStatusOptions = CV_PROFILE_SELECTABLE_STATUS_OPTIONS;
  readonly statusOptions = CV_PROFILE_STATUS_OPTIONS;
  readonly editorState = signal<EditorState | null>(null);
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly isProfileSaving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly profileSaveMessage = signal<string | null>(null);
  readonly summaryEditorModules = {
    toolbar: [
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link'],
      ['clean'],
    ],
  };

  readonly activeTab = signal<EditorTab>('identity');
  readonly completionPercentage = computed(() => {
    const state = this.editorState();

    if (!state) {
      return 0;
    }

    const profile = state.profile;
    const checks = [
      Boolean(profile.profileName?.trim()),
      Boolean(profile.template),
      Boolean(profile.professionalSummary),
      (profile.jobs ?? []).length > 0,
      (profile.skills ?? []).length > 0,
      (profile.degrees ?? []).length > 0,
      Boolean(profile.profilePictureFile),
      Boolean(profile.coverPictureFile),
    ];
    const completed = checks.filter(Boolean).length;

    return Math.round((completed / checks.length) * 100);
  });

  setActiveTab(tab: EditorTab): void {
    this.activeTab.set(tab);
  }

  getStatusTone(status?: CvProfileStatus): string {
    const tone = this.getStatusOption(status)?.tone;
    return tone === 'gray' ? 'muted' : tone ?? 'muted';
  }

  ngOnInit(): void {
    effect(
      () => {
        void this.loadEditorData(this.profileId());
      },
      { injector: this.injector },
    );
  }

  ngOnDestroy(): void {
    // No cleanup needed — autosave removed
  }

  async save(): Promise<void> {
    const state = this.editorState();

    if (!state) {
      return;
    }

    const profileName = state.profile.profileName.trim();
    if (!profileName) {
      this.errorMessage.set('Le nom du profil est obligatoire.');
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const label = state.profile.label?.trim() || '';
      await this.pocketBaseService.updateCurrentUserCvProfile(state.profile.id, {
        label,
        profileName,
        public: state.profile.public !== false,
        template: state.profile.template,
        professionalSummary: this.normalizeSummaryHtml(state.profile.professionalSummary),
        jobs: state.profile.jobs ?? [],
        projects: state.profile.projects ?? [],
        skills: state.profile.skills ?? [],
        degrees: state.profile.degrees ?? [],
        achievements: state.profile.achievements ?? [],
        hobbies: state.profile.hobbies ?? [],
        profilePictureFile: state.profile.profilePictureFile || '',
        coverPictureFile: state.profile.coverPictureFile || '',
        extra: state.profile.extra ?? {},
        linkOverrides: state.profile.linkOverrides,
        status: state.profile.status,
      });

      await this.loadEditorData(state.profile.id, false);
      this.successMessage.set('Profil enregistre.');
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      this.isSaving.set(false);
    }
  }

  setProfileLabel(value: string): void {
    this.updateProfileField('label', value);
  }

  setProfileName(value: string): void {
    this.updateProfileField('profileName', value);
  }

  setProfileTemplate(value: string): void {
    this.updateProfileField('template', value || undefined);
    void this.saveProfileFields();
  }

  setProfilePublic(value: boolean): void {
    this.updateProfileField('public', value);
    void this.saveProfileFields();
  }

  setProfilePictureFile(value: string): void {
    this.updateProfileField('profilePictureFile', value || undefined);
    void this.saveProfileFields();
  }

  setCoverPictureFile(value: string): void {
    this.updateProfileField('coverPictureFile', value || undefined);
    void this.saveProfileFields();
  }

  setStatusAndSave(status: CvProfileStatus): void {
    this.setStatus(status);
    void this.saveProfileFields();
  }

  async saveProfileFields(): Promise<void> {
    const state = this.editorState();

    if (!state) {
      return;
    }

    const profileName = state.profile.profileName.trim();
    if (!profileName) {
      this.errorMessage.set('Le nom du profil est obligatoire.');
      return;
    }

    this.isProfileSaving.set(true);
    this.errorMessage.set(null);
    this.profileSaveMessage.set(null);

    try {
      await this.pocketBaseService.updateCurrentUserCvProfile(state.profile.id, {
        label: state.profile.label?.trim() || '',
        profileName,
        public: state.profile.public !== false,
        template: state.profile.template || '',
        profilePictureFile: state.profile.profilePictureFile || '',
        coverPictureFile: state.profile.coverPictureFile || '',
        status: state.profile.status,
        professionalSummary: this.normalizeSummaryHtml(state.profile.professionalSummary),
        jobs: state.profile.jobs ?? [],
        projects: state.profile.projects ?? [],
        skills: state.profile.skills ?? [],
        degrees: state.profile.degrees ?? [],
        achievements: state.profile.achievements ?? [],
        hobbies: state.profile.hobbies ?? [],
        extra: state.profile.extra ?? {},
        linkOverrides: state.profile.linkOverrides,
      });

      await this.loadEditorData(state.profile.id, false);
      this.profileSaveMessage.set('Profil CV enregistre.');
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      this.isProfileSaving.set(false);
    }
  }

  addRelation(type: RelationType, recordId: string): void {
    let changed = false;

    this.editorState.update((state) => {
      if (!state) {
        return state;
      }

      const currentIds = state.profile[type] ?? [];
      if (currentIds.includes(recordId)) {
        return state;
      }

      changed = true;

      return {
        ...state,
        profile: {
          ...state.profile,
          [type]: [...currentIds, recordId],
        },
      };
    });

    if (changed) {
      void this.saveProfileFields();
    }
  }

  removeRelation(type: RelationType, recordId: string): void {
    let changed = false;

    this.editorState.update((state) => {
      if (!state) {
        return state;
      }

      const nextIds = (state.profile[type] ?? []).filter((id) => id !== recordId);
      changed = nextIds.length !== (state.profile[type] ?? []).length;

      return {
        ...state,
        profile: {
          ...state.profile,
          [type]: nextIds,
        },
      };
    });

    if (changed) {
      void this.saveProfileFields();
    }
  }

  getSelectedTemplateExtraSchema(state: EditorState): CvTemplateExtraField[] {
    const templateId = state.profile.template;
    return (templateId ? CV_TEMPLATE_OPTIONS_BY_ID.get(templateId)?.extraSchema : undefined) ?? [];
  }

  getExtraValue(state: EditorState, field: CvTemplateExtraField): CvProfileExtraValue | undefined {
    const templateId = state.profile.template;
    return templateId ? state.profile.extra?.[templateId]?.[field.id] : undefined;
  }

  getExtraTextValue(state: EditorState, field: CvTemplateExtraField): string {
    const value = this.getExtraValue(state, field);
    return typeof value === 'string' ? value : '';
  }

  getExtraBooleanValue(state: EditorState, field: CvTemplateExtraField): boolean {
    return this.getExtraValue(state, field) === true;
  }

  getExtraStringArrayValue(state: EditorState, field: CvTemplateExtraField): string[] {
    const value = this.getExtraValue(state, field);
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  }

  setExtraValue(field: CvTemplateExtraField, value: CvProfileExtraValue): void {
    this.editorState.update((state) => {
      const templateId = state?.profile.template;

      if (!state || !templateId) {
        return state;
      }

      return {
        ...state,
        profile: {
          ...state.profile,
          extra: {
            ...(state.profile.extra ?? {}),
            [templateId]: {
              ...(state.profile.extra?.[templateId] ?? {}),
              [field.id]: value,
            },
          },
        },
      };
    });
  }

  /**
   * An emptied Quill instance persists an empty string instead of its `<p><br></p>` placeholder
   * markup. The summary-specific quote rewriting is deliberately left out: an extra may legitimately
   * open and close on a quotation mark (pull quote), and stripping it would fight every keystroke.
   */
  setExtraRichTextValue(field: CvTemplateExtraField, value: string): void {
    this.setExtraValue(field, this.normalizeRichTextHtml(value) ?? '');
  }

  setProfessionalSummary(value: string): void {
    const professionalSummary = this.normalizeSummaryHtml(value);

    this.editorState.update((state) => {
      if (!state) {
        return state;
      }

      return {
        ...state,
        profile: {
          ...state.profile,
          professionalSummary,
        },
      };
    });
  }

  /**
   * Shared rich-text normalization: drops Quill's empty-editor placeholders and any markup carrying
   * neither text nor media, and keeps everything else verbatim.
   */
  private normalizeRichTextHtml(value: string | undefined): string | undefined {
    const html = value?.trim() ?? '';

    if (!html || html === '<br>') {
      return undefined;
    }

    // Parse untrusted HTML in an inert document to avoid loading media or firing handlers.
    const container = new DOMParser().parseFromString(html, 'text/html').body;
    const hasMediaOrStructure = !!container.querySelector('img,video,iframe,ul,ol,li,table,hr');
    const text = container.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';

    return text || hasMediaOrStructure ? html : undefined;
  }

  /**
   * Summary-only cleanup on top of {@link normalizeRichTextHtml}: an AI-generated summary arrives
   * JSON-quoted or wrapped in quotation marks often enough to be worth unwrapping here.
   */
  private normalizeSummaryHtml(value: string | undefined): string | undefined {
    let html = value?.trim() ?? '';

    if (!html || html === '<br>') {
      return undefined;
    }

    if (html.startsWith('"') && html.endsWith('"')) {
      try {
        const parsed = JSON.parse(html);
        if (typeof parsed === 'string') {
          html = parsed.trim();
        }
      } catch {
        html = html.slice(1, -1).trim();
      }
    }

    html = html
      .replace(/^<p>(["“”])/, '<p>')
      .replace(/(["“”])<\/p>$/, '</p>')
      .replace(/^(["“”])(<[a-z][\s\S]*>)/i, '$2')
      .replace(/(<\/[a-z]+>)(["“”])$/i, '$1');

    return this.normalizeRichTextHtml(html);
  }

  setLinkOverrideField(field: keyof CvProfileLinkOverrides, value: string): void {
    this.editorState.update((state) => {
      if (!state) {
        return state;
      }

      const currentOverrides = state.profile.linkOverrides ?? {};
      const updatedOverrides: CvProfileLinkOverrides = { ...currentOverrides, [field]: value || undefined };

      return {
        ...state,
        profile: {
          ...state.profile,
          linkOverrides: updatedOverrides,
        },
      };
    });
  }

  setStatus(status: CvProfileStatus): void {
    this.editorState.update((state) => {
      if (!state) {
        return state;
      }

      return {
        ...state,
        profile: {
          ...state.profile,
          status,
        },
      };
    });
  }

  private updateProfileField<K extends keyof CvProfile>(field: K, value: CvProfile[K]): void {
    this.editorState.update((state) => {
      if (!state) {
        return state;
      }

      return {
        ...state,
        profile: {
          ...state.profile,
          [field]: value,
        },
      };
    });
  }

  getStatusOption(status?: CvProfileStatus): { value: CvProfileStatus; label: string; tone: string } | undefined {
    if (!status) {
      return this.statusOptions.find((opt) => opt.value === 'unsent');
    }

    return this.statusOptions.find((opt) => opt.value === status);
  }

  addExtraSourceValue(field: CvTemplateExtraField, recordId: string): void {
    const state = this.editorState();

    if (!state) {
      return;
    }

    const currentIds = this.getExtraStringArrayValue(state, field);
    if (!currentIds.includes(recordId)) {
      this.setExtraValue(field, [...currentIds, recordId]);
    }
  }

  removeExtraSourceValue(field: CvTemplateExtraField, recordId: string): void {
    const state = this.editorState();

    if (!state) {
      return;
    }

    this.setExtraValue(
      field,
      this.getExtraStringArrayValue(state, field).filter((id) => id !== recordId),
    );
  }

  getLinkedExtraSourceRecords(state: EditorState, field: CvTemplateExtraField): ExtraSourceRecord[] {
    return this.getLinkedRecords(this.getExtraSourceRecords(state, field.source), this.getExtraStringArrayValue(state, field));
  }

  getAvailableExtraSourceRecords(state: EditorState, field: CvTemplateExtraField): ExtraSourceRecord[] {
    return this.getUnlinkedRecords(this.getExtraSourceRecords(state, field.source), this.getExtraStringArrayValue(state, field));
  }

  getExtraSourceRecordTitle(record: ExtraSourceRecord): string {
    if ('company' in record) {
      return record.company;
    }

    if ('title' in record) {
      return record.title;
    }

    return record.name;
  }

  getExtraSourceRecordDescription(record: ExtraSourceRecord): string {
    if ('company' in record) {
      return record.position;
    }

    if ('date' in record) {
      return record.date || 'Sans date';
    }

    if ('category' in record) {
      return this.getSkillDescription(record);
    }

    if ('type' in record) {
      return record.type || 'Sans type';
    }

    if ('school' in record) {
      return record.school || 'Sans ecole';
    }

    if ('description' in record) {
      return record.description || 'Sans description';
    }

    return 'Sans description';
  }

  getLinkedJobs(state: EditorState): Job[] {
    return this.getLinkedRecords(state.availableJobs, state.profile.jobs);
  }

  getAvailableJobs(state: EditorState): Job[] {
    return this.getUnlinkedRecords(state.availableJobs, state.profile.jobs);
  }

  getLinkedProjects(state: EditorState): Project[] {
    return this.getLinkedRecords(state.availableProjects, state.profile.projects);
  }

  getAvailableProjects(state: EditorState): Project[] {
    return this.getUnlinkedRecords(state.availableProjects, state.profile.projects);
  }

  getLinkedSkills(state: EditorState): Skill[] {
    return this.getLinkedRecords(state.availableSkills, state.profile.skills);
  }

  getAvailableSkills(state: EditorState): Skill[] {
    return this.getUnlinkedRecords(state.availableSkills, state.profile.skills);
  }

  getSkillDescription(skill: Skill): string {
    const categoryName = skill.expand?.category?.name || '';

    return [skill.type, categoryName].filter(Boolean).join(' · ') || 'Sans type';
  }

  getLinkedDegrees(state: EditorState): Degree[] {
    return this.getLinkedRecords(state.availableDegrees, state.profile.degrees);
  }

  getAvailableDegrees(state: EditorState): Degree[] {
    return this.getUnlinkedRecords(state.availableDegrees, state.profile.degrees);
  }

  getLinkedAchievements(state: EditorState): Achievement[] {
    return this.getLinkedRecords(state.availableAchievements, state.profile.achievements);
  }

  getAvailableAchievements(state: EditorState): Achievement[] {
    return this.getUnlinkedRecords(state.availableAchievements, state.profile.achievements);
  }

  getLinkedHobbies(state: EditorState): Hobby[] {
    return this.getLinkedRecords(state.availableHobbies, state.profile.hobbies);
  }

  getAvailableHobbies(state: EditorState): Hobby[] {
    return this.getUnlinkedRecords(state.availableHobbies, state.profile.hobbies);
  }

  getPicturePreview(state: EditorState, field: PictureField): string | undefined {
    const selectedPicture = this.getSelectedPicture(state, field);

    if (selectedPicture) {
      return selectedPicture.file;
    }

    return field === 'profilePictureFile' ? state.profile.profilePicture : state.profile.coverPicture;
  }

  getSelectedPictureName(state: EditorState, field: PictureField): string {
    const selectedPicture = this.getSelectedPicture(state, field);
    return selectedPicture?.name || selectedPicture?.alt || 'Image selectionnee';
  }

  private async loadEditorData(profileId: string, showLoading = true): Promise<void> {
    const currentRequestId = ++this.requestId;
    if (showLoading) {
      this.isLoading.set(true);
    }
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const data = await this.pocketBaseService.getCurrentUserCvProfileEditorData(profileId);

      if (currentRequestId !== this.requestId) {
        return;
      }

      this.editorState.set(this.toEditorState(data));
    } catch (error: unknown) {
      if (currentRequestId !== this.requestId) {
        return;
      }

      this.editorState.set(null);
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      if (currentRequestId === this.requestId && showLoading) {
        this.isLoading.set(false);
      }
    }
  }

  private toEditorState(data: CurrentUserCvProfileEditorData): EditorState {
    return {
      profile: {
        ...data.profile,
        jobs: [...(data.profile.jobs ?? [])],
        projects: [...(data.profile.projects ?? [])],
        skills: [...(data.profile.skills ?? [])],
        degrees: [...(data.profile.degrees ?? [])],
        achievements: [...(data.profile.achievements ?? [])],
        hobbies: [...(data.profile.hobbies ?? [])],
        extra: data.profile.extra ?? {},
      },
      availableJobs: data.availableJobs,
      availableProjects: data.availableProjects,
      availableSkills: data.availableSkills,
      availableDegrees: data.availableDegrees,
      availableAchievements: data.availableAchievements,
      availableHobbies: data.availableHobbies,
      availablePictures: data.availablePictures,
    };
  }

  private getSelectedPicture(state: EditorState, field: PictureField): MediaFile | undefined {
    const selectedId = state.profile[field];
    return selectedId ? state.availablePictures.find((picture) => picture.id === selectedId) : undefined;
  }

  private getLinkedRecords<T extends { id: string }>(records: T[], selectedIds: string[] | undefined): T[] {
    const selectedIdSet = new Set(selectedIds ?? []);
    return records.filter((record) => selectedIdSet.has(record.id));
  }

  private getUnlinkedRecords<T extends { id: string }>(records: T[], selectedIds: string[] | undefined): T[] {
    const selectedIdSet = new Set(selectedIds ?? []);
    return records.filter((record) => !selectedIdSet.has(record.id));
  }

  private getExtraSourceRecords(state: EditorState, source: CvTemplateExtraFieldSource | undefined): ExtraSourceRecord[] {
    switch (source) {
      case 'jobs':
        return state.availableJobs;
      case 'projects':
        return state.availableProjects;
      case 'skills':
        return state.availableSkills;
      case 'degrees':
        return state.availableDegrees;
      case 'achievements':
        return state.availableAchievements;
      case 'hobbies':
        return state.availableHobbies;
      default:
        return [];
    }
  }
}
