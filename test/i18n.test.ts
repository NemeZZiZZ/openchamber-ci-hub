import { describe, expect, test } from 'bun:test';
import { agoText, conLabel, dirOf, localeName, pickLocale, setLocale, strings, t } from '../src/ui/i18n.ts';
import { en } from '../src/ui/i18n/en.ts';
import { formatAgo } from '../src/domain/format.ts';

describe('pickLocale', () => {
  test('exact matches win', () => {
    expect(pickLocale('de')).toBe('de');
    expect(pickLocale('zh-TW')).toBe('zh-TW');
    expect(pickLocale('pt-BR')).toBe('pt-BR');
    expect(pickLocale('he')).toBe('he');
  });
  test('region falls back to the language', () => {
    expect(pickLocale('de-AT')).toBe('de');
    expect(pickLocale('pt-PT')).toBe('pt-BR');
    expect(pickLocale('en-US')).toBe('en');
  });
  test('zh without a region defaults to simplified', () => {
    expect(pickLocale('zh')).toBe('zh-CN');
    expect(pickLocale('zh-HK')).toBe('zh-CN');
  });
  test('unknown, empty and missing locales fall back to english', () => {
    expect(pickLocale('xx')).toBe('en');
    expect(pickLocale('')).toBe('en');
    expect(pickLocale(null)).toBe('en');
    expect(pickLocale(undefined)).toBe('en');
  });
  test('matching ignores case and underscores', () => {
    expect(pickLocale('DE')).toBe('de');
    expect(pickLocale('zh_CN')).toBe('zh-CN');
    expect(pickLocale('PT_br')).toBe('pt-BR');
  });
});

describe('dirOf', () => {
  test('hebrew and arabic are rtl', () => {
    expect(dirOf('he')).toBe('rtl');
    expect(dirOf('ar')).toBe('rtl');
  });
  test('everything else is ltr', () => {
    for (const locale of ['en', 'de', 'fr', 'es', 'pt-BR', 'uk', 'ko', 'pl', 'ja', 'tr', 'nl', 'zh-CN', 'zh-TW']) {
      expect(dirOf(locale)).toBe('ltr');
    }
  });
});

describe('t', () => {
  test('defaults to english', () => {
    setLocale(null);
    expect(t('bar.refresh')).toBe('Refresh');
  });
  test('switches catalogs and back', () => {
    setLocale('de');
    expect(strings()['bar.refresh']).toBe('Aktualisieren');
    expect(t('bar.refresh')).toBe('Aktualisieren');
    setLocale('ja');
    expect(t('bar.refresh')).toBe('更新');
    setLocale(null);
    expect(t('bar.refresh')).toBe('Refresh');
  });
  test('substitutes placeholders', () => {
    setLocale('en');
    expect(t('turnCi.failedOn', { where: 'main', workflow: 'CI', number: 7 })).toBe('CI failed on main: CI #7');
  });
  test('unknown locale falls back to english', () => {
    setLocale('xx-YY');
    expect(t('bar.refresh')).toBe('Refresh');
    setLocale(null);
  });
});

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1] ?? '').sort();
}

describe('locale catalogs', () => {
  test('every locale file is imported', async () => {
    const registry = (await import('../src/ui/i18n.ts')).locales;
    expect(Object.keys(registry).sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'he', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'tr', 'uk', 'zh-CN', 'zh-TW'].sort(),
    );
  });
  test('every locale has exactly the english keys with the same placeholders', async () => {
    const { locales } = await import('../src/ui/i18n.ts');
    const enKeys = Object.keys(en);
    for (const [name, catalog] of Object.entries(locales)) {
      if (name === 'en') continue;
      expect(Object.keys(catalog).sort(), name).toEqual([...enKeys].sort());
      for (const key of enKeys) {
        expect(placeholders(catalog[key as keyof typeof catalog]), `${name}:${key}`).toEqual(
          placeholders(en[key as keyof typeof en]),
        );
      }
    }
  });
});

describe('agoText', () => {
  const now = 1_700_000_000_000;
  const before = localeName();
  test('mirrors the domain thresholds in english', () => {
    setLocale('en');
    expect(agoText(now, now)).toBe('just now');
    expect(agoText(new Date(now - 30_000), now)).toBe('just now');
    expect(agoText(now - 60_000, now)).toBe('1 min ago');
    expect(agoText(now - 59 * 60_000, now)).toBe('59 min ago');
    expect(agoText(now - 60 * 60_000, now)).toBe('1h ago');
    expect(agoText(now - 23 * 3_600_000, now)).toBe('23h ago');
    expect(agoText(now - 24 * 3_600_000, now)).toBe('1d ago');
    expect(agoText(now - 3 * 86_400_000, now)).toBe('3d ago');
    setLocale(before);
  });
  test('accepts date and string inputs and matches formatAgo', () => {
    setLocale('en');
    for (const diff of [0, 59_000, 61_000, 3_599_000, 3_600_000, 86_399_000, 86_400_000]) {
      expect(agoText(now - diff, now)).toBe(formatAgo(now - diff, now));
      expect(agoText(new Date(now - diff).toISOString(), now)).toBe(formatAgo(now - diff, now));
    }
    setLocale(before);
  });
});

describe('conLabel', () => {
  const before = localeName();
  test('maps status words in english', () => {
    setLocale('en');
    expect(conLabel('in_progress')).toBe('in progress');
    expect(conLabel('inprogress')).toBe('in progress');
    expect(conLabel('queued')).toBe('queued');
    expect(conLabel('completed')).toBe('completed');
    expect(conLabel('unknown')).toBe('unknown');
    setLocale(before);
  });
  test('maps conclusion words and aliases in english', () => {
    setLocale('en');
    expect(conLabel('succeeded')).toBe('succeeded');
    expect(conLabel('failed')).toBe('failed');
    expect(conLabel('timed_out')).toBe('timed out');
    expect(conLabel('timedout')).toBe('timed out');
    expect(conLabel('action_required')).toBe('needs action');
    expect(conLabel('startup_failure')).toBe('startup failed');
    expect(conLabel('cancelled')).toBe('cancelled');
    expect(conLabel('skipped')).toBe('skipped');
    setLocale(before);
  });
  test('falls back to the word with underscores as spaces', () => {
    setLocale('en');
    expect(conLabel('stale')).toBe('stale');
    expect(conLabel('merge_request_event')).toBe('merge request event');
    setLocale(before);
  });
});
