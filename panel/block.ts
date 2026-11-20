import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { startBlock } from '../src/ui/block.ts';

const root = document.getElementById('root');
if (!root) throw new Error('CI Hub: #root is missing');

const host = connectHost();
let started = false;

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  if (started) return;
  started = true;
  try {
    startBlock(host, root);
  } catch (err) {
    root.textContent = `CI Hub could not start: ${err instanceof Error ? err.message : String(err)}`;
  }
});
