import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { startBlock } from '../src/ui/block.ts';
import { dirOf, installCatalogs, setLocale } from '../src/ui/i18n.ts';
import { pickCatalogs } from '../src/ui/i18n/pick.ts' with { type: 'macro' };

installCatalogs(pickCatalogs('block'));

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
    startBlock(host, root);
  } catch (err) {
    root.textContent = `CI Hub could not start: ${err instanceof Error ? err.message : String(err)}`;
  }
});
