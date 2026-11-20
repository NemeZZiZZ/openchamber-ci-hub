// UI localization. The english file is the source catalog; every other
// locale mirrors its keys exactly (enforced by the Strings type and by
// test/i18n.test.ts). Agent/model-facing strings stay english on purpose.

import { ar, plurals as pluralsAr } from './i18n/ar.ts';
import { de, plurals as pluralsDe } from './i18n/de.ts';
import { en, plurals as pluralsEn, type Key, type Strings } from './i18n/en.ts';
import { es, plurals as pluralsEs } from './i18n/es.ts';
import { fr, plurals as pluralsFr } from './i18n/fr.ts';
import { he, plurals as pluralsHe } from './i18n/he.ts';
import { ja, plurals as pluralsJa } from './i18n/ja.ts';
import { ko, plurals as pluralsKo } from './i18n/ko.ts';
import { nl, plurals as pluralsNl } from './i18n/nl.ts';
import { pl, plurals as pluralsPl } from './i18n/pl.ts';
import { ru, plurals as pluralsRu } from './i18n/ru.ts';
import { zhCn, plurals as pluralsZhCn } from './i18n/zh-CN.ts';
import { zhTw, plurals as pluralsZhTw } from './i18n/zh-TW.ts';
import { ptBr, plurals as pluralsPtBr } from './i18n/pt-BR.ts';
import { tr, plurals as pluralsTr } from './i18n/tr.ts';
import { uk, plurals as pluralsUk } from './i18n/uk.ts';

export type { Key, Strings };

/** One count-sensitive string: forms by Intl.PluralRules category, `other` required. */
export type PluralForms = { other: string } & Partial<Record<string, string>>;
export type PluralTable = Record<string, PluralForms>;

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
  ru,
};

export const pluralTables: Record<string, PluralTable> = {
  en: pluralsEn,
  de: pluralsDe,
  fr: pluralsFr,
  'zh-CN': pluralsZhCn,
  'zh-TW': pluralsZhTw,
  uk: pluralsUk,
  es: pluralsEs,
  'pt-BR': pluralsPtBr,
  ko: pluralsKo,
  pl: pluralsPl,
  ja: pluralsJa,
  tr: pluralsTr,
  nl: pluralsNl,
  he: pluralsHe,
  ar: pluralsAr,
  ru: pluralsRu,
};

const enPlurals: PluralTable = pluralsEn;

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
let currentPlurals: PluralTable = pluralsEn;
let currentName = 'en';

/** Switch the active catalog; accepts a raw host locale tag. */
export function setLocale(raw: string | null | undefined): string {
  currentName = pickLocale(raw);
  current = locales[currentName] ?? en;
  currentPlurals = pluralTables[currentName] ?? enPlurals;
  return currentName;
}

export function localeName(): string {
  return currentName;
}

/** Active catalog (defaults to english). */
export function strings(): Strings {
  return current;
}

const fill = (template: string, vars: Record<string, string | number>): string =>
  template.replace(/\{([^{}]+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );

/** Translate a key, substituting {placeholders} from vars. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const template = current[key] ?? en[key] ?? key;
  if (!vars) return template;
  return fill(template, vars);
}

/** The Intl.PluralRules category for n in the active locale, or `other` if the runtime lacks the API. */
const pluralCategory = (n: number): string => {
  try {
    return new Intl.PluralRules(currentName).select(n);
  } catch {
    return 'other';
  }
};

/**
 * Translate a count-sensitive key: picks the plural form for n in the active
 * locale, then substitutes {placeholders} with vars plus {n}. Falls back to
 * the plain key from the catalog when no plural forms are listed for it.
 */
export function tPlural(key: string, n: number, vars?: Record<string, string | number>): string {
  const forms = currentPlurals[key] ?? enPlurals[key];
  const template = forms ? (forms[pluralCategory(n)] ?? forms.other) : (current[key as Key] ?? en[key as Key] ?? key);
  return fill(template, { ...vars, n });
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
  if (m < 60) return tPlural('ago.min', m);
  const h = Math.floor(m / 60);
  if (h < 24) return tPlural('ago.hours', h);
  return tPlural('ago.days', Math.floor(h / 24));
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
