// The panel's own preferences: two on/off switches in a popover behind the ⚙
// button. They live in the service's data folder (GET/PUT /prefs), so the
// service itself honours them even when no frame is open.

import { h } from '../dom.ts';
import { t } from '../i18n.ts';
import type { App } from './state.ts';
import { prefRows } from './turnCi.ts';

interface Prefs {
  marks: boolean;
  toastOnTurnFailure: boolean;
}

const DEFAULTS: Prefs = { marks: true, toastOnTurnFailure: true };

export const mountPrefs = (app: App, anchor: HTMLElement): { sync(): void } => {
  let prefs: Prefs = DEFAULTS;
  let loaded = false;

  const toggle = h('button', {
    class: 'cih-prefs-toggle',
    type: 'button',
    text: '⚙',
    title: t('prefs.title'),
    'aria-label': t('prefs.title'),
    'aria-expanded': 'false',
  });
  const pop = h('div', { class: 'cih-prefs', role: 'dialog', 'aria-label': t('prefs.title'), hidden: true });
  const rowsEl = h('div', { class: 'cih-prefs-rows' });
  pop.append(h('div', { class: 'cih-prefs-title', text: t('prefs.title') }), rowsEl);
  anchor.append(toggle, pop);

  const renderRows = () => {
    rowsEl.textContent = '';
    for (const row of prefRows(prefs)) {
      const options = h('div', { class: 'cih-seg', role: 'group', 'aria-label': row.label });
      for (const on of [true, false]) {
        options.append(
          h('button', {
            type: 'button',
            class: 'cih-seg-option',
            text: on ? t('prefs.on') : t('prefs.off'),
            'aria-pressed': String(row.on === on),
            onClick: () => void set(row.id, on),
          }),
        );
      }
      rowsEl.append(h('div', { class: 'cih-prefs-row' }, h('span', { class: 'cih-prefs-label', text: row.label }), options));
    }
  };

  const set = async (id: 'marks' | 'toastOnTurnFailure', on: boolean) => {
    const before = prefs;
    prefs = { ...prefs, [id]: on };
    renderRows();
    try {
      prefs = await app.svc<Prefs>({ method: 'PUT', path: '/prefs', body: { [id]: on } });
    } catch (err) {
      prefs = before;
      app.toast('error', err instanceof Error ? err.message : t('prefs.saveFailed'));
    }
    renderRows();
  };

  const load = async () => {
    try {
      prefs = await app.svc<Prefs>({ path: '/prefs' });
      loaded = true;
    } catch {
      prefs = DEFAULTS;
    }
    renderRows();
  };

  let isOpen = false;
  const setOpen = (open: boolean) => {
    isOpen = open;
    pop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      renderRows();
      if (!loaded) void load();
    }
  };

  toggle.addEventListener('click', () => setOpen(!isOpen));
  document.addEventListener('click', (event) => {
    if (isOpen && !anchor.contains(event.target as Node)) setOpen(false);
  });

  return { sync: renderRows };
};
