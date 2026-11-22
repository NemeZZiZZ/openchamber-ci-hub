import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { startApp } from '../src/ui/app.ts';
import { dirOf, installCatalogs, setLocale } from '../src/ui/i18n.ts';
import { allCatalogs } from '../src/ui/i18n/all.ts';

installCatalogs(allCatalogs);

const root = document.getElementById('root');
if (!root) throw new Error('CI Hub: #root is missing');

const host = connectHost();
let started = false;

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  const locale = setLocale(ctx.locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = dirOf(locale);
  if (started) return;
  started = true;
  try {
    startApp(host, root, ctx);
  } catch (err) {
    root.textContent = `CI Hub could not start: ${err instanceof Error ? err.message : String(err)}`;
  }
});
