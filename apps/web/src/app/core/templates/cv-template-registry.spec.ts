import { CV_TEMPLATE_OPTIONS_BY_ID, isKnownCvTemplate } from './cv-template-registry';

describe('cv-template-registry', () => {
  it('recognizes known templates', () => {
    expect(isKnownCvTemplate('classic')).toBe(true);
    expect(isKnownCvTemplate('bento')).toBe(true);
    expect(isKnownCvTemplate('modern')).toBe(true);
    expect(isKnownCvTemplate('supa')).toBe(true);
    expect(isKnownCvTemplate('minimal')).toBe(true);
    expect(isKnownCvTemplate('affiche')).toBe(true);
  });

  it('declares the affiche extras with their editor control types', () => {
    const extraSchema = CV_TEMPLATE_OPTIONS_BY_ID.get('affiche')?.extraSchema ?? [];

    expect(extraSchema.map((field) => [field.id, field.type])).toEqual([
      ['availability', 'text'],
      ['backPageHtml', 'html'],
      ['fitLead', 'text'],
      ['fitRichText', 'richtext'],
      ['showAllPages', 'boolean'],
    ]);
    expect(extraSchema.every((field) => Boolean(field.label) && Boolean(field.description))).toBe(true);
  });

  it('rejects unknown and falsy templates', () => {
    expect(isKnownCvTemplate('unknown')).toBe(false);
    expect(isKnownCvTemplate(null)).toBe(false);
    expect(isKnownCvTemplate(undefined)).toBe(false);
    expect(isKnownCvTemplate('')).toBe(false);
  });
});