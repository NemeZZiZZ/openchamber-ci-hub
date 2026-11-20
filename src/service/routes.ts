// HTTP surface of the service. Frames reach it through host.serviceRequest,
// the app through the status section and waits. Every handler answers JSON;
// a provider problem becomes a message the panel can show, never a bare 500.

import { readSessionEventRequest, readWaitCheckRequest, readWaitStartRequest, MENTIONS_RESOLVE_PATH, MENTIONS_SEARCH_PATH, SESSION_EVENTS_PATH, WAITS_CHECK_PATH, WAITS_START_PATH } from '@openchamber/sdk';
import { ProviderError } from '../providers/errors.ts';
import { EngineError, type Engine } from './engine.ts';

export interface RouteRequest {
  method: string;
  url: string;
  body: string;
}

export interface RouteResponse {
  status: number;
  body: unknown;
}

const ok = (body: unknown): RouteResponse => ({ status: 200, body });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): RouteResponse => ({
  status,
  body: { error, message: error, ...extra },
});

const readJson = (body: string): Record<string, unknown> => {
  if (!body.trim()) return {};
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    throw new EngineError('Request body is not JSON.');
  }
};

const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

const required = (value: string, name: string): string => {
  if (!value) throw new EngineError(`Missing ${name}.`);
  return value;
};

const toResponse = (err: unknown): RouteResponse => {
  if (err instanceof EngineError) return fail(err.status, err.message);
  if (err instanceof ProviderError) {
    const status =
      err.kind === 'auth' ? 401 : err.kind === 'not-found' ? 404 : err.kind === 'rate-limit' ? 429 : err.kind === 'forbidden' ? 403 : 502;
    return fail(status, err.message, { kind: err.kind, retryAt: err.rateLimitReset ?? null });
  }
  console.error('[ci-hub] unexpected error', err);
  return fail(500, 'CI Hub hit an unexpected error; see the service log.');
};

export const handleRequest = async (request: RouteRequest, engine: Engine): Promise<RouteResponse> => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const q = (name: string) => url.searchParams.get(name) ?? '';
  const method = request.method.toUpperCase();
  const path = url.pathname;

  try {
    if (method === 'GET' && path === '/health') return ok({ ok: true, ...engine.debug() });

    if (method === 'GET' && path === '/prefs') return ok(await engine.getPrefs());
    if (method === 'PUT' && path === '/prefs') return ok(await engine.setPrefs(readJson(request.body)));

    if (method === 'POST' && path === SESSION_EVENTS_PATH) {
      const parsed = readSessionEventRequest(request.body);
      if (!parsed) return fail(400, 'Malformed session event.');
      return ok(await engine.sessionEvent(parsed));
    }

    if (path === WAITS_START_PATH && method === 'POST') {
      const parsed = readWaitStartRequest(request.body);
      if (!parsed) return fail(400, 'Malformed wait request.');
      return ok(await engine.waitStart(parsed.wait.args as Record<string, unknown>, parsed.wait.session.directory));
    }
    if (path === WAITS_CHECK_PATH && method === 'POST') {
      const parsed = readWaitCheckRequest(request.body);
      if (!parsed) return fail(400, 'Malformed wait request.');
      return ok({ results: await engine.waitCheck(parsed.waits) });
    }

    if (path === MENTIONS_SEARCH_PATH && method === 'POST') {
      const body = readJson(request.body);
      return ok({ items: await engine.mentionsSearch(str(body.query)) });
    }

    if (path === MENTIONS_RESOLVE_PATH && method === 'POST') {
      const body = readJson(request.body);
      return ok({ text: await engine.mentionsResolve(required(str(body.id), 'id')) });
    }

    if (path === '/status') {
      if (method === 'GET') return ok(await engine.status(q('directory') || null));
      if (method === 'POST') {
        const body = readJson(request.body);
        await engine.statusAction(required(str(body.id), 'id'));
        return ok({ ok: true });
      }
    }

    if (method === 'GET' && path === '/state') return ok(await engine.state(q('directory') || null));

    if (method === 'POST' && path === '/overview') {
      const body = readJson(request.body);
      if (!Array.isArray(body.projects)) throw new EngineError('projects must be a list.');
      const projects = body.projects
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({ id: str(entry.id), name: str(entry.name), directory: str(entry.directory) }))
        .filter((entry) => entry.directory.startsWith('/'))
        .slice(0, 200);
      const expanded = Array.isArray(body.expanded) ? body.expanded.map(str).filter(Boolean).slice(0, 200) : [];
      return ok(await engine.overview({ directory: str(body.directory) || null, projects, expanded }));
    }

    if (method === 'GET' && path === '/workflow-runs') {
      return ok(
        await engine.workflowRuns({
          repo: required(q('repo'), 'repo'),
          workflowId: required(q('workflow'), 'workflow'),
          branch: q('branch') || undefined,
          actor: q('actor') || undefined,
          page: Number(q('page')) || 1,
        }),
      );
    }

    if (path === '/repos') {
      const body = readJson(request.body);
      if (method === 'POST') {
        return ok({ repos: await engine.addRepo(required(str(body.repo), 'repo'), str(body.directory) || null) });
      }
      if (method === 'DELETE') return ok({ repos: await engine.removeRepo(required(str(body.repo) || q('repo'), 'repo')) });
    }

    if (method === 'GET' && path === '/run') {
      return ok(await engine.runDetail(required(q('repo'), 'repo'), required(q('id'), 'id')));
    }

    if (method === 'GET' && path === '/log') {
      return ok(await engine.log(required(q('repo'), 'repo'), required(q('job'), 'job'), q('full') === '1'));
    }

    if (method === 'POST' && path === '/action') {
      const body = readJson(request.body);
      // `rerun` is the name panels from before the provider registry send.
      const raw = str(body.kind);
      const kind = raw === 'rerun' ? 'rerun-all' : raw;
      if (kind !== 'rerun-all' && kind !== 'rerun-failed' && kind !== 'cancel' && kind !== 'approve' && kind !== 'decline')
        throw new EngineError('Unknown action.');
      await engine.runAction(kind, required(str(body.repo), 'repo'), required(str(body.runId), 'runId'));
      return ok({ ok: true });
    }

    if (method === 'GET' && path === '/workflows') return ok(await engine.workflows(required(q('repo'), 'repo')));

    if (method === 'GET' && path === '/dispatch-inputs') {
      return ok(
        await engine.dispatchInputs(required(q('repo'), 'repo'), required(q('workflow'), 'workflow'), required(q('ref'), 'ref')),
      );
    }

    if (method === 'POST' && path === '/dispatch') {
      const body = readJson(request.body);
      const raw = body.inputs && typeof body.inputs === 'object' ? (body.inputs as Record<string, unknown>) : {};
      const inputs = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, str(value)]));
      await engine.dispatch(required(str(body.repo), 'repo'), required(str(body.workflowId), 'workflowId'), str(body.ref), inputs);
      return ok({ ok: true });
    }

    if (method === 'GET' && path === '/handoff') {
      return ok(await engine.handoff(required(q('repo'), 'repo'), required(q('runId'), 'runId'), q('job') || null, q('mode') === 'fix' ? 'fix' : 'read'));
    }

    return fail(404, `No route for ${method} ${path}.`);
  } catch (err) {
    return toResponse(err);
  }
};
