// CI Hub's OpenCode plugin: four small tools over the CI Hub service. The
// service holds the CI tokens; this file only knows the endpoint file.
//
// Answers are compact JSON text, never a dump: ci_failing_log is capped at
// 12 000 characters by the service.

import { callService, readEndpoint } from './service.js';

export default {
  id: 'ci-hub',
  async setup() {
    let healthy = false;
    const ask = async (method, path, query, body) => {
      const endpoint = await readEndpoint();
      if (!healthy) {
        await callService(endpoint, 'GET', '/health');
        healthy = true;
      }
      try {
        return await callService(endpoint, method, path, query, body);
      } catch (err) {
        healthy = false; // the service may have restarted with a new token
        throw err;
      }
    };
    const respond = async (fn) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await fn()) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `CI Hub: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    };
    const repo = {
      type: 'string',
      description:
        'Repository key: provider:host/owner/name, for example github:github.com/acme/app. Omit it when directory is given.',
    };
    const runId = { type: 'string', description: 'Provider run id (the id field of a run, not its #number).' };

    return {
      tool: {
        ci_list_runs: {
          description:
            'CI Hub: list recent CI runs. Pass directory (a project folder) or repo (provider:host/owner/name), optionally a branch and a limit (default 10, max 20).',
          input: {
            type: 'object',
            properties: {
              directory: { type: 'string', description: 'Project folder on disk; CI Hub resolves its git remote.' },
              repo,
              branch: { type: 'string' },
              limit: { type: 'number' },
            },
          },
          execute: (args) =>
            respond(() => ask('GET', '/agent/runs', { directory: args.directory, repo: args.repo, branch: args.branch, limit: args.limit })),
        },
        ci_run_detail: {
          description:
            'CI Hub: one CI run with its jobs and the failing step of each job. Needs repo (provider:host/owner/name) and runId.',
          input: { type: 'object', properties: { repo, runId }, required: ['repo', 'runId'] },
          execute: (args) => respond(() => ask('GET', '/agent/run', { repo: args.repo, id: args.runId })),
        },
        ci_failing_log: {
          description:
            'CI Hub: the error excerpt of a CI run log, capped at 12 000 characters. Picks the first failed job unless jobId is given. Use this before reading any full log.',
          input: {
            type: 'object',
            properties: { repo, runId, jobId: { type: 'string', description: 'Optional job id from ci_run_detail.' } },
            required: ['repo', 'runId'],
          },
          execute: (args) => respond(() => ask('GET', '/agent/log', { repo: args.repo, id: args.runId, job: args.jobId })),
        },
        ci_rerun: {
          description:
            'CI Hub: re-run the failed jobs of a CI run. Use after pushing a fix. Needs repo (provider:host/owner/name) and runId.',
          input: { type: 'object', properties: { repo, runId }, required: ['repo', 'runId'] },
          execute: (args) =>
            respond(async () => {
              const result = await ask('POST', '/action', {}, { kind: 'rerun-failed', repo: args.repo, runId: args.runId });
              return { ...result, repo: args.repo, runId: args.runId, hint: 'Re-run requested. Check the run again with ci_run_detail in a minute.' };
            }),
        },
      },
    };
  },
};
