import { connectHost } from '@openchamber/sdk';
import { startBackground } from '../src/ui/background.ts';

const host = connectHost();
let started = false;

host.onReady((ctx) => {
  if (started) return;
  started = true;
  startBackground(host, ctx);
});
