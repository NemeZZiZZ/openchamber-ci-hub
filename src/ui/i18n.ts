// UI localization. The english file is the source catalog; every other
// locale mirrors its keys exactly (enforced by the Strings type and by
// test/i18n.test.ts). Agent/model-facing strings stay english on purpose.

import type { Key, Strings } from './i18n/en.ts';

export type { Key, Strings };

/** One count-sensitive string: forms by Intl.PluralRules category, `other` required. */
export type PluralForms = { other: string } & Partial<Record<string, string>>;
export type PluralTable = Record<string, PluralForms>;

/**
 * The catalogs a bundle carries. The panel installs every key
 * (./i18n/all.ts); the block and background bundles install only the keys
 * their code asks for (./i18n/pick.ts), so each frame does not ship the
 * whole panel catalog in every language.
 */
export type Catalogs = {
  strings: Record<string, Partial<Strings>>;
  plurals: Record<string, PluralTable>;
};

let installed: Catalogs = { strings: {}, plurals: {} };

export function installCatalogs(catalogs: Catalogs): void {
  installed = catalogs;
  byLowerName = new Map(Object.keys(catalogs.strings).map((name) => [name.toLowerCase(), name]));
  setLocale(currentName);
}

function normalize(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/_/g, '-');
}

let byLowerName = new Map<string, string>();

/** Resolve a host locale tag to a catalog: exact, then language, then en. */
export function pickLocale(raw: string | null | undefined): string {
  const tag = normalize(raw);
  if (!tag) return 'en';
  const exact = byLowerName.get(tag);
  if (exact) return exact;
  const lang = tag.split('-')[0];
  if (lang === 'zh') return 'zh-CN';
  for (const name of Object.keys(installed.strings)) {
    if (name.toLowerCase() === lang || name.toLowerCase().startsWith(`${lang}-`)) return name;
  }
  return 'en';
}

export function dirOf(locale: string): 'rtl' | 'ltr' {
  const lang = normalize(locale).split('-')[0];
  return lang === 'he' || lang === 'ar' ? 'rtl' : 'ltr';
}

const english = (): Partial<Strings> => installed.strings['en'] ?? {};
const englishPlurals = (): PluralTable => installed.plurals['en'] ?? {};

let current: Partial<Strings> = {};
let currentPlurals: PluralTable = {};
let currentName = 'en';

/** Switch the active catalog; accepts a raw host locale tag. */
export function setLocale(raw: string | null | undefined): string {
  currentName = pickLocale(raw);
  current = installed.strings[currentName] ?? english();
  currentPlurals = installed.plurals[currentName] ?? englishPlurals();
  return currentName;
}

export function localeName(): string {
  return currentName;
}

/** Active catalog (defaults to english); a picked bundle holds only its own keys. */
export function strings(): Partial<Strings> {
  return current;
}

const fill = (template: string, vars: Record<string, string | number>): string =>
  template.replace(/\{([^{}]+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );

/** Translate a key, substituting {placeholders} from vars. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const template = current[key] ?? english()[key] ?? key;
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
  const forms = currentPlurals[key] ?? englishPlurals()[key];
  const template = forms ? (forms[pluralCategory(n)] ?? forms.other) : (current[key as Key] ?? english()[key as Key] ?? key);
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
