import { describe, expect, test } from 'bun:test';
import { withTimeout } from '../src/providers/errors.ts';

const hanging = (input: string, init?: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

describe('withTimeout', () => {
  test('aborts a request the host never answers', async () => {
    const fetch = withTimeout(hanging, 20);
    await expect(fetch('https://ci.example')).rejects.toThrow();
  });

  test('keeps a signal the caller passed', async () => {
    const fetch = withTimeout(hanging, 60_000);
    const caller = new AbortController();
    const pending = fetch('https://ci.example', { signal: caller.signal });
    caller.abort(new Error('caller gave up'));
    await expect(pending).rejects.toThrow('caller gave up');
  });

  test('passes the answer through', async () => {
    const fetch = withTimeout(async () => new Response('ok'), 1_000);
    expect(await (await fetch('https://ci.example')).text()).toBe('ok');
  });
});
