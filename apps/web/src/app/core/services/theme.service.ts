import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'resumate:theme';

/**
 * Key used before the namespaced one. Read as a fallback so a light-mode choice made by an existing
 * user survives the rename. A legacy `system` value cannot be honoured — the theme union no longer
 * carries it — and falls through to the current `dark` default.
 */
const LEGACY_THEME_KEY = 'theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly currentTheme = signal<Theme>('dark');

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY);
    } catch {
      // Storage can be unavailable in privacy-restricted contexts.
    }
    this.currentTheme.set(saved === 'light' ? 'light' : 'dark');
    this.applyTheme();
  }

  toggle(): void {
    this.currentTheme.update((t) => {
      const next: Theme = t === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // The active theme still applies for this session.
      }
      return next;
    });
    this.applyTheme();
  }

  setTheme(theme: Theme): void {
    this.currentTheme.set(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // The active theme still applies for this session.
    }
    this.applyTheme();
  }

  private applyTheme(): void {
    const theme = this.currentTheme();
    document.documentElement.style.setProperty('color-scheme', theme);
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
}
