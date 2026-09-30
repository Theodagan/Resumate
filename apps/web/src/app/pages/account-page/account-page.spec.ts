import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PocketBaseService } from '../../core/services/pocketbase.service';

import { AccountPage } from './account-page';

class AuthServiceStub {
  readonly currentUser = signal({
    firstName: 'John',
    lastName: 'Doe',
  });
  readonly isAuthenticated = computed(() => true);
  logout = jest.fn();
  refreshCurrentUser = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
}

class PocketBaseServiceStub {
  getCurrentUserMcpPreferences = jest.fn().mockResolvedValue({ mcpCvEnabled: true, mcpMaterialsEnabled: false });
  saveCurrentUserMcpPreferences = jest.fn().mockResolvedValue(undefined);
  changeCurrentUserPassword = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  updateCurrentUser = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ id: 'user-123' });
  getCurrentProfileMetadata = jest.fn().mockResolvedValue({
    id: 'metadata-1',
    user: 'user-123',
    writingStyleDescription: 'Formal and concise tone',
    writingStyleUrl: 'https://example.com/style-guide',
  });
  saveCurrentProfileMetadata = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ id: 'metadata-1' });
  deleteCurrentUserAccount = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  exportCurrentUserData = jest.fn<Promise<Record<string, unknown>>, []>().mockResolvedValue({
    exportedAt: '2026-01-01T00:00:00.000Z',
    userId: 'user-123',
    user: { id: 'user-123', email: 'test@example.com' },
    cv_profiles: [],
    jobs: [],
    skills: [],
  });
  getCurrentUserId = jest.fn().mockReturnValue('user-123');
}

describe('AccountPage', () => {
  let component: AccountPage;
  let fixture: ComponentFixture<AccountPage>;
  let pocketBaseService: PocketBaseServiceStub;
  let authService: AuthServiceStub;

  beforeAll(() => {
    // URL.createObjectURL is not available in jsdom
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { value: jest.fn(() => 'blob:test'), configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: jest.fn(), configurable: true });
    }
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: AuthServiceStub },
        { provide: PocketBaseService, useClass: PocketBaseServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountPage);
    component = fixture.componentInstance;
    pocketBaseService = TestBed.inject(PocketBaseService) as unknown as PocketBaseServiceStub;
    authService = TestBed.inject(AuthService) as unknown as AuthServiceStub;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads and saves independent MCP family preferences', async () => {
    expect(component.mcpCvEnabled()).toBe(true);
    expect(component.mcpMaterialsEnabled()).toBe(false);
    component.mcpCvEnabled.set(false);
    component.mcpMaterialsEnabled.set(true);
    await component.saveMcpPreferences();
    expect(pocketBaseService.saveCurrentUserMcpPreferences).toHaveBeenCalledWith({ mcpCvEnabled: false, mcpMaterialsEnabled: true });
    expect(component.mcpSaved()).toBe(true);
  });

  it('reports an MCP save failure', async () => {
    pocketBaseService.saveCurrentUserMcpPreferences.mockRejectedValueOnce(new Error('Save failed'));
    await component.saveMcpPreferences();
    expect(component.mcpSaved()).toBe(false);
    expect(component.mcpError()).toContain('Save failed');
  });

  describe('changePassword', () => {
    it('shows error when old password is empty', async () => {
      component.oldPassword.set('');
      component.newPassword.set('newpassword');
      component.confirmPassword.set('newpassword');

      await component.changePassword();

      expect(component.errorMessage()).toBe('Veuillez saisir votre mot de passe actuel.');
      expect(pocketBaseService.changeCurrentUserPassword).not.toHaveBeenCalled();
    });

    it('shows error when new password is too short', async () => {
      component.oldPassword.set('oldpass');
      component.newPassword.set('short');
      component.confirmPassword.set('short');

      await component.changePassword();

      expect(component.errorMessage()).toBe('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      expect(pocketBaseService.changeCurrentUserPassword).not.toHaveBeenCalled();
    });

    it('shows error when passwords do not match', async () => {
      component.oldPassword.set('oldpass');
      component.newPassword.set('newpassword1');
      component.confirmPassword.set('newpassword2');

      await component.changePassword();

      expect(component.errorMessage()).toBe('Les mots de passe ne correspondent pas.');
      expect(pocketBaseService.changeCurrentUserPassword).not.toHaveBeenCalled();
    });

    it('calls service and shows success on valid input', async () => {
      component.oldPassword.set('oldpass');
      component.newPassword.set('newpassword');
      component.confirmPassword.set('newpassword');

      await component.changePassword();

      expect(pocketBaseService.changeCurrentUserPassword).toHaveBeenCalledWith(
        'oldpass',
        'newpassword',
        'newpassword',
      );
      expect(component.successMessage()).toBe('Mot de passe modifié avec succès.');
      expect(component.oldPassword()).toBe('');
      expect(component.newPassword()).toBe('');
    });

    it('shows error when service throws', async () => {
      pocketBaseService.changeCurrentUserPassword.mockRejectedValue(
        new Error('Invalid old password'),
      );

      component.oldPassword.set('wrong');
      component.newPassword.set('newpassword');
      component.confirmPassword.set('newpassword');

      await component.changePassword();

      expect(component.errorMessage()).toBe('Invalid old password');
      expect(component.successMessage()).toBeNull();
    });
  });

  describe('exportData', () => {
    it('calls exportCurrentUserData on service and triggers download', async () => {
      // Note: full DOM download mechanics are verified in integration/e2e tests
      await component.exportData();

      expect(pocketBaseService.exportCurrentUserData).toHaveBeenCalled();
      expect(component.exportSuccessMessage()).toContain('exportées avec succès');
    });

    it('shows error when export fails', async () => {
      pocketBaseService.exportCurrentUserData.mockRejectedValue(new Error('Export failed'));

      await component.exportData();

      expect(component.exportErrorMessage()).toBe('Export failed');
      expect(component.exportSuccessMessage()).toBeNull();
    });
  });

  describe('deleteAccount', () => {
    it('shows confirmation dialog when requestDeleteAccount is called', () => {
      component.requestDeleteAccount();

      expect(component.showDeleteConfirm()).toBe(true);
      expect(component.deleteErrorMessage()).toBeNull();
    });

    it('hides confirmation dialog when cancelDelete is called', () => {
      component.requestDeleteAccount();
      component.cancelDelete();

      expect(component.showDeleteConfirm()).toBe(false);
    });

    it('calls deleteCurrentUserAccount, logs out, and navigates on confirm', async () => {
      const router = TestBed.inject(Router);
      const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      component.requestDeleteAccount();
      await component.deleteAccount();

      expect(pocketBaseService.deleteCurrentUserAccount).toHaveBeenCalled();
      expect(authService.logout).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith(['/login']);
    });

    it('shows error when deletion fails', async () => {
      pocketBaseService.deleteCurrentUserAccount.mockRejectedValue(new Error('Deletion failed'));

      component.requestDeleteAccount();
      await component.deleteAccount();

      expect(component.deleteErrorMessage()).toBe('Deletion failed');
      expect(component.showDeleteConfirm()).toBe(false);
    });
  });

  describe('writing style fields', () => {
    it('loads writing style fields from profile metadata on init', () => {
      // ngOnInit ran during the beforeEach detectChanges()
      expect(component.writingStyleDescription()).toBe('Formal and concise tone');
      expect(component.writingStyleUrl()).toBe('https://example.com/style-guide');
    });

    it('saves writing style fields via PocketBaseService', async () => {
      component.writingStyleDescription.set('Casual and friendly');
      component.writingStyleUrl.set('https://example.com/casual');

      await component.saveWritingStyleFields();

      expect(pocketBaseService.saveCurrentProfileMetadata).toHaveBeenCalledWith({
        writingStyleDescription: 'Casual and friendly',
        writingStyleUrl: 'https://example.com/casual',
      });
      expect(component.writingStyleSuccessMessage()).toBe('Préférences de style enregistrées avec succès.');
    });

    it('clears error message before saving', async () => {
      component.writingStyleErrorMessage.set('Previous error');

      await component.saveWritingStyleFields();

      expect(component.writingStyleErrorMessage()).toBeNull();
    });

    it('shows error message on save failure', async () => {
      pocketBaseService.saveCurrentProfileMetadata.mockRejectedValue(new Error('Save failed'));

      component.writingStyleDescription.set('Casual and friendly');

      await component.saveWritingStyleFields();

      expect(component.writingStyleErrorMessage()).toBe('Save failed');
      expect(component.writingStyleSuccessMessage()).toBeNull();
    });

    it('clears fields then saves', async () => {
      component.writingStyleDescription.set('Casual and friendly');
      component.writingStyleUrl.set('https://example.com/casual');

      await component.clearWritingStyleFields();

      expect(pocketBaseService.saveCurrentProfileMetadata).toHaveBeenCalledWith({
        writingStyleDescription: null,
        writingStyleUrl: null,
      });
      expect(component.writingStyleSuccessMessage()).toBe('Préférences de style enregistrées avec succès.');
    });
  });
});
