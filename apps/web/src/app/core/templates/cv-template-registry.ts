import { Type } from '@angular/core';
import { AfficheCvPage } from '../../pages/templates/affiche-cv-page/affiche-cv-page';
import { ClassicCvPage } from '../../pages/templates/classic-cv-page/classic-cv-page';
import { BentoCvPage } from '../../pages/templates/bento-cv-page/bento-cv-page';
import { MinimalCvPage } from '../../pages/templates/minimal-cv-page/minimal-cv-page';
import { ModernCvPage } from '../../pages/templates/modern-cv-page/modern-cv-page';
import { SupaCVPage } from '../../pages/templates/supa-cv-page/supa-cv-page';

export interface CvTemplateOption {
  id: string;
  label: string;
  component: Type<unknown>;
  extraSchema?: CvTemplateExtraField[];
}

export type CvTemplateExtraFieldType =
  | 'text'
  | 'textarea'
  | 'boolean'
  | 'color'
  | 'select'
  | 'multi_select'
  | 'html'
  | 'richtext';
export type CvTemplateExtraFieldSource = 'projects' | 'jobs' | 'skills' | 'degrees' | 'achievements' | 'hobbies';

export interface CvTemplateExtraFieldOption {
  label: string;
  value: string;
}

export interface CvTemplateExtraField {
  id: string;
  label: string;
  type: CvTemplateExtraFieldType;
  description: string;
  required?: boolean;
  source?: CvTemplateExtraFieldSource;
  options?: CvTemplateExtraFieldOption[];
}

export const CV_TEMPLATE_OPTIONS: CvTemplateOption[] = [
  { id: 'classic', label: 'Classic', component: ClassicCvPage },
  {
    id: 'bento',
    label: 'Bento',
    component: BentoCvPage,
    extraSchema: [
      {
        id: 'qrCodeUrl',
        label: 'QR code URL',
        type: 'text',
        description: 'URL encoded into the QR code. Leave empty to auto-generate from the profile public route.',
      },
    ],
  },
  {
    id: 'modern',
    label: 'Modern',
    component: ModernCvPage,
    extraSchema: [
      {
        id: 'headline',
        label: 'Headline',
        type: 'text',
        description: 'Short role-focused line displayed near the candidate name.',
      },
      {
        id: 'accentColor',
        label: 'Accent color',
        type: 'color',
        description: 'Main visual accent color for this profile.',
      },
    ],
  },
  {
    id: 'supa',
    label: 'Supa',
    component: SupaCVPage,
    extraSchema: [
      {
        id: 'compactMode',
        label: 'Compact mode',
        type: 'boolean',
        description: 'Whether the template should aggressively reduce spacing to fit more content on one A4 page.',
      },
    ],
  },
  { id: 'minimal', label: 'Minimal', component: MinimalCvPage },
  {
    id: 'affiche',
    label: 'Affiche',
    component: AfficheCvPage,
    extraSchema: [
      {
        id: 'availability',
        label: 'Statut de disponibilité',
        type: 'text',
        description:
          "Texte de la pastille de statut du recto. Laisser vide pour afficher « Disponible ».",
      },
      {
        id: 'backPageHtml',
        label: 'Verso — markup personnalisé',
        type: 'html',
        description:
          "Markup HTML remplaçant la galerie « Univers » du verso. Laisser vide pour garder la galerie générée depuis les projets.",
      },
      {
        id: 'fitLead',
        label: 'Pourquoi moi — accroche',
        type: 'text',
        description:
          "Titre du volet « Pourquoi moi » du verso. Laisser vide pour garder l'accroche par défaut.",
      },
      {
        id: 'fitRichText',
        label: 'Pourquoi moi — texte enrichi',
        type: 'richtext',
        description:
          "Paragraphe enrichi affiché juste avant les réalisations du volet « Pourquoi moi ». Les réalisations qui ne tiennent plus dans le volet sont masquées.",
      },
      {
        id: 'showAllPages',
        label: 'Afficher toutes les pages',
        type: 'boolean',
        description: 'Rend le verso en plus du recto. Désactivé, seule la première feuille est rendue.',
      },
    ],
  },
];

export const CV_TEMPLATE_OPTIONS_BY_ID = new Map(CV_TEMPLATE_OPTIONS.map((template) => [template.id, template]));

export function isKnownCvTemplate(templateId: string | null | undefined): templateId is string {
  return !!templateId && CV_TEMPLATE_OPTIONS_BY_ID.has(templateId);
}
