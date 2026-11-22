import { describe, expect, test } from 'bun:test';
import { openDispatch } from '../src/ui/app/dispatch.ts';
import type { App } from '../src/ui/app/state.ts';

const fakeApp = () => {
  const answers = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const app = {
    s: { overview: null } as Record<string, unknown>,
    repoView: () => undefined,
    show: () => undefined,
    renderSide: () => undefined,
    svc: (req: { query: { repo: string } }) =>
      new Promise((resolve, reject) => answers.set(req.query.repo, { resolve, reject })),
  };
  return { app: app as unknown as App, answers };
};

describe('openDispatch', () => {
  test('a late failure for the previous repository does not land on the new one', async () => {
    const { app, answers } = fakeApp();
    openDispatch(app, 'github:github.com/acme/app');
    openDispatch(app, 'github:github.com/acme/lib');
    answers.get('github:github.com/acme/app')!.reject(new Error('app is gone'));
    await Bun.sleep(0);
    expect(app.s.dispatch!.error).toBeNull();
    expect(app.s.dispatch!.loading).toBe(true);
  });
});
