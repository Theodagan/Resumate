import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { QuillModule } from 'ngx-quill';
import { Achievement } from '../../core/models/achievement.model';
import { Degree } from '../../core/models/degree.model';
import { MediaFile } from '../../core/models/file.model';
import { Hobby } from '../../core/models/hobby.model';
import { Job } from '../../core/models/job.model';
import { Project } from '../../core/models/project.model';
import { Skill } from '../../core/models/skill.model';
import { SkillCategory } from '../../core/models/skill-category.model';
import { AuthService } from '../../core/services/auth.service';
import {
  PocketBaseService,
  SaveCurrentUserAchievementInput,
  SaveCurrentUserDegreeInput,
  SaveCurrentUserFileInput,
  SaveCurrentUserHobbyInput,
  SaveCurrentUserJobInput,
  SaveCurrentUserProjectInput,
  SaveCurrentUserSkillInput,
  UpdateCurrentUserInput,
} from '../../core/services/pocketbase.service';
import { getErrorMessage } from '../../core/utils/error-message';
import { FormFieldComponent } from '../../shared/components/form-field/form-field';
import { HelpFabComponent } from '../../shared/components/help-fab/help-fab';
import { HelpModalComponent } from '../../shared/components/help-modal/help-modal';
import { Navbar } from '../../shared/components/navbar/navbar';
import { PickerComponent, PickerItem } from '../../shared/components/picker/picker';
import { SortableListDirective } from '../../shared/components/sortable-list/sortable-list';
import { TooltipDirective } from '../../shared/components/tooltip/tooltip';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state';

type JobForm = Omit<SaveCurrentUserJobInput, 'sortOrder'> & { id?: string; sortOrder: number | null };
type SkillForm = Omit<SaveCurrentUserSkillInput, 'level' | 'sortOrder'> & { id?: string; level: number | null; sortOrder: number | null };
type ProjectForm = Omit<SaveCurrentUserProjectInput, 'picture' | 'sortOrder'> & { id?: string; sortOrder: number | null };
type AchievementForm = Omit<SaveCurrentUserAchievementInput, 'sortOrder'> & { id?: string; sortOrder: number | null };
type DegreeForm = Omit<SaveCurrentUserDegreeInput, 'sortOrder'> & { id?: string; sortOrder: number | null };
type HobbyForm = Omit<SaveCurrentUserHobbyInput, 'sortOrder'> & { id?: string; sortOrder: number | null };
type AssetForm = Omit<SaveCurrentUserFileInput, 'file' | 'sortOrder'> & { id?: string; sortOrder: number | null };
type MaterialSection = 'jobs' | 'projects' | 'skills' | 'achievements' | 'degrees' | 'hobbies' | 'assets';

interface MaterialTab {
  readonly section: MaterialSection;
  readonly label: string;
  readonly eyebrow: string;
  readonly description: string;
  readonly tooltipText: string;
}

const EMPTY_JOB_FORM: JobForm = {
  label: '',
  company: '',
  position: '',
  location: '',
  startDate: '',
  endDate: '',
  responsibilities: '',
  sortOrder: null,
  type: 'work project',
};

const EMPTY_SKILL_FORM: SkillForm = {
  name: '',
  category: '',
  type: 'Technical',
  level: null,
  sortOrder: null,
};

const EMPTY_PROJECT_FORM: ProjectForm = {
  name: '',
  description: '',
  url: '',
  date: '',
  type: 'work project',
  file: '',
  achievements: [],
  sortOrder: null,
};

const EMPTY_ACHIEVEMENT_FORM: AchievementForm = {
  title: '',
  description: '',
  sortOrder: null,
};

const EMPTY_DEGREE_FORM: DegreeForm = {
  title: '',
  school: '',
  year: '',
  level: '',
  sortOrder: null,
};

const EMPTY_HOBBY_FORM: HobbyForm = {
  name: '',
  description: '',
  sortOrder: null,
};

const EMPTY_ASSET_FORM: AssetForm = {
  name: '',
  alt: '',
  kind: 'image',
  sortOrder: null,
};

@Component({
  selector: 'app-profile-material-page',
  imports: [FormsModule, Navbar, QuillModule, HelpFabComponent, HelpModalComponent, TooltipDirective, FormFieldComponent, PickerComponent, SortableListDirective, EmptyStateComponent],
  templateUrl: './profile-material-page.html',
  styleUrls: ['./profile-material-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileMaterialPage implements OnInit, OnDestroy {
  private readonly pocketBaseService = inject(PocketBaseService);
  private readonly authService = inject(AuthService);

  readonly jobs = signal<Job[]>([]);
  readonly skills = signal<Skill[]>([]);
  readonly skillCategories = signal<SkillCategory[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly achievements = signal<Achievement[]>([]);
  readonly degrees = signal<Degree[]>([]);
  readonly hobbies = signal<Hobby[]>([]);
  readonly assets = signal<MediaFile[]>([]);

  readonly jobForm = signal<JobForm>({ ...EMPTY_JOB_FORM });
  readonly skillForm = signal<SkillForm>({ ...EMPTY_SKILL_FORM });
  readonly projectForm = signal<ProjectForm>({ ...EMPTY_PROJECT_FORM, achievements: [] });
  readonly achievementForm = signal<AchievementForm>({ ...EMPTY_ACHIEVEMENT_FORM });
  readonly degreeForm = signal<DegreeForm>({ ...EMPTY_DEGREE_FORM });
  readonly hobbyForm = signal<HobbyForm>({ ...EMPTY_HOBBY_FORM });
  readonly assetForm = signal<AssetForm>({ ...EMPTY_ASSET_FORM });
  readonly jobFormSubmitted = signal(false);
  readonly projectFormSubmitted = signal(false);
  readonly skillFormSubmitted = signal(false);
  readonly achievementFormSubmitted = signal(false);
  readonly degreeFormSubmitted = signal(false);
  readonly hobbyFormSubmitted = signal(false);
  readonly assetFormSubmitted = signal(false);

  readonly personalInfoForm = signal<UpdateCurrentUserInput>({});
  readonly isSavingPersonalInfo = signal(false);

  readonly selectedProjectPicture = signal<File | null>(null);
  readonly selectedAssetFile = signal<File | null>(null);
  readonly editorModules = {
    toolbar: [
      ['bold', 'italic', 'underline', 'strike'],
      [{ header: [1, 2, 3, false] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ align: [] }],
      ['blockquote'],
      ['link'],
      ['clean'],
    ],
  };
  readonly isLoading = signal(true);
  readonly savingSection = signal<string | null>(null);
  readonly creatingProjectAchievement = signal(false);
  readonly creatingSkillCategory = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly activeSection = signal<MaterialSection>('jobs');
  readonly projectAchievementQuery = signal('');
  readonly skillCategoryQuery = signal('');
  readonly newSkillCategoryName = signal('');
  readonly showHelpModal = signal(false);
  readonly sectionOrderDirty = signal<Record<MaterialSection, boolean>>({ jobs: false, projects: false, skills: false, achievements: false, degrees: false, hobbies: false, assets: false });
  readonly sectionOrderSaving = signal<Record<MaterialSection, boolean>>({ jobs: false, projects: false, skills: false, achievements: false, degrees: false, hobbies: false, assets: false });
  readonly persistedJobs = signal<Job[]>([]);
  readonly persistedProjects = signal<Project[]>([]);
  readonly persistedSkills = signal<Skill[]>([]);
  readonly persistedAchievements = signal<Achievement[]>([]);
  readonly persistedDegrees = signal<Degree[]>([]);
  readonly persistedHobbies = signal<Hobby[]>([]);
  readonly persistedAssets = signal<MediaFile[]>([]);
  readonly materialTabs: MaterialTab[] = [
    { section: 'jobs', label: 'Experiences', eyebrow: 'Parcours', description: 'Postes, missions et contexte chronologique.', tooltipText: 'Vos experiences professionnelles : postes, missions et responsabilites' },
    { section: 'projects', label: 'Projets', eyebrow: 'Preuves', description: 'Cas concrets relies aux realisations et assets.', tooltipText: 'Projets concrets reliant realisations et assets' },
    { section: 'skills', label: 'Competences', eyebrow: 'Savoir-faire', description: 'Competences groupees par categories.', tooltipText: 'Competences organisees par categories (techniques, pro, langues...)' },
    { section: 'achievements', label: 'Realisations', eyebrow: 'Impact', description: 'Resultats reutilisables dans les projets et CV.', tooltipText: 'Realisations reutilisables, preuves d\'impact mesurable' },
    { section: 'degrees', label: 'Diplomes', eyebrow: 'Formation', description: 'Etudes, certifications et niveaux.', tooltipText: 'Diplomes, certifications et formations' },
    { section: 'hobbies', label: 'Loisirs', eyebrow: 'Profil', description: 'Centres d\'interet utiles au storytelling.', tooltipText: 'Centres d\'interet et loisirs' },
    { section: 'assets', label: 'Assets', eyebrow: 'Medias', description: 'Images, documents et supports reutilisables.', tooltipText: 'Fichiers media (images, documents) utilisables dans vos projets et CV' },
  ];
  readonly currentUser = this.authService.currentUser;
  readonly currentUserName = computed(() => {
    const user = this.currentUser();
    return user ? `${user.firstName} ${user.lastName}` : 'Utilisateur authentifie';
  });
  readonly totalMaterialCount = computed(
    () => this.jobs().length + this.skills().length + this.projects().length + this.achievements().length + this.degrees().length + this.hobbies().length + this.assets().length,
  );
  readonly selectedProjectAchievements = computed(() => {
    const selectedIds = this.projectForm().achievements ?? [];
    const achievementsById = new Map(this.achievements().map((achievement) => [achievement.id, achievement]));

    return selectedIds.map((achievementId) => achievementsById.get(achievementId)).filter((achievement): achievement is Achievement => !!achievement);
  });
  readonly filteredAvailableProjectAchievements = computed(() => {
    const selectedIdSet = new Set(this.projectForm().achievements ?? []);
    const query = this.projectAchievementQuery();

    return this.achievements().filter((achievement) => {
      if (selectedIdSet.has(achievement.id)) {
        return false;
      }

      return this.matchesFuzzyQuery([achievement.title, achievement.description], query);
    });
  });
  readonly canCreateProjectAchievement = computed(() => {
    const title = this.projectAchievementQuery().trim();

    if (!title || this.creatingProjectAchievement()) {
      return false;
    }

    const normalizedTitle = this.normalizeSearchValue(title);
    return !this.achievements().some((achievement) => this.normalizeSearchValue(achievement.title) === normalizedTitle);
  });
  readonly selectedSkillCategory = computed(() => {
    const categoryId = this.skillForm().category;

    return categoryId ? this.skillCategories().find((category) => category.id === categoryId) : undefined;
  });
  readonly filteredSkillCategories = computed(() => {
    const selectedCategoryId = this.skillForm().category;
    const query = this.skillCategoryQuery();

    return this.skillCategories().filter((category) => {
      if (category.id === selectedCategoryId) {
        return false;
      }

      return this.matchesFuzzyQuery([category.name], query);
    });
  });
  readonly canCreateSkillCategoryFromQuery = computed(() => this.canCreateSkillCategory(this.skillCategoryQuery()));
  readonly canCreateStandaloneSkillCategory = computed(() => this.canCreateSkillCategory(this.newSkillCategoryName()));
  readonly projectAchievementPickerItems = computed<PickerItem[]>(() =>
    this.achievements().map((a) => ({ id: a.id, label: a.title, subtitle: a.description || undefined })),
  );
  readonly skillCategoryPickerItems = computed<PickerItem[]>(() =>
    this.skillCategories().map((c) => ({ id: c.id, label: c.name })),
  );
  readonly assetPickerItems = computed<PickerItem[]>(() =>
    this.assets().map((a) => ({ id: a.id, label: a.name || a.file })),
  );
  readonly selectedProjectFileIds = computed<string[]>(() => {
    const file = this.projectForm().file;
    return file ? [file] : [];
  });
  readonly selectedSkillCategoryIds = computed<string[]>(() => {
    const category = this.skillForm().category;
    return category ? [category] : [];
  });

  ngOnInit(): void {
    this.initPersonalInfoForm();
    void this.loadMaterial();
  }

  ngOnDestroy(): void {
    // No cleanup needed — autosave removed
  }

  editJob(job: Job): void {
    this.setActiveSection('jobs');
    const responsibilities = job.responsibilities ?? '';
    this.jobForm.set({
      id: job.id,
      label: job.label,
      company: job.company,
      position: job.position,
      location: job.location ?? '',
      startDate: job.startDate?.slice(0, 10) ?? '',
      endDate: job.endDate?.slice(0, 10) ?? '',
      responsibilities,
      sortOrder: job.sortOrder ?? null,
      type: job.type,
    });
    this.scrollToSection('jobs-section', 'input[name="job-label"]');
  }

  resetJobForm(): void {
    this.jobForm.set({ ...EMPTY_JOB_FORM });
  }

  setJobFormValue(field: keyof Omit<JobForm, 'id' | 'sortOrder'>, value: string): void {
    this.jobForm.update((form) => ({ ...form, [field]: value }));
  }

  async saveJob(resetAfterSave = true): Promise<void> {
    this.jobFormSubmitted.set(true);
    const form = this.jobForm();
    const input: SaveCurrentUserJobInput = {
      label: form.label.trim(),
      company: form.company.trim(),
      position: form.position.trim(),
      startDate: form.startDate,
      type: form.type,
      location: this.optionalText(form.location),
      endDate: form.endDate || undefined,
      responsibilities: this.normalizeHtmlEditorValue(form.responsibilities),
      sortOrder: form.sortOrder ?? undefined,
    };

    if (!input.label || !input.company || !input.position || !input.startDate || !input.type) {
      return;
    }

    await this.saveSection('jobs', form.id ? 'Experience mise a jour.' : 'Experience ajoutee.', async () => {
      form.id ? await this.pocketBaseService.updateCurrentUserJob(form.id, input) : await this.pocketBaseService.createCurrentUserJob(input);
      if (resetAfterSave) {
        this.resetJobForm();
        this.jobFormSubmitted.set(false);
      }
    });
  }

  editSkill(skill: Skill): void {
    this.setActiveSection('skills');
    this.skillForm.set({
      id: skill.id,
      name: skill.name,
      category: skill.category ?? '',
      type: skill.type ?? 'Technical',
      level: skill.level ?? null,
      sortOrder: skill.sortOrder ?? null,
    });
    this.scrollToSection('skills-section', 'input[name="skill-name"]');
  }

  resetSkillForm(): void {
    this.skillForm.set({ ...EMPTY_SKILL_FORM });
    this.skillCategoryQuery.set('');
  }

  setSkillFormValue(field: keyof Omit<SkillForm, 'id' | 'level' | 'sortOrder'>, value: string): void {
    this.skillForm.update((form) => ({ ...form, [field]: value }));
  }

  setSkillLevel(value: string | number | null): void {
    this.skillForm.update((form) => ({ ...form, level: this.toNullableNumber(value) }));
    if (this.skillForm().id) {
      void this.saveSkill(false);
    }
  }

  setSkillCategoryQuery(value: string): void {
    this.skillCategoryQuery.set(value);
  }

  setNewSkillCategoryName(value: string): void {
    this.newSkillCategoryName.set(value);
  }

  selectSkillCategory(categoryId: string): void {
    this.skillForm.update((form) => ({ ...form, category: categoryId }));
    this.skillCategoryQuery.set('');
    if (this.skillForm().id) {
      void this.saveSkill(false);
    }
  }

  clearSkillCategory(): void {
    this.skillForm.update((form) => ({ ...form, category: '' }));
    if (this.skillForm().id) {
      void this.saveSkill(false);
    }
  }

  async createAndSelectSkillCategory(): Promise<void> {
    const created = await this.createSkillCategoryFromName(this.skillCategoryQuery(), 'Categorie creee et selectionnee.');

    if (created) {
      this.selectSkillCategory(created.id);
    }
  }

  async createStandaloneSkillCategory(): Promise<void> {
    const created = await this.createSkillCategoryFromName(this.newSkillCategoryName(), 'Categorie ajoutee.');

    if (created) {
      this.newSkillCategoryName.set('');
    }
  }

  async saveSkill(resetAfterSave = true): Promise<void> {
    this.skillFormSubmitted.set(true);
    const form = this.skillForm();
    const input: SaveCurrentUserSkillInput = {
      name: form.name.trim(),
      category: this.optionalText(form.category),
      type: this.optionalText(form.type),
      level: form.level ?? undefined,
      sortOrder: form.sortOrder ?? undefined,
    };

    if (!input.name) {
      return;
    }

    await this.saveSection('skills', form.id ? 'Competence mise a jour.' : 'Competence ajoutee.', async () => {
      form.id ? await this.pocketBaseService.updateCurrentUserSkill(form.id, input) : await this.pocketBaseService.createCurrentUserSkill(input);
      if (resetAfterSave) {
        this.resetSkillForm();
        this.skillFormSubmitted.set(false);
      }
    });
  }

  editProject(project: Project): void {
    this.setActiveSection('projects');
    this.projectForm.set({
      id: project.id,
      name: project.name,
      description: project.description ?? '',
      url: project.url ?? '',
      date: project.date ?? '',
      type: project.type ?? 'work project',
      file: project.file ?? '',
      achievements: [...(project.achievements ?? [])],
      sortOrder: project.sortOrder ?? null,
    });
    this.selectedProjectPicture.set(null);
    this.projectAchievementQuery.set('');
    this.scrollToSection('projects-section', 'input[name="project-name"]');
  }

  resetProjectForm(): void {
    this.projectForm.set({ ...EMPTY_PROJECT_FORM, achievements: [] });
    this.selectedProjectPicture.set(null);
    this.projectAchievementQuery.set('');
  }

  setProjectFormValue(field: keyof Omit<ProjectForm, 'id' | 'sortOrder' | 'achievements'>, value: string): void {
    this.projectForm.update((form) => ({ ...form, [field]: value }));
  }

  toggleProjectAchievement(achievementId: string, selected: boolean): void {
    this.projectForm.update((form) => ({
      ...form,
      achievements: selected
        ? Array.from(new Set([...(form.achievements ?? []), achievementId]))
        : (form.achievements ?? []).filter((id) => id !== achievementId),
    }));
    if (this.projectForm().id) {
      void this.saveProject(false);
    }
  }

  addProjectAchievement(achievementId: string): void {
    this.toggleProjectAchievement(achievementId, true);
  }

  removeProjectAchievement(achievementId: string): void {
    this.toggleProjectAchievement(achievementId, false);
  }

  setProjectAchievementQuery(value: string): void {
    this.projectAchievementQuery.set(value);
  }

  async createAndLinkProjectAchievement(): Promise<void> {
    const title = this.projectAchievementQuery().trim();

    if (!title) {
      this.errorMessage.set('Le titre de la realisation est obligatoire.');
      return;
    }

    const existingAchievement = this.achievements().find((achievement) => this.normalizeSearchValue(achievement.title) === this.normalizeSearchValue(title));
    if (existingAchievement) {
      this.addProjectAchievement(existingAchievement.id);
      this.projectAchievementQuery.set('');
      return;
    }

    this.creatingProjectAchievement.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const created = await this.pocketBaseService.createCurrentUserAchievement({ title });
      this.achievements.update((achievements) => [...achievements, created]);
      this.addProjectAchievement(created.id);
      this.projectAchievementQuery.set('');
      this.successMessage.set('Realisation creee et liee au projet.');
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      this.creatingProjectAchievement.set(false);
    }
  }

  onProjectAchievementSelectionChange(selectedIds: string[]): void {
    this.projectForm.update((form) => ({ ...form, achievements: selectedIds }));
    if (this.projectForm().id) {
      void this.saveProject(false);
    }
  }

  async onProjectAchievementCreate(name: string): Promise<void> {
    const existingAchievement = this.achievements().find((a) => this.normalizeSearchValue(a.title) === this.normalizeSearchValue(name));
    if (existingAchievement) {
      this.onProjectAchievementSelectionChange([...(this.projectForm().achievements ?? []), existingAchievement.id]);
      return;
    }
    this.creatingProjectAchievement.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    try {
      const created = await this.pocketBaseService.createCurrentUserAchievement({ title: name });
      this.achievements.update((achievements) => [...achievements, created]);
      this.onProjectAchievementSelectionChange([...(this.projectForm().achievements ?? []), created.id]);
      this.successMessage.set('Realisation creee et liee au projet.');
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      this.creatingProjectAchievement.set(false);
    }
  }

  onSkillCategorySelectionChange(selectedIds: string[]): void {
    this.skillForm.update((form) => ({ ...form, category: selectedIds[0] ?? '' }));
    if (this.skillForm().id) {
      void this.saveSkill(false);
    }
  }

  async onSkillCategoryCreate(name: string): Promise<void> {
    const existingCategory = this.skillCategories().find((c) => this.normalizeSearchValue(c.name) === this.normalizeSearchValue(name));
    if (existingCategory) {
      this.onSkillCategorySelectionChange([existingCategory.id]);
      return;
    }
    this.creatingSkillCategory.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    try {
      const created = await this.pocketBaseService.createCurrentUserSkillCategory(name);
      this.skillCategories.update((categories) => [...categories, created]);
      this.onSkillCategorySelectionChange([created.id]);
      this.successMessage.set('Categorie creee et selectionnee.');
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      this.creatingSkillCategory.set(false);
    }
  }

  onProjectAssetSelectionChange(selectedIds: string[]): void {
    this.projectForm.update((form) => ({ ...form, file: selectedIds[0] ?? '' }));
    if (this.projectForm().id) {
      void this.saveProject(false);
    }
  }

  onProjectPictureSelected(event: Event): void {
    this.selectedProjectPicture.set((event.target as HTMLInputElement).files?.[0] ?? null);
    if (this.projectForm().id) {
      void this.saveProject(false);
    }
  }

  async saveProject(resetAfterSave = true): Promise<void> {
    this.projectFormSubmitted.set(true);
    const form = this.projectForm();
    const input: SaveCurrentUserProjectInput = {
      name: form.name.trim(),
      description: this.normalizeHtmlEditorValue(form.description),
      url: this.optionalText(form.url),
      date: this.optionalText(form.date),
      type: form.type || undefined,
      file: this.optionalText(form.file),
      achievements: form.achievements ?? [],
      sortOrder: form.sortOrder ?? undefined,
      picture: this.selectedProjectPicture(),
    };

    if (!input.name) {
      return;
    }

    await this.saveSection('projects', form.id ? 'Projet mis a jour.' : 'Projet ajoute.', async () => {
      form.id ? await this.pocketBaseService.updateCurrentUserProject(form.id, input) : await this.pocketBaseService.createCurrentUserProject(input);
      if (resetAfterSave) {
        this.resetProjectForm();
        this.projectFormSubmitted.set(false);
      }
    });
  }

  editAchievement(achievement: Achievement): void {
    this.setActiveSection('achievements');
    this.achievementForm.set({
      id: achievement.id,
      title: achievement.title,
      description: achievement.description ?? '',
      sortOrder: achievement.sortOrder ?? null,
    });
    this.scrollToSection('achievements-section', 'input[name="achievement-title"]');
  }

  resetAchievementForm(): void {
    this.achievementForm.set({ ...EMPTY_ACHIEVEMENT_FORM });
  }

  setAchievementFormValue(field: keyof Omit<AchievementForm, 'id' | 'sortOrder'>, value: string): void {
    this.achievementForm.update((form) => ({ ...form, [field]: value }));
  }

  async saveAchievement(resetAfterSave = true): Promise<void> {
    this.achievementFormSubmitted.set(true);
    const form = this.achievementForm();
    const input: SaveCurrentUserAchievementInput = {
      title: form.title.trim(),
      description: this.normalizeHtmlEditorValue(form.description),
      sortOrder: form.sortOrder ?? undefined,
    };

    if (!input.title) {
      return;
    }

    await this.saveSection('achievements', form.id ? 'Realisation mise a jour.' : 'Realisation ajoutee.', async () => {
      form.id ? await this.pocketBaseService.updateCurrentUserAchievement(form.id, input) : await this.pocketBaseService.createCurrentUserAchievement(input);
      if (resetAfterSave) {
        this.resetAchievementForm();
        this.achievementFormSubmitted.set(false);
      }
    });
  }

  editDegree(degree: Degree): void {
    this.setActiveSection('degrees');
    this.degreeForm.set({
      id: degree.id,
      title: degree.title,
      school: degree.school ?? '',
      year: degree.year ?? '',
      level: degree.level ?? '',
      sortOrder: degree.sortOrder ?? null,
    });
    this.scrollToSection('degrees-section', 'input[name="degree-title"]');
  }

  resetDegreeForm(): void {
    this.degreeForm.set({ ...EMPTY_DEGREE_FORM });
  }

  setDegreeFormValue(field: keyof Omit<DegreeForm, 'id' | 'sortOrder'>, value: string): void {
    this.degreeForm.update((form) => ({ ...form, [field]: value }));
  }

  async saveDegree(resetAfterSave = true): Promise<void> {
    this.degreeFormSubmitted.set(true);
    const form = this.degreeForm();
    const input: SaveCurrentUserDegreeInput = {
      title: form.title.trim(),
      school: this.optionalText(form.school),
      year: this.optionalText(form.year),
      level: this.optionalText(form.level),
      sortOrder: form.sortOrder ?? undefined,
    };

    if (!input.title) {
      return;
    }

    await this.saveSection('degrees', form.id ? 'Diplome mis a jour.' : 'Diplome ajoute.', async () => {
      form.id ? await this.pocketBaseService.updateCurrentUserDegree(form.id, input) : await this.pocketBaseService.createCurrentUserDegree(input);
      if (resetAfterSave) {
        this.resetDegreeForm();
        this.degreeFormSubmitted.set(false);
      }
    });
  }

  editHobby(hobby: Hobby): void {
    this.setActiveSection('hobbies');
    this.hobbyForm.set({
      id: hobby.id,
      name: hobby.name,
      description: hobby.description ?? '',
      sortOrder: hobby.sortOrder ?? null,
    });
    this.scrollToSection('hobbies-section', 'input[name="hobby-name"]');
  }

  resetHobbyForm(): void {
    this.hobbyForm.set({ ...EMPTY_HOBBY_FORM });
  }

  setHobbyFormValue(field: keyof Omit<HobbyForm, 'id' | 'sortOrder'>, value: string): void {
    this.hobbyForm.update((form) => ({ ...form, [field]: value }));
  }

  async saveHobby(resetAfterSave = true): Promise<void> {
    this.hobbyFormSubmitted.set(true);
    const form = this.hobbyForm();
    const input: SaveCurrentUserHobbyInput = {
      name: form.name.trim(),
      description: this.normalizeHtmlEditorValue(form.description),
      sortOrder: form.sortOrder ?? undefined,
    };

    if (!input.name) {
      return;
    }

    await this.saveSection('hobbies', form.id ? 'Loisir mis a jour.' : 'Loisir ajoute.', async () => {
      form.id ? await this.pocketBaseService.updateCurrentUserHobby(form.id, input) : await this.pocketBaseService.createCurrentUserHobby(input);
      if (resetAfterSave) {
        this.resetHobbyForm();
        this.hobbyFormSubmitted.set(false);
      }
    });
  }

  editAsset(asset: MediaFile): void {
    this.setActiveSection('assets');
    this.assetForm.set({
      id: asset.id,
      name: asset.name ?? '',
      alt: asset.alt ?? '',
      kind: asset.kind ?? 'image',
      sortOrder: asset.sortOrder ?? null,
    });
    this.selectedAssetFile.set(null);
    this.scrollToSection('assets-section', 'input[name="asset-name"]');
  }

  resetAssetForm(): void {
    this.assetForm.set({ ...EMPTY_ASSET_FORM });
    this.selectedAssetFile.set(null);
  }

  setAssetFormValue(field: keyof Omit<AssetForm, 'id' | 'sortOrder'>, value: string): void {
    this.assetForm.update((form) => ({ ...form, [field]: value }));
  }

  onAssetFileSelected(event: Event): void {
    this.selectedAssetFile.set((event.target as HTMLInputElement).files?.[0] ?? null);
    if (this.assetForm().id) {
      void this.saveAsset(false);
    }
  }

  async saveAsset(resetAfterSave = true): Promise<void> {
    this.assetFormSubmitted.set(true);
    const form = this.assetForm();
    const input: SaveCurrentUserFileInput = {
      name: this.optionalText(form.name),
      alt: this.optionalText(form.alt),
      kind: form.kind || undefined,
      sortOrder: form.sortOrder ?? undefined,
      file: this.selectedAssetFile(),
    };

    if (!form.id && !input.file) {
      return;
    }

    await this.saveSection('assets', form.id ? 'Asset mis a jour.' : 'Asset ajoute.', async () => {
      form.id ? await this.pocketBaseService.updateCurrentUserFile(form.id, input) : await this.pocketBaseService.createCurrentUserFile(input);
      if (resetAfterSave) {
        this.resetAssetForm();
        this.assetFormSubmitted.set(false);
      }
    });
  }

  initPersonalInfoForm(): void {
    const user = this.currentUser();
    if (!user) {
      return;
    }

    this.personalInfoForm.set({
      firstName: user.firstName,
      lastName: user.lastName,
      linkedin: user.linkedin ?? '',
      github: user.github ?? '',
      website: user.website ?? '',
      phone: user.phone ?? '',
    });
  }

  setPersonalInfoField(field: keyof UpdateCurrentUserInput, value: string): void {
    this.personalInfoForm.update((form) => ({ ...form, [field]: value }));
  }

  async savePersonalInfo(): Promise<void> {
    const form = this.personalInfoForm();
    const input: UpdateCurrentUserInput = {
      firstName: form.firstName?.trim(),
      lastName: form.lastName?.trim(),
      linkedin: this.optionalText(form.linkedin),
      github: this.optionalText(form.github),
      website: this.optionalText(form.website),
      phone: this.optionalText(form.phone),
    };

    if (!input.firstName || !input.lastName) {
      this.errorMessage.set('Le prenom et le nom sont obligatoires.');
      return;
    }

    this.isSavingPersonalInfo.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.pocketBaseService.updateCurrentUser(input);
      await this.authService.refreshCurrentUser();
      this.successMessage.set('Informations personnelles mises a jour.');
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      this.isSavingPersonalInfo.set(false);
    }
  }

  isSaving(section: string): boolean {
    return this.savingSection() === section;
  }

  isJobFieldInvalid(field: 'label' | 'company' | 'position' | 'startDate'): boolean {
    return this.jobFormSubmitted() && !this.jobForm()[field]?.trim();
  }

  isProjectFieldInvalid(field: 'name'): boolean {
    return this.projectFormSubmitted() && !this.projectForm()[field]?.trim();
  }

  isProjectUrlInvalid(): boolean {
    const url = this.projectForm().url?.trim();
    if (!this.projectFormSubmitted() || !url) return false;
    try { new URL(url); return false; } catch { return true; }
  }

  isSkillFieldInvalid(field: 'name'): boolean {
    return this.skillFormSubmitted() && !this.skillForm()[field]?.trim();
  }

  isAchievementFieldInvalid(field: 'title'): boolean {
    return this.achievementFormSubmitted() && !this.achievementForm()[field]?.trim();
  }

  isDegreeFieldInvalid(field: 'title'): boolean {
    return this.degreeFormSubmitted() && !this.degreeForm()[field]?.trim();
  }

  isHobbyFieldInvalid(field: 'name'): boolean {
    return this.hobbyFormSubmitted() && !this.hobbyForm()[field]?.trim();
  }

  setActiveSection(section: MaterialSection): void {
    this.activeSection.set(section);
  }

  isActiveSection(section: MaterialSection): boolean {
    return this.activeSection() === section;
  }

  getMaterialSectionCount(section: MaterialSection): number {
    switch (section) {
      case 'jobs':
        return this.jobs().length;
      case 'projects':
        return this.projects().length;
      case 'skills':
        return this.skills().length;
      case 'achievements':
        return this.achievements().length;
      case 'degrees':
        return this.degrees().length;
      case 'hobbies':
        return this.hobbies().length;
      case 'assets':
        return this.assets().length;
    }
  }

  isProjectAchievementSelected(achievementId: string): boolean {
    return this.projectForm().achievements?.includes(achievementId) ?? false;
  }

  getSkillCategoryName(skill: Skill): string {
    return skill.expand?.category?.name || this.skillCategories().find((category) => category.id === skill.category)?.name || '';
  }

  getSkillDescription(skill: Skill): string {
    const categoryName = this.getSkillCategoryName(skill);

    return [skill.type, categoryName].filter(Boolean).join(' · ') || 'Sans type';
  }

  private async loadMaterial(showLoading = true): Promise<void> {
    if (showLoading) {
      this.isLoading.set(true);
    }

    this.errorMessage.set(null);

    try {
      const data = await this.pocketBaseService.getCurrentUserProfileMaterialData();
      this.jobs.set(data.jobs);
      this.skills.set(data.skills);
      this.skillCategories.set(data.skillCategories);
      this.projects.set(data.projects);
      this.achievements.set(data.achievements);
      this.degrees.set(data.degrees);
      this.hobbies.set(data.hobbies);
      this.assets.set(data.files);
      this.persistedJobs.set([...data.jobs]);
      this.persistedProjects.set([...data.projects]);
      this.persistedSkills.set([...data.skills]);
      this.persistedAchievements.set([...data.achievements]);
      this.persistedDegrees.set([...data.degrees]);
      this.persistedHobbies.set([...data.hobbies]);
      this.persistedAssets.set([...data.files]);
      this.sectionOrderDirty.set({ jobs: false, projects: false, skills: false, achievements: false, degrees: false, hobbies: false, assets: false });
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      if (showLoading) {
        this.isLoading.set(false);
      }
    }
  }

  private async saveSection(section: string, message: string, operation: () => Promise<void>): Promise<void> {
    this.savingSection.set(section);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await operation();
      await this.loadMaterial(false);
      this.successMessage.set(message);
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      this.savingSection.set(null);
    }
  }

  private async createSkillCategoryFromName(name: string, successMessage: string): Promise<SkillCategory | null> {
    const trimmedName = name.trim();

    if (!trimmedName) {
      this.errorMessage.set('Le nom de la categorie est obligatoire.');
      return null;
    }

    const existingCategory = this.skillCategories().find((category) => this.normalizeSearchValue(category.name) === this.normalizeSearchValue(trimmedName));
    if (existingCategory) {
      return existingCategory;
    }

    this.creatingSkillCategory.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const created = await this.pocketBaseService.createCurrentUserSkillCategory(trimmedName);
      this.skillCategories.update((categories) => [...categories, created].sort((first, second) => first.name.localeCompare(second.name)));
      this.successMessage.set(successMessage);

      return created;
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
      return null;
    } finally {
      this.creatingSkillCategory.set(false);
    }
  }

  onReorderJobs(reordered: Job[]): void {
    this.jobs.set(reordered);
    this.sectionOrderDirty.update((d) => ({ ...d, jobs: true }));
  }

  onReorderProjects(reordered: Project[]): void {
    this.projects.set(reordered);
    this.sectionOrderDirty.update((d) => ({ ...d, projects: true }));
  }

  onReorderSkills(reordered: Skill[]): void {
    this.skills.set(reordered);
    this.sectionOrderDirty.update((d) => ({ ...d, skills: true }));
  }

  onReorderAchievements(reordered: Achievement[]): void {
    this.achievements.set(reordered);
    this.sectionOrderDirty.update((d) => ({ ...d, achievements: true }));
  }

  onReorderDegrees(reordered: Degree[]): void {
    this.degrees.set(reordered);
    this.sectionOrderDirty.update((d) => ({ ...d, degrees: true }));
  }

  onReorderHobbies(reordered: Hobby[]): void {
    this.hobbies.set(reordered);
    this.sectionOrderDirty.update((d) => ({ ...d, hobbies: true }));
  }

  onReorderAssets(reordered: MediaFile[]): void {
    this.assets.set(reordered);
    this.sectionOrderDirty.update((d) => ({ ...d, assets: true }));
  }

  async onUpdateOrder(section: MaterialSection): Promise<void> {
    const collectionMap: Record<MaterialSection, 'jobs' | 'projects' | 'skills' | 'achievements' | 'degrees' | 'hobbies' | 'files'> = {
      jobs: 'jobs', projects: 'projects', skills: 'skills', achievements: 'achievements', degrees: 'degrees', hobbies: 'hobbies', assets: 'files',
    };
    const collection = collectionMap[section];
    const itemsMap: Record<MaterialSection, { id: string; sortOrder: number }[]> = {
      jobs: this.jobs().map((j, i) => ({ id: j.id, sortOrder: i + 1 })),
      projects: this.projects().map((p, i) => ({ id: p.id, sortOrder: i + 1 })),
      skills: this.skills().map((s, i) => ({ id: s.id, sortOrder: i + 1 })),
      achievements: this.achievements().map((a, i) => ({ id: a.id, sortOrder: i + 1 })),
      degrees: this.degrees().map((d, i) => ({ id: d.id, sortOrder: i + 1 })),
      hobbies: this.hobbies().map((h, i) => ({ id: h.id, sortOrder: i + 1 })),
      assets: this.assets().map((a, i) => ({ id: a.id, sortOrder: i + 1 })),
    };
    this.sectionOrderSaving.update((s) => ({ ...s, [section]: true }));
    this.errorMessage.set(null);
    try {
      await this.pocketBaseService.updateCurrentUserSortOrders(collection, itemsMap[section]);
      this.sectionOrderDirty.update((d) => ({ ...d, [section]: false }));
      this.updatePersistedSnapshot(section);
      this.successMessage.set('Ordre mis a jour.');
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      this.sectionOrderSaving.update((s) => ({ ...s, [section]: false }));
    }
  }

  private updatePersistedSnapshot(section: MaterialSection): void {
    switch (section) {
      case 'jobs': this.persistedJobs.set([...this.jobs()]); break;
      case 'projects': this.persistedProjects.set([...this.projects()]); break;
      case 'skills': this.persistedSkills.set([...this.skills()]); break;
      case 'achievements': this.persistedAchievements.set([...this.achievements()]); break;
      case 'degrees': this.persistedDegrees.set([...this.degrees()]); break;
      case 'hobbies': this.persistedHobbies.set([...this.hobbies()]); break;
      case 'assets': this.persistedAssets.set([...this.assets()]); break;
    }
  }

  private scrollToSection(sectionId: string, focusSelector: string): void {
    window.requestAnimationFrame(() => {
      const section = document.getElementById(sectionId);
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.requestAnimationFrame(() => section?.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true }));
    });
  }

  private normalizeHtmlEditorValue(html: string | undefined): string | undefined {
    const trimmedHtml = html?.trim() ?? '';

    if (!trimmedHtml || trimmedHtml === '<br>') {
      return undefined;
    }

    // DOMParser yields an inert document: unlike innerHTML on a live-document node,
    // it never loads <img> sources or fires inline handlers from untrusted HTML.
    const container = new DOMParser().parseFromString(trimmedHtml, 'text/html').body;
    const hasMediaOrStructure = !!container.querySelector('img,video,iframe,ul,ol,li,table,hr');
    const text = container.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';

    return text || hasMediaOrStructure ? trimmedHtml : undefined;
  }

  private optionalText(value: string | undefined): string | undefined {
    const trimmed = value?.trim() ?? '';
    return trimmed || undefined;
  }

  private canCreateSkillCategory(value: string): boolean {
    const name = value.trim();

    if (!name || this.creatingSkillCategory()) {
      return false;
    }

    const normalizedName = this.normalizeSearchValue(name);
    return !this.skillCategories().some((category) => this.normalizeSearchValue(category.name) === normalizedName);
  }

  private toNullableNumber(value: string | number | null): number | null {
    const numberValue = value === null || value === '' ? null : Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private matchesFuzzyQuery(values: Array<string | undefined>, query: string): boolean {
    const normalizedQuery = this.normalizeSearchValue(query);

    if (!normalizedQuery) {
      return true;
    }

    return values.some((value) => {
      const normalizedValue = this.normalizeSearchValue(value ?? '');

      return normalizedValue.includes(normalizedQuery) || this.isSubsequence(normalizedQuery, normalizedValue);
    });
  }

  private normalizeSearchValue(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private isSubsequence(query: string, value: string): boolean {
    let queryIndex = 0;

    for (const character of value) {
      if (character === query[queryIndex]) {
        queryIndex += 1;
      }

      if (queryIndex === query.length) {
        return true;
      }
    }

    return false;
  }
}
