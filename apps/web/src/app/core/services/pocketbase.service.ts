import { Injectable, inject } from '@angular/core';
import { RecordModel } from 'pocketbase';
import { Achievement } from '../models/achievement.model';
import { AiToken, CreateAiTokenInput, CreatedAiTokenResult } from '../models/ai-token.model';
import { CvData } from '../models/cv-data.model';
import { CvProfile, CvProfileLinkOverrides, CvProfileStatus } from '../models/cv-profile.model';
import { Degree } from '../models/degree.model';
import { Hobby } from '../models/hobby.model';
import { Job } from '../models/job.model';
import { MediaFile } from '../models/file.model';
import { Project } from '../models/project.model';
import { ProfileMetadata, SaveProfileMetadataInput } from '../models/profile-metadata.model';
import { Skill } from '../models/skill.model';
import { SkillCategory } from '../models/skill-category.model';
import { User } from '../models/user.model';
import { generateAiTokenSecret, getAiTokenPrefix, hashAiTokenSecret } from '../utils/ai-token';
import { AuthService } from './auth.service';
import { PocketBaseClientService } from './pocketbase-client.service';

export interface CurrentUserCvProfileEditorData {
  profile: CvProfile;
  availableJobs: Job[];
  availableProjects: Project[];
  availableSkills: Skill[];
  availableDegrees: Degree[];
  availableAchievements: Achievement[];
  availableHobbies: Hobby[];
  availablePictures: MediaFile[];
}

export interface CurrentUserProfileMaterialData {
  jobs: Job[];
  skills: Skill[];
  skillCategories: SkillCategory[];
  projects: Project[];
  achievements: Achievement[];
  degrees: Degree[];
  hobbies: Hobby[];
  files: MediaFile[];
}

export type SaveCurrentUserJobInput = Pick<Job, 'label' | 'company' | 'position' | 'startDate' | 'type'> &
  Partial<Pick<Job, 'location' | 'endDate' | 'responsibilities' | 'sortOrder'>>;
export type SaveCurrentUserSkillInput = Pick<Skill, 'name'> & Partial<Pick<Skill, 'category' | 'type' | 'level' | 'sortOrder'>>;
export type SaveCurrentUserProjectInput = Pick<Project, 'name'> &
  Partial<Pick<Project, 'description' | 'url' | 'date' | 'type' | 'file' | 'sortOrder' | 'achievements'>> & { picture?: File | null };
export type SaveCurrentUserAchievementInput = Pick<Achievement, 'title'> & Partial<Pick<Achievement, 'description' | 'sortOrder'>>;
export type SaveCurrentUserDegreeInput = Pick<Degree, 'title'> & Partial<Pick<Degree, 'school' | 'year' | 'level' | 'sortOrder'>>;
export type SaveCurrentUserHobbyInput = Pick<Hobby, 'name'> & Partial<Pick<Hobby, 'description' | 'sortOrder'>>;
export type SaveCurrentUserFileInput = Partial<Pick<MediaFile, 'name' | 'alt' | 'kind' | 'sortOrder'>> & { file?: File | null };
export type UpdateCurrentUserInput = Partial<
  Pick<User, 'firstName' | 'lastName' | 'linkedin' | 'github' | 'website' | 'phone'>
>;

@Injectable({ providedIn: 'root' })
export class PocketBaseService {
  private readonly pocketBaseClient = inject(PocketBaseClientService);
  private readonly authService = inject(AuthService);
  private readonly pb = this.pocketBaseClient.pb;
  private readonly cvProfileExpand = 'user,profilePictureFile,coverPictureFile';
  private fileToken: { userId: string; value: string; expiresAt: number } | null = null;
  private fileTokenRequest: Promise<void> | null = null;

  async getCvProfileById(cvProfileId: string): Promise<CvProfile> {
    const profile = await this.pb.collection<CvProfile>('cv_profiles').getOne(cvProfileId, {
      expand: this.cvProfileExpand,
    });

    await this.prepareFileToken();
    return this.normalizeCvProfile(profile);
  }

  async getCvProfileBySlug(slug: string): Promise<CvProfile> {
    return (await this.getCvDataBySlug(slug)).profile;
  }

  async getCvDataBySlug(slug: string): Promise<CvData> {
    const cvData = await this.pb.send(`/api/custom/cv-data/by-slug/${encodeURIComponent(slug)}`, {
      method: 'GET',
      requestKey: `cv-data-by-slug-${slug}`,
    });

    await this.prepareFileToken();
    return this.normalizeCvData(cvData as CvData);
  }

  async getUser(userId: string): Promise<User | null> {
    if (!userId) {
      return null;
    }

    const user = await this.pb.collection<User>('users').getOne(userId);

    await this.prepareFileToken();
    return this.normalizeUser(user);
  }

  async getJobs(jobIds: string[]): Promise<Job[]> {
    return this.getOrderedRecords<Job>('jobs', jobIds, '+sortOrder,-startDate');
  }

  async getProjects(projectIds: string[]): Promise<Project[]> {
    const projects = await this.getOrderedRecords<Project>('projects', projectIds, '+sortOrder,-date', 'file');

    await this.prepareFileToken();
    return projects.map((project) => this.normalizeProject(project));
  }

  async getSkills(skillIds: string[]): Promise<Skill[]> {
    const skills = await this.getOrderedRecords<Skill>('skills', skillIds, '+sortOrder,+name', 'category');

    await this.prepareFileToken();
    return skills.map((skill) => this.normalizeSkill(skill));
  }

  async getDegrees(degreeIds: string[]): Promise<Degree[]> {
    return this.getOrderedRecords<Degree>('degrees', degreeIds, '+sortOrder,-year');
  }

  async getAchievements(achievementIds: string[]): Promise<Achievement[]> {
    return this.getOrderedRecords<Achievement>('achievements', achievementIds, '+sortOrder,+title');
  }

  async getHobbies(hobbyIds: string[]): Promise<Hobby[]> {
    return this.getOrderedRecords<Hobby>('hobbies', hobbyIds, '+sortOrder,+name');
  }

  async getAllCvProfiles(): Promise<CvProfile[]> {
    const profiles = await this.pb.collection<CvProfile>('cv_profiles').getFullList({
      sort: '+label',
      expand: this.cvProfileExpand,
    });

    await this.prepareFileToken();
    return profiles.map((profile) => this.normalizeCvProfile(profile));
  }

  async getCurrentUserCvProfiles(): Promise<CvProfile[]> {
    const currentUserId = this.requireCurrentUserId();

    const profiles = await this.pb.collection<CvProfile>('cv_profiles').getFullList({
      filter: `user="${currentUserId}"`,
      expand: this.cvProfileExpand,
    });

    await this.prepareFileToken();
    return profiles.map((profile) => this.normalizeCvProfile(profile));
  }

  async getCurrentUserCvProfileById(profileId: string): Promise<CvProfile> {
    const currentUserId = this.requireCurrentUserId();
    const profile = await this.pb
      .collection<CvProfile>('cv_profiles')
      .getFirstListItem(`id="${profileId}" && user="${currentUserId}"`, {
        expand: this.cvProfileExpand,
      });

    await this.prepareFileToken();
    return this.normalizeCvProfile(profile);
  }

  async createCurrentUserCvProfile(label: string, profileName: string, template: string): Promise<CvProfile> {
    const currentUserId = this.requireCurrentUserId();
    const trimmedLabel = label.trim();
    const trimmedProfileName = profileName.trim();
    const trimmedTemplate = template.trim();

    if (!trimmedLabel) {
      throw new Error('Le label est obligatoire.');
    }

    if (!trimmedProfileName) {
      throw new Error('Le nom du profil est obligatoire.');
    }

    if (!trimmedTemplate) {
      throw new Error('Le template est obligatoire.');
    }

    const now = new Date();
    const created = await this.pb.collection<CvProfile>('cv_profiles').create({
      slug: `profil--${currentUserId}--${now.getTime()}`,
      label: trimmedLabel,
      profileName: trimmedProfileName,
      template: trimmedTemplate,
      public: false,
      user: currentUserId,
      achievements: [],
      projects: [],
      hobbies: [],
      jobs: [],
      degrees: [],
      skills: [],
    });

    const updated = await this.pb.collection<CvProfile>('cv_profiles').update(created.id, {
      slug: `${trimmedTemplate}--${created.id}`,
    });

    await this.prepareFileToken();
    return this.normalizeCvProfile(updated);
  }

  async setTemplateForCurrentUserCvProfile(profileId: string, template: string, isPublic: boolean): Promise<CvProfile> {
    const profile = await this.getCurrentUserCvProfileById(profileId);

    const updated = await this.pb.collection<CvProfile>('cv_profiles').update(profile.id, {
      template,
      public: isPublic,
      slug: `${template}--${profile.id}`,
    });

    await this.prepareFileToken();
    return this.normalizeCvProfile(updated);
  }

  async setPublicForCurrentUserCvProfile(profileId: string, isPublic: boolean): Promise<CvProfile> {
    const profile = await this.getCurrentUserCvProfileById(profileId);

    const updated = await this.pb.collection<CvProfile>('cv_profiles').update(profile.id, {
      public: isPublic,
    });

    await this.prepareFileToken();
    return this.normalizeCvProfile(updated);
  }

  async deleteCurrentUserCvProfile(profileId: string): Promise<void> {
    await this.getCurrentUserCvProfileById(profileId); // ownership check
    await this.pb.collection('cv_profiles').delete(profileId);
  }

  async updateCurrentUserCvProfile(
    profileId: string,
    payload: Partial<
      Pick<
        CvProfile,
        | 'label'
        | 'profileName'
        | 'public'
        | 'template'
        | 'jobs'
        | 'projects'
        | 'skills'
        | 'degrees'
        | 'achievements'
        | 'hobbies'
        | 'extra'
        | 'profilePictureFile'
        | 'coverPictureFile'
        | 'professionalSummary'
        | 'linkOverrides'
        | 'status'
      >
    >,
  ): Promise<CvProfile> {
    const profile = await this.getCurrentUserCvProfileById(profileId);
    const template = payload.template ?? profile.template ?? '';
    const updated = await this.pb.collection<CvProfile>('cv_profiles').update(profile.id, {
      ...payload,
      slug: template ? `${template}--${profile.id}` : profile.slug,
    });

    await this.prepareFileToken();
    return this.normalizeCvProfile(updated);
  }

  async updateCurrentUserCvProfilePictures(
    profileId: string,
    pictures: { profilePicture?: File | null; coverPicture?: File | null },
  ): Promise<CvProfile> {
    const profile = await this.getCurrentUserCvProfileById(profileId);
    const formData = new FormData();

    if (pictures.profilePicture) {
      formData.set('profilePicture', pictures.profilePicture);
    }

    if (pictures.coverPicture) {
      formData.set('coverPicture', pictures.coverPicture);
    }

    const updated = await this.pb.collection<CvProfile>('cv_profiles').update(profile.id, formData);

    await this.prepareFileToken();
    return this.normalizeCvProfile(updated);
  }

  async getCurrentUserCvProfileEditorData(profileId: string): Promise<CurrentUserCvProfileEditorData> {
    const profile = await this.getCurrentUserCvProfileById(profileId);
    const [availableJobs, availableProjects, availableSkills, availableDegrees, availableAchievements, availableHobbies, availableFiles] =
      await Promise.all([
        this.getCurrentUserOwnedRecords<Job>('jobs', '+sortOrder,-startDate'),
        this.getCurrentUserOwnedRecords<Project>('projects', '+sortOrder,-date', 'file'),
        this.getCurrentUserOwnedRecords<Skill>('skills', '+sortOrder,+name', 'category'),
        this.getCurrentUserOwnedRecords<Degree>('degrees', '+sortOrder,-year'),
        this.getCurrentUserOwnedRecords<Achievement>('achievements', '+sortOrder,+title'),
        this.getCurrentUserOwnedRecords<Hobby>('hobbies', '+sortOrder,+name'),
        this.getCurrentUserOwnedRecords<MediaFile>('files', '+sortOrder,+name'),
      ]);

    await this.prepareFileToken();
    return {
      profile,
      availableJobs,
      availableProjects: availableProjects.map((project) => this.normalizeProject(project)),
      availableSkills: availableSkills.map((skill) => this.normalizeSkill(skill)),
      availableDegrees,
      availableAchievements,
      availableHobbies,
      availablePictures: availableFiles.filter((file) => file.kind === 'image').map((file) => this.normalizeMediaFile(file)),
    };
  }

  async getCurrentUserProfileMaterialData(): Promise<CurrentUserProfileMaterialData> {
    const [jobs, skills, skillCategories, projects, achievements, degrees, hobbies, files] = await Promise.all([
      this.getCurrentUserOwnedRecords<Job>('jobs', '+sortOrder,-startDate'),
      this.getCurrentUserOwnedRecords<Skill>('skills', '+sortOrder,+name', 'category'),
      this.getCurrentUserSkillCategories(),
      this.getCurrentUserOwnedRecords<Project>('projects', '+sortOrder,-date', 'file'),
      this.getCurrentUserOwnedRecords<Achievement>('achievements', '+sortOrder,+title'),
      this.getCurrentUserOwnedRecords<Degree>('degrees', '+sortOrder,-year'),
      this.getCurrentUserOwnedRecords<Hobby>('hobbies', '+sortOrder,+name'),
      this.getCurrentUserOwnedRecords<MediaFile>('files', '+sortOrder,+name'),
    ]);

    await this.prepareFileToken();
    return {
      jobs,
      skills: skills.map((skill) => this.normalizeSkill(skill)),
      skillCategories,
      projects: projects.map((project) => this.normalizeProject(project)),
      achievements,
      degrees,
      hobbies,
      files: files.map((file) => this.normalizeMediaFile(file)),
    };
  }

  async createCurrentUserJob(input: SaveCurrentUserJobInput): Promise<Job> {
    const currentUserId = this.requireCurrentUserId();
    return this.pb.collection<Job>('jobs').create({
      ...input,
      user: currentUserId,
    });
  }

  async updateCurrentUserJob(jobId: string, input: SaveCurrentUserJobInput): Promise<Job> {
    const currentUserId = this.requireCurrentUserId();
    const job = await this.pb.collection<Job>('jobs').getFirstListItem(`id="${jobId}" && user="${currentUserId}"`);

    return this.pb.collection<Job>('jobs').update(job.id, input);
  }

  async createCurrentUserSkill(input: SaveCurrentUserSkillInput): Promise<Skill> {
    const currentUserId = this.requireCurrentUserId();
    const created = await this.pb.collection<Skill>('skills').create({
      ...input,
      user: currentUserId,
      category: input.category || null,
    });

    await this.prepareFileToken();
    return this.normalizeSkill(created);
  }

  async updateCurrentUserSkill(skillId: string, input: SaveCurrentUserSkillInput): Promise<Skill> {
    const currentUserId = this.requireCurrentUserId();
    const skill = await this.pb.collection<Skill>('skills').getFirstListItem(`id="${skillId}" && user="${currentUserId}"`);

    const updated = await this.pb.collection<Skill>('skills').update(skill.id, {
      ...input,
      category: input.category || null,
    });

    await this.prepareFileToken();
    return this.normalizeSkill(updated);
  }

  async getCurrentUserSkillCategories(): Promise<SkillCategory[]> {
    return this.getCurrentUserOwnedRecords<SkillCategory>('skill_categories', '+name');
  }

  async createCurrentUserSkillCategory(name: string): Promise<SkillCategory> {
    const currentUserId = this.requireCurrentUserId();
    const trimmedName = name.trim();

    if (!trimmedName) {
      throw new Error('Le nom de la categorie est obligatoire.');
    }

    const existingCategories = await this.getCurrentUserSkillCategories();
    const normalizedName = this.normalizeSearchValue(trimmedName);
    const existingCategory = existingCategories.find((category) => this.normalizeSearchValue(category.name) === normalizedName);

    if (existingCategory) {
      return existingCategory;
    }

    return this.pb.collection<SkillCategory>('skill_categories').create({
      name: trimmedName,
      user: currentUserId,
    });
  }

  async createCurrentUserProject(input: SaveCurrentUserProjectInput): Promise<Project> {
    const currentUserId = this.requireCurrentUserId();
    const created = await this.pb.collection<Project>('projects').create(this.toProjectFormData(input, currentUserId));

    await this.prepareFileToken();
    return this.normalizeProject(created);
  }

  async updateCurrentUserProject(projectId: string, input: SaveCurrentUserProjectInput): Promise<Project> {
    const currentUserId = this.requireCurrentUserId();
    const project = await this.pb.collection<Project>('projects').getFirstListItem(`id="${projectId}" && user="${currentUserId}"`);
    const updated = await this.pb.collection<Project>('projects').update(project.id, this.toProjectFormData(input));

    await this.prepareFileToken();
    return this.normalizeProject(updated);
  }

  async createCurrentUserAchievement(input: SaveCurrentUserAchievementInput): Promise<Achievement> {
    const currentUserId = this.requireCurrentUserId();
    return this.pb.collection<Achievement>('achievements').create({
      ...input,
      user: currentUserId,
    });
  }

  async updateCurrentUserAchievement(achievementId: string, input: SaveCurrentUserAchievementInput): Promise<Achievement> {
    const currentUserId = this.requireCurrentUserId();
    const achievement = await this.pb.collection<Achievement>('achievements').getFirstListItem(`id="${achievementId}" && user="${currentUserId}"`);

    return this.pb.collection<Achievement>('achievements').update(achievement.id, input);
  }

  async createCurrentUserDegree(input: SaveCurrentUserDegreeInput): Promise<Degree> {
    const currentUserId = this.requireCurrentUserId();
    return this.pb.collection<Degree>('degrees').create({
      ...input,
      user: currentUserId,
    });
  }

  async updateCurrentUserDegree(degreeId: string, input: SaveCurrentUserDegreeInput): Promise<Degree> {
    const currentUserId = this.requireCurrentUserId();
    const degree = await this.pb.collection<Degree>('degrees').getFirstListItem(`id="${degreeId}" && user="${currentUserId}"`);

    return this.pb.collection<Degree>('degrees').update(degree.id, input);
  }

  async createCurrentUserHobby(input: SaveCurrentUserHobbyInput): Promise<Hobby> {
    const currentUserId = this.requireCurrentUserId();
    return this.pb.collection<Hobby>('hobbies').create({
      ...input,
      user: currentUserId,
    });
  }

  async updateCurrentUserHobby(hobbyId: string, input: SaveCurrentUserHobbyInput): Promise<Hobby> {
    const currentUserId = this.requireCurrentUserId();
    const hobby = await this.pb.collection<Hobby>('hobbies').getFirstListItem(`id="${hobbyId}" && user="${currentUserId}"`);

    return this.pb.collection<Hobby>('hobbies').update(hobby.id, input);
  }

  async createCurrentUserFile(input: SaveCurrentUserFileInput): Promise<MediaFile> {
    const currentUserId = this.requireCurrentUserId();

    if (!input.file) {
      throw new Error('Le fichier est obligatoire.');
    }

    const created = await this.pb.collection<MediaFile>('files').create(this.toMediaFileFormData(input, currentUserId));

    await this.prepareFileToken();
    return this.normalizeMediaFile(created);
  }

  async updateCurrentUserFile(fileId: string, input: SaveCurrentUserFileInput): Promise<MediaFile> {
    const currentUserId = this.requireCurrentUserId();
    const file = await this.pb.collection<MediaFile>('files').getFirstListItem(`id="${fileId}" && user="${currentUserId}"`);
    const updated = await this.pb.collection<MediaFile>('files').update(file.id, this.toMediaFileFormData(input));

    await this.prepareFileToken();
    return this.normalizeMediaFile(updated);
  }

  async getCurrentUserAiTokens(): Promise<AiToken[]> {
    const currentUserId = this.requireCurrentUserId();
    const tokens = await this.pb.collection<AiToken>('ai_tokens').getFullList({
      filter: `user="${currentUserId}"`,
      sort: '-created',
    });

    return tokens.map((token) => this.normalizeAiToken(token));
  }

  async updateCurrentUser(input: UpdateCurrentUserInput): Promise<User> {
    const currentUserId = this.requireCurrentUserId();
    const updated = await this.pb.collection<User>('users').update(currentUserId, input);
    await this.prepareFileToken();
    return this.normalizeUser(updated) as User;
  }

  async getCurrentProfileMetadata(): Promise<ProfileMetadata | null> {
    const currentUserId = this.requireCurrentUserId();
    try {
      return await this.pb.collection<ProfileMetadata>('profile_metadata').getFirstListItem(`user="${currentUserId}"`);
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404) return null;
      throw error;
    }
  }

  async saveCurrentProfileMetadata(input: SaveProfileMetadataInput): Promise<ProfileMetadata> {
    const currentUserId = this.requireCurrentUserId();
    const metadata = await this.getCurrentProfileMetadata();
    if (metadata) {
      return this.pb.collection<ProfileMetadata>('profile_metadata').update(metadata.id, input);
    }
    return this.pb.collection<ProfileMetadata>('profile_metadata').create({ ...input, user: currentUserId });
  }

  async setLinkOverridesForCvProfile(profileId: string, linkOverrides: CvProfile['linkOverrides']): Promise<CvProfile> {
    const profile = await this.getCurrentUserCvProfileById(profileId);
    const updated = await this.pb.collection<CvProfile>('cv_profiles').update(profile.id, { linkOverrides });
    return this.normalizeCvProfile(updated);
  }

  async setStatusForCvProfile(profileId: string, status: CvProfile['status']): Promise<CvProfile> {
    const profile = await this.getCurrentUserCvProfileById(profileId);
    const updated = await this.pb.collection<CvProfile>('cv_profiles').update(profile.id, { status });
    return this.normalizeCvProfile(updated);
  }

  async changeCurrentUserPassword(oldPassword: string, password: string, passwordConfirm: string): Promise<void> {
    if (!oldPassword) {
      throw new Error('Le mot de passe actuel est obligatoire.');
    }

    if (!password) {
      throw new Error('Le nouveau mot de passe est obligatoire.');
    }

    if (password.length < 8) {
      throw new Error('Le nouveau mot de passe doit contenir au moins 8 caracteres.');
    }

    if (password !== passwordConfirm) {
      throw new Error('Les mots de passe ne correspondent pas.');
    }

    const currentUserId = this.requireCurrentUserId();
    await this.pb.collection('users').update(currentUserId, {
      oldPassword,
      password,
      passwordConfirm,
    });
  }

  async deleteCurrentUserAccount(): Promise<void> {
    const currentUserId = this.requireCurrentUserId();

    const ownedCollections = [
      'cv_profiles',
      'jobs',
      'projects',
      'skills',
      'skill_categories',
      'achievements',
      'degrees',
      'hobbies',
      'files',
      'ai_tokens',
      'profile_metadata',
    ];

    for (const collection of ownedCollections) {
      const records = await this.pb.collection(collection).getFullList({
        filter: `user="${currentUserId}"`,
        fields: 'id',
      });

      for (const record of records) {
        await this.pb.collection(collection).delete(record.id);
      }
    }

    await this.pb.collection('users').delete(currentUserId);
  }

  async exportCurrentUserData(): Promise<Record<string, unknown>> {
    const currentUserId = this.requireCurrentUserId();

    const collections: { name: string; sort: string }[] = [
      { name: 'jobs', sort: '+sortOrder,-startDate' },
      { name: 'projects', sort: '+sortOrder,-date' },
      { name: 'skills', sort: '+sortOrder,+name' },
      { name: 'skill_categories', sort: '+name' },
      { name: 'achievements', sort: '+sortOrder,+title' },
      { name: 'degrees', sort: '+sortOrder,-year' },
      { name: 'hobbies', sort: '+sortOrder,+name' },
      { name: 'files', sort: '+sortOrder,+name' },
      { name: 'cv_profiles', sort: '+label' },
      { name: 'ai_tokens', sort: '-created' },
      { name: 'profile_metadata', sort: '-updated' },
    ];

    const results: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      userId: currentUserId,
    };

    const user = await this.pb.collection('users').getOne(currentUserId);
    const { password, tokenKey, verified, ...safeUser } = user as Record<string, unknown>;
    results['user'] = safeUser;

    for (const { name, sort } of collections) {
      const records = await this.pb.collection(name).getFullList({
        filter: `user="${currentUserId}"`,
        sort,
      });

      results[name] = records.map((record) => {
        const { collectionId, collectionName, expand, ...safeRecord } = record as Record<string, unknown>;
        return safeRecord;
      });
    }

    return results;
  }

  async createCurrentUserAiToken(input: CreateAiTokenInput): Promise<CreatedAiTokenResult> {
    const currentUserId = this.requireCurrentUserId();
    const rawToken = generateAiTokenSecret();
    const tokenHash = await hashAiTokenSecret(rawToken);
    const label = input.label.trim();

    if (!label) {
      throw new Error('Le label de la cle API est obligatoire.');
    }

    const created = await this.pb.collection<AiToken>('ai_tokens').create({
      token_hash: tokenHash,
      token_prefix: getAiTokenPrefix(rawToken),
      user: currentUserId,
      label,
      status: 'active',
      expiresAt: input.expiresAt || null,
      lastUsedAt: null,
    });

    return {
      record: this.normalizeAiToken(created),
      rawToken,
    };
  }

  async revokeCurrentUserAiToken(tokenId: string): Promise<void> {
    await this.pb.send(`/api/custom/ai-tokens/${tokenId}/revoke`, {
      method: 'POST',
      requestKey: `revoke-${tokenId}`,
    });
  }

  async getCvDataByProfileId(cvProfileId: string): Promise<CvData> {
    const profile = await this.getCvProfileById(cvProfileId);
    const user = profile.expand?.user ?? (await this.getUser(profile.user));
    const [jobs, projects, skills, degrees, achievements, hobbies] = await Promise.all([
      this.getJobs(profile.jobs ?? []),
      this.getProjects(profile.projects ?? []),
      this.getSkills(profile.skills ?? []),
      this.getDegrees(profile.degrees ?? []),
      this.getAchievements(profile.achievements ?? []),
      this.getHobbies(profile.hobbies ?? []),
    ]);

    return {
      profile,
      user: this.resolveUserLinks(profile, user),
      jobs,
      projects,
      skills,
      degrees,
      achievements,
      hobbies,
    };
  }

  private normalizeCvData(cvData: CvData): CvData {
    const profile = this.normalizeCvProfile(cvData.profile);
    const user = this.normalizeUser(cvData.user);

    return {
      profile,
      user: this.resolveUserLinks(profile, user),
      jobs: cvData.jobs ?? [],
      projects: (cvData.projects ?? []).map((project) => this.normalizeProject(project)),
      skills: (cvData.skills ?? []).map((skill) => this.normalizeSkill(skill)),
      degrees: cvData.degrees ?? [],
      achievements: cvData.achievements ?? [],
      hobbies: cvData.hobbies ?? [],
    };
  }

  resolveUserLinks(profile: CvProfile, user: User | null): User | null {
    if (!user) {
      return null;
    }

    return {
      ...user,
      linkedin: profile.linkOverrides?.linkedin ?? user.linkedin,
      github: profile.linkOverrides?.github ?? user.github,
      website: profile.linkOverrides?.website ?? user.website,
    };
  }

  private async getOrderedRecords<T extends { id: string }>(
    collectionName: string,
    recordIds: string[],
    sort: string,
    expand?: string,
  ): Promise<T[]> {
    if (recordIds.length === 0) {
      return [];
    }

    const records = await this.pb.collection<T>(collectionName).getFullList({
      filter: recordIds.map((recordId) => `id="${recordId}"`).join(' || '),
      sort,
      expand,
    });

    const recordsById = new Map(records.map((record) => [record.id, record]));

    return recordIds.map((recordId) => recordsById.get(recordId)).filter((record): record is T => !!record);
  }

  private async getCurrentUserOwnedRecords<T extends { id: string }>(
    collectionName: string,
    sort: string,
    expand?: string,
  ): Promise<T[]> {
    const currentUserId = this.requireCurrentUserId();
    return this.pb.collection<T>(collectionName).getFullList({
      filter: `user="${currentUserId}"`,
      sort,
      expand,
    });
  }

  private normalizeCvProfile(profile: CvProfile | null): CvProfile {
    if (!profile) {
      throw new Error('CV profile not found.');
    }

    const profilePictureFile = profile.expand?.profilePictureFile ? this.normalizeMediaFile(profile.expand.profilePictureFile as MediaFile & RecordModel, profile.user) : undefined;
    const coverPictureFile = profile.expand?.coverPictureFile ? this.normalizeMediaFile(profile.expand.coverPictureFile as MediaFile & RecordModel, profile.user) : undefined;

    return {
      ...profile,
      extra: profile.extra ?? {},
      professionalSummary: this.normalizeEditorHtmlField(profile.professionalSummary),
      profilePicture: profilePictureFile?.file || this.getFileFieldUrl(profile as unknown as RecordModel, profile.profilePicture, profile.user),
      coverPicture: coverPictureFile?.file || this.getFileFieldUrl(profile as unknown as RecordModel, profile.coverPicture, profile.user),
      expand: profile.expand
        ? {
            ...profile.expand,
            user: profile.expand.user ? this.normalizeUser(profile.expand.user as User & RecordModel) ?? undefined : undefined,
            profilePictureFile,
            coverPictureFile,
          }
        : undefined,
    };
  }

  private normalizeEditorHtmlField(value: string | undefined): string | undefined {
    let html = value?.trim() ?? '';

    if (!html) {
      return undefined;
    }

    // Some editor values may come back as a JSON-serialized HTML string,
    // e.g. "<p>content</p>". Quill then treats the wrapping quotes as user
    // content and persists them as <p>"content</p>. Normalize before the value
    // reaches editors/templates.
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

    // Repair already-persisted summaries where serialized quotes became part of
    // the first/last HTML text nodes.
    html = html
      .replace(/^<p>(["“”])/, '<p>')
      .replace(/(["“”])<\/p>$/, '</p>')
      .replace(/^(["“”])(<[a-z][\s\S]*>)/i, '$2')
      .replace(/(<\/[a-z]+>)(["“”])$/i, '$1');

    return html || undefined;
  }

  private normalizeUser(user: User | null): User | null {
    if (!user) {
      return null;
    }

    return {
      ...user,
      profilePicture: this.getFileFieldUrl(user as unknown as RecordModel, user.profilePicture, user.id),
      coverPicture: this.getFileFieldUrl(user as unknown as RecordModel, user.coverPicture, user.id),
    };
  }

  private normalizeProject(project: Project | null): Project {
    if (!project) {
      throw new Error('Project not found.');
    }

    return {
      ...project,
      picture: this.getFileFieldUrl(project as unknown as RecordModel, project.picture, project.user),
    };
  }

  private normalizeSkill(skill: Skill | null): Skill {
    if (!skill) {
      throw new Error('Skill not found.');
    }

    return {
      ...skill,
      icon: this.getFileFieldUrl(skill as unknown as RecordModel, skill.icon, skill.user),
      expand: skill.expand
        ? {
            ...skill.expand,
            category: skill.expand.category,
          }
        : undefined,
    };
  }

  private normalizeMediaFile(file: MediaFile | null, ownerId?: string): MediaFile {
    if (!file) {
      throw new Error('File not found.');
    }

    return {
      ...file,
      file: this.getFileFieldUrl(file as unknown as RecordModel, file.file, file.user ?? ownerId) || file.file,
    };
  }

  private toProjectFormData(input: SaveCurrentUserProjectInput, currentUserId?: string): FormData {
    const formData = new FormData();
    this.setFormDataValue(formData, 'name', input.name);
    this.setFormDataValue(formData, 'description', input.description);
    this.setFormDataValue(formData, 'url', input.url);
    this.setFormDataValue(formData, 'date', input.date);
    this.setFormDataValue(formData, 'type', input.type);
    this.setFormDataValue(formData, 'file', input.file);
    this.setFormDataNumber(formData, 'sortOrder', input.sortOrder);

    formData.set('achievements', JSON.stringify(input.achievements ?? []));

    if (input.picture) {
      formData.set('picture', input.picture);
    }

    if (currentUserId) {
      formData.set('user', currentUserId);
    }

    return formData;
  }

  private toMediaFileFormData(input: SaveCurrentUserFileInput, currentUserId?: string): FormData {
    const formData = new FormData();
    this.setFormDataValue(formData, 'name', input.name);
    this.setFormDataValue(formData, 'alt', input.alt);
    this.setFormDataValue(formData, 'kind', input.kind);
    this.setFormDataNumber(formData, 'sortOrder', input.sortOrder);

    if (input.file) {
      formData.set('file', input.file);
    }

    if (currentUserId) {
      formData.set('user', currentUserId);
    }

    return formData;
  }

  private setFormDataValue(formData: FormData, key: string, value: string | undefined): void {
    if (value !== undefined) {
      formData.set(key, value);
    }
  }

  private setFormDataNumber(formData: FormData, key: string, value: number | undefined): void {
    if (value !== undefined) {
      formData.set(key, String(value));
    }
  }

  private async getCurrentUserAiTokenById(tokenId: string): Promise<AiToken> {
    const currentUserId = this.requireCurrentUserId();
    const token = await this.pb
      .collection<AiToken>('ai_tokens')
      .getFirstListItem(`id="${tokenId}" && user="${currentUserId}"`);

    return this.normalizeAiToken(token);
  }

  private normalizeAiToken(token: AiToken | null): AiToken {
    if (!token) {
      throw new Error('API key not found.');
    }

    return { ...token };
  }

  async updateCurrentUserSortOrders(
    collection: 'jobs' | 'projects' | 'skills' | 'achievements' | 'degrees' | 'hobbies' | 'files',
    items: { id: string; sortOrder: number }[],
  ): Promise<void> {
    const currentUserId = this.requireCurrentUserId();
    await Promise.all(
      items.map(({ id, sortOrder }) =>
        this.pb.collection(collection).update(id, { sortOrder }, { $cancelKey: `reorder-${collection}-${id}` }),
      ),
    );
  }

  private getFileFieldUrl(record: RecordModel, filename: string | undefined, ownerId?: string): string | undefined {
    if (!filename) {
      return undefined;
    }

    const currentUserId = this.authService.getCurrentUserId();
    const token = this.fileToken;
    if (ownerId && ownerId === currentUserId && token?.userId === currentUserId && token.expiresAt > Date.now()) {
      return this.pb.files.getURL(record, filename, { token: token.value });
    }

    return this.pb.files.getURL(record, filename);
  }

  private async prepareFileToken(): Promise<void> {
    const userId = this.authService.getCurrentUserId();
    if (!userId) {
      this.fileToken = null;
      return;
    }

    if (this.fileToken?.userId === userId && this.fileToken.expiresAt > Date.now()) return;
    if (this.fileTokenRequest) {
      await this.fileTokenRequest;
      if (this.fileToken?.userId === userId && this.fileToken.expiresAt > Date.now()) return;
    }

    this.fileTokenRequest = (async () => {
      try {
        const token = await this.pb.files.getToken();
        if (this.authService.getCurrentUserId() === userId) {
          let expiresAt = Date.now() + 60_000;
          try {
            const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (typeof payload.exp === 'number') {
              expiresAt = Math.min(expiresAt, payload.exp * 1000 - 15_000);
            }
          } catch {
            // Fallback for non-JWT tokens; the server still validates each URL.
          }
          this.fileToken = { userId, value: token, expiresAt };
        }
      } catch {
        // Public CVs and normal API errors still behave independently of file-token issuance.
        this.fileToken = null;
      }
    })();

    try {
      await this.fileTokenRequest;
    } finally {
      this.fileTokenRequest = null;
    }
  }

  private requireCurrentUserId(): string {
    const currentUserId = this.authService.getCurrentUserId();

    if (!currentUserId) {
      throw new Error('Authentication required.');
    }

    return currentUserId;
  }

  private normalizeSearchValue(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  public toDate(value?: string | null): Date | undefined {
    if (!value) {
      return undefined;
    }
    const isoValue = value.replace(' ', 'T');
    const date = new Date(isoValue);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
