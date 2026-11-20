// UI localization. The english file is the source catalog; every other
// locale mirrors its keys exactly (enforced by the Strings type and by
// test/i18n.test.ts). Agent/model-facing strings stay english on purpose.

import { ar } from './i18n/ar.ts';
import { de } from './i18n/de.ts';
import { en, type Key, type Strings } from './i18n/en.ts';
import { es } from './i18n/es.ts';
import { fr } from './i18n/fr.ts';
import { he } from './i18n/he.ts';
import { ja } from './i18n/ja.ts';
import { ko } from './i18n/ko.ts';
import { nl } from './i18n/nl.ts';
import { pl } from './i18n/pl.ts';
import { zhCn } from './i18n/zh-CN.ts';
import { zhTw } from './i18n/zh-TW.ts';
import { ptBr } from './i18n/pt-BR.ts';
import { tr } from './i18n/tr.ts';
import { uk } from './i18n/uk.ts';

export type { Key, Strings };

export const locales: Record<string, Strings> = {
  en,
  de,
  fr,
  'zh-CN': zhCn,
  'zh-TW': zhTw,
  uk,
  es,
  'pt-BR': ptBr,
  ko,
  pl,
  ja,
  tr,
  nl,
  he,
  ar,
};

function normalize(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/_/g, '-');
}

const byLowerName = new Map<string, string>(
  Object.keys(locales).map((name) => [name.toLowerCase(), name]),
);

/** Resolve a host locale tag to a catalog: exact, then language, then en. */
export function pickLocale(raw: string | null | undefined): string {
  const tag = normalize(raw);
  if (!tag) return 'en';
  const exact = byLowerName.get(tag);
  if (exact) return exact;
  const lang = tag.split('-')[0];
  if (lang === 'zh') return 'zh-CN';
  for (const name of Object.keys(locales)) {
    if (name.toLowerCase() === lang || name.toLowerCase().startsWith(`${lang}-`)) return name;
  }
  return 'en';
}

export function dirOf(locale: string): 'rtl' | 'ltr' {
  const lang = normalize(locale).split('-')[0];
  return lang === 'he' || lang === 'ar' ? 'rtl' : 'ltr';
}

let current: Strings = en;
let currentName = 'en';

/** Switch the active catalog; accepts a raw host locale tag. */
export function setLocale(raw: string | null | undefined): string {
  currentName = pickLocale(raw);
  current = locales[currentName] ?? en;
  return currentName;
}

export function localeName(): string {
  return currentName;
}

/** Active catalog (defaults to english). */
export function strings(): Strings {
  return current;
}

/** Translate a key, substituting {placeholders} from vars. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const template = current[key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{([^{}]+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Localized "x ago" for a timestamp, mirroring domain/format.ts formatAgo
 * thresholds. Agent/model-facing strings stay english on purpose; this one is
 * for the panel, so it follows the active catalog.
 */
export function agoText(at: number | string | Date, now: number = Date.now()): string {
  const ms = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : at;
  if (!Number.isFinite(ms)) return '—';
  const m = Math.floor(Math.max(0, now - (ms as number)) / 60000);
  if (m < 1) return t('ago.justNow');
  if (m < 60) return t('ago.min', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('ago.hours', { n: h });
  return t('ago.days', { n: Math.floor(h / 24) });
}

/**
 * Localized conclusion/status word for a run, job or step. The input is a
 * single raw word the service uses (`in_progress`, `queued`, `timed_out`,
 * …); anything unlisted falls back to the word itself with underscores as
 * spaces, the same as the old domain conclusionLabel default.
 */
export function conLabel(c: string): string {
  switch (c) {
    case 'in_progress':
    case 'inprogress':
      return t('con.inProgress');
    case 'queued':
      return t('con.queued');
    case 'completed':
      return t('con.completed');
    case 'unknown':
      return t('con.unknown');
    case 'succeeded':
      return t('con.succeeded');
    case 'failed':
      return t('con.failed');
    case 'timed_out':
    case 'timedout':
      return t('con.timedOut');
    case 'action_required':
      return t('con.needsAction');
    case 'startup_failure':
      return t('con.startupFailed');
    case 'cancelled':
      return t('con.cancelled');
    case 'skipped':
      return t('con.skipped');
    default:
      return c.replace(/_/g, ' ');
  }
}
