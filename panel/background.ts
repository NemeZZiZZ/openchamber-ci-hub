import { connectHost } from '@openchamber/sdk';
import { startBackground } from '../src/ui/background.ts';
import { setLocale } from '../src/ui/i18n.ts';

const host = connectHost();
let started = false;

host.onReady((ctx) => {
  if (started) return;
  started = true;
  setLocale(ctx.locale);
  startBackground(host, ctx);
});
