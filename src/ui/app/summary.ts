// The "Why it failed" card above the log. Answers are cached in host.storage
// per run attempt; a late generate result is filed by app.ts and lands here on
// the next render.

import { HostRequestError, type LateGenerateResult } from '@openchamber/sdk';
import { summaryKey, summaryKeyFromPrompt, summaryRequest } from '../../domain/summary.ts';
import { isFailed } from '../../domain/format.ts';
import { h } from '../dom.ts';
import { t } from '../i18n.ts';
import { button, type App, type Region } from './state.ts';

interface Entry {
  text: string | null;
  loading: boolean;
}

const entries = new Map<string, Entry>();

/** Stores a late answer so the next render of that run shows it. */
export const fileSummary = (key: string, text: string): void => {
  entries.set(key, { text, loading: false });
};

/**
 * A generate answer that arrived after its frame was gone. Only prompts with
 * our marker are ours; a failure still tells the user, it never files a text.
 * Returns the filed key so the caller can re-render the run it belongs to.
 */
export const lateSummary = (
  late: LateGenerateResult,
  hooks: { toast(kind: 'success' | 'info' | 'error', message: string): void; file(key: string, text: string): void },
): string | null => {
  const key = summaryKeyFromPrompt(late.request.prompt);
  if (!key) return null;
  if (!late.ok) {
    hooks.toast(
      'info',
      late.code === 'NO_MODEL' ? t('summary.noModel') : t('summary.lateFailed', { error: late.error }),
    );
    return null;
  }
  const text = late.result.text.trim();
  hooks.file(key, text);
  return key;
};

const entryFor = (key: string): Entry => {
  let entry = entries.get(key);
  if (!entry) {
    entry = { text: null, loading: false };
    entries.set(key, entry);
  }
  return entry;
};

export const renderSummary = (app: App, region: Region): void => {
  const current = app.s.detail;
  const run = current?.run;
  const log = current?.log;
  if (!current || !run || !log || !isFailed(run) || !log.text) return;

  const key = summaryKey(run);
  const entry = entryFor(key);
  const box = h('div', { class: 'cih-summary' });

  if (entry.text) {
    box.append(h('div', { class: 'cih-card-title', text: t('summary.why') }), h('div', { class: 'cih-summary-text', text: entry.text }));
    region.el.append(box);
    return;
  }

  box.append(
    button(region, {
      label: entry.loading ? t('summary.asking') : t('summary.why'),
      size: 'xs',
      variant: 'outline',
      disabled: entry.loading,
      onClick: () => void ask(),
    }),
  );
  region.el.append(box);

  const ask = async () => {
    entry.loading = true;
    app.renderLog();
    try {
      const cached = await app.host.storage.get(key);
      if (typeof cached === 'string' && cached) {
        entry.text = cached;
        return;
      }
      const result = await app.host.generate({ ...summaryRequest(run, current.jobs, log.text!), maxOutputTokens: 400 });
      entry.text = result.text.trim();
      await app.host.storage.set(key, entry.text).catch(() => undefined);
    } catch (err) {
      if (err instanceof HostRequestError && err.code === 'NO_MODEL') {
        app.toast('info', t('summary.noModel'));
      } else {
        app.toast('error', err instanceof Error ? err.message : t('summary.failed'));
      }
    } finally {
      entry.loading = false;
      // The user may have moved to another run while the model answered.
      if (app.s.detail?.run && summaryKey(app.s.detail.run) === key) app.renderLog();
    }
  };
};
