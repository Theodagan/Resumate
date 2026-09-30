import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Navbar } from '../../shared/components/navbar/navbar';
import { PocketBaseService } from '../../core/services/pocketbase.service';
import { AuthService } from '../../core/services/auth.service';
import { getErrorMessage } from '../../core/utils/error-message';

@Component({
  selector: 'app-account-page',
  imports: [FormsModule, Navbar, RouterLink],
  templateUrl: './account-page.html',
  styleUrls: ['./account-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountPage implements OnInit {
  private readonly pocketBaseService = inject(PocketBaseService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  readonly currentUser = this.authService.currentUser;
  readonly mcpCvEnabled = signal(true);
  readonly mcpMaterialsEnabled = signal(false);
  readonly mcpSaving = signal(false);
  readonly mcpError = signal<string | null>(null);
  readonly mcpSaved = signal(false);

  readonly writingStyleDescription = signal<string>('');
  readonly writingStyleUrl = signal<string>('');
  readonly isSavingWritingStyle = signal(false);
  readonly writingStyleErrorMessage = signal<string | null>(null);
  readonly writingStyleSuccessMessage = signal<string | null>(null);

  readonly oldPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');
  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly isDeleting = signal(false);
  readonly deleteErrorMessage = signal<string | null>(null);
  readonly showDeleteConfirm = signal(false);

  readonly isExporting = signal(false);
  readonly exportErrorMessage = signal<string | null>(null);
  readonly exportSuccessMessage = signal<string | null>(null);

  ngOnInit(): void {
    void this.loadWritingStyleFields();
    void this.loadMcpPreferences();
  }

  private async loadMcpPreferences(): Promise<void> {
    try {
      const user = await this.pocketBaseService.getCurrentUserMcpPreferences();
      this.mcpCvEnabled.set(user.mcpCvEnabled !== false);
      this.mcpMaterialsEnabled.set(user.mcpMaterialsEnabled === true);
    } catch (error: unknown) {
      this.mcpError.set(getErrorMessage(error));
    }
  }

  async saveMcpPreferences(): Promise<void> {
    this.mcpError.set(null);
    this.mcpSaved.set(false);
    this.mcpSaving.set(true);
    try {
      await this.pocketBaseService.saveCurrentUserMcpPreferences({
        mcpCvEnabled: this.mcpCvEnabled(),
        mcpMaterialsEnabled: this.mcpMaterialsEnabled(),
      });
      this.mcpSaved.set(true);
    } catch (error: unknown) {
      this.mcpError.set(getErrorMessage(error));
    } finally {
      this.mcpSaving.set(false);
    }
  }

  private async loadWritingStyleFields(): Promise<void> {
    try {
      const metadata = await this.pocketBaseService.getCurrentProfileMetadata();
      this.writingStyleDescription.set(metadata?.writingStyleDescription ?? '');
      this.writingStyleUrl.set(metadata?.writingStyleUrl ?? '');
    } catch (error: unknown) {
      this.writingStyleErrorMessage.set(getErrorMessage(error));
    }
  }

  async saveWritingStyleFields(): Promise<void> {
    this.writingStyleErrorMessage.set(null);
    this.writingStyleSuccessMessage.set(null);
    this.isSavingWritingStyle.set(true);

    try {
      await this.pocketBaseService.saveCurrentProfileMetadata({
        writingStyleDescription: this.writingStyleDescription() || null,
        writingStyleUrl: this.writingStyleUrl() || null,
      });
      this.writingStyleSuccessMessage.set('Préférences de style enregistrées avec succès.');
    } catch (error: unknown) {
      this.writingStyleErrorMessage.set(getErrorMessage(error));
    } finally {
      this.isSavingWritingStyle.set(false);
    }
  }

  async clearWritingStyleFields(): Promise<void> {
    this.writingStyleDescription.set('');
    this.writingStyleUrl.set('');
    await this.saveWritingStyleFields();
  }

  async changePassword(): Promise<void> {
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const oldPw = this.oldPassword();
    const newPw = this.newPassword();
    const confirmPw = this.confirmPassword();

    if (!oldPw) {
      this.errorMessage.set('Veuillez saisir votre mot de passe actuel.');
      return;
    }

    if (!newPw) {
      this.errorMessage.set('Veuillez saisir un nouveau mot de passe.');
      return;
    }

    if (newPw.length < 8) {
      this.errorMessage.set('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      return;
    }

    if (newPw !== confirmPw) {
      this.errorMessage.set('Les mots de passe ne correspondent pas.');
      return;
    }

    this.isSubmitting.set(true);

    try {
      await this.pocketBaseService.changeCurrentUserPassword(oldPw, newPw, confirmPw);
      this.successMessage.set('Mot de passe modifié avec succès.');
      this.oldPassword.set('');
      this.newPassword.set('');
      this.confirmPassword.set('');
    } catch (error: unknown) {
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  requestDeleteAccount(): void {
    this.deleteErrorMessage.set(null);
    this.showDeleteConfirm.set(true);
  }

  cancelDelete(): void {
    this.showDeleteConfirm.set(false);
  }

  async deleteAccount(): Promise<void> {
    this.deleteErrorMessage.set(null);
    this.isDeleting.set(true);

    try {
      await this.pocketBaseService.deleteCurrentUserAccount();
      this.authService.logout();
      await this.router.navigate(['/login']);
    } catch (error: unknown) {
      this.deleteErrorMessage.set(getErrorMessage(error));
      this.showDeleteConfirm.set(false);
    } finally {
      this.isDeleting.set(false);
    }
  }

  async exportData(): Promise<void> {
    this.exportErrorMessage.set(null);
    this.exportSuccessMessage.set(null);
    this.isExporting.set(true);

    try {
      const data = await this.pocketBaseService.exportCurrentUserData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `resumate-data-${new Date().toISOString().split('T')[0]}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.exportSuccessMessage.set('Vos données ont été exportées avec succès. Le téléchargement a commencé.');
    } catch (error: unknown) {
      this.exportErrorMessage.set(getErrorMessage(error));
    } finally {
      this.isExporting.set(false);
    }
  }
}
