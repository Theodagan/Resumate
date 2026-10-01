import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('color-scheme');
    document.documentElement.removeAttribute('data-theme');
  });

  it('initializes from localStorage and applies the theme', () => {
    localStorage.setItem('resumate:theme', 'light');

    const service = new ThemeService();

    expect(service.currentTheme()).toBe('light');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('honours the pre-rename theme key so an existing light choice survives', () => {
    localStorage.setItem('theme', 'light');

    expect(new ThemeService().currentTheme()).toBe('light');
  });

  it('prefers the namespaced key over the legacy one', () => {
    localStorage.setItem('theme', 'light');
    localStorage.setItem('resumate:theme', 'dark');

    expect(new ThemeService().currentTheme()).toBe('dark');
  });

  it('falls back to dark for a legacy system preference, which the theme union no longer carries', () => {
    localStorage.setItem('theme', 'system');

    expect(new ThemeService().currentTheme()).toBe('dark');
  });

  it('falls back to dark for unsupported stored values', () => {
    localStorage.setItem('resumate:theme', 'neon');

    const service = new ThemeService();

    expect(service.currentTheme()).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('sets and toggles themes through the supported cycle', () => {
    const service = new ThemeService();

    service.setTheme('light');
    expect(localStorage.getItem('resumate:theme')).toBe('light');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');

    service.toggle();
    expect(service.currentTheme()).toBe('dark');
    service.toggle();
    expect(service.currentTheme()).toBe('light');
  });
});
