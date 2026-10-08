// Langue des messages d'erreur (SPECIFICATION §10.1) : Accept-Language, fr par défaut, poids q respectés.
import type { ProblemCode } from '@cashless/contracts';
import en from './messages.en.json';
import fr from './messages.fr.json';

export type Language = 'fr' | 'en';
export interface ProblemMessage {
  title: string;
  detail: string;
}

export const MESSAGES: Record<Language, Record<ProblemCode, ProblemMessage>> = { fr, en } as Record<
  Language,
  Record<ProblemCode, ProblemMessage>
>;

export function pickLanguage(header: string | undefined): Language {
  if (!header) return 'fr';
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split('-')[0], weight: Number.isNaN(weight) ? 0 : weight, index };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  const chosen = ranked.find((entry) => entry.lang === 'fr' || entry.lang === 'en');
  return chosen?.lang === 'en' ? 'en' : 'fr';
}

export function messageFor(code: ProblemCode, language: Language): ProblemMessage {
  return MESSAGES[language][code];
}
