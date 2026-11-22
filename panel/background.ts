import { connectHost } from '@openchamber/sdk';
import { startBackground } from '../src/ui/background.ts';
import { installCatalogs, setLocale } from '../src/ui/i18n.ts';
import { pickCatalogs } from '../src/ui/i18n/pick.ts' with { type: 'macro' };

installCatalogs(pickCatalogs('background'));

const host = connectHost();
let started = false;

host.onReady((ctx) => {
  if (started) return;
  started = true;
  setLocale(ctx.locale);
  startBackground(host, ctx);
});
