// "Run a workflow": pick a workflow and ref, fill its inputs, start it.

import { mountCheckbox, mountSelect, mountSpinner, mountTextField } from '@openchamber/sdk/ui';
import { repoName } from '../../domain/repoKey.ts';
import type { DispatchInput, WorkflowRef } from '../../domain/types.ts';
import { clear, h, slot } from '../dom.ts';
import { errorText } from '../port.ts';
import { projectKey, SCOPE_ALL, SCOPE_MINE, scopeBranches, workflowKey } from '../treeModel.ts';
import { viewFor } from './providers.ts';
import { button, debounce, note, type App } from './state.ts';

/** One key/value pair of the variables editor. */
export interface VariableRow {
  key: string;
  value: string;
}

/** The DispatchInput `variables` value is a JSON object string; rows are its editor view. */
export const parseVariablesField = (value: string): VariableRow[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => ({ key, value }));
};

/** Rows back into the field's JSON form; an empty key is a fresh draft row
 * and stays, so it survives a re-render. Providers strip it before sending. */
export const serializeVariablesField = (rows: VariableRow[]): string => {
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  const json = JSON.stringify(out);
  return json === '{}' ? '' : json;
};

export const openDispatch = (app: App, target: string) => {
  const s = app.s;
  const owner = app.repoView(target);
  const mine = owner ? scopeBranches(owner, SCOPE_MINE) ?? [] : [];
  s.dispatchRepo = target;
  s.dispatch = {
    loading: true,
    error: null,
    workflows: [],
    workflowId: null,
    ref: (target === s.overview?.current && owner?.currentBranch) || mine[0] || '',
    inputsLoading: false,
    dispatchable: null,
    refusal: null,
    inputs: [],
    values: {},
    submitting: false,
  };
  app.show({ kind: 'dispatch' });
  const forRepo = target;
  void app
    .svc<{ workflows: WorkflowRef[]; defaultBranch: string }>({ path: '/workflows', query: { repo: forRepo } })
    .then((data) => {
      if (!s.dispatch || s.dispatchRepo !== forRepo) return;
      s.dispatch.workflows = data.workflows;
      if (!s.dispatch.ref) s.dispatch.ref = data.defaultBranch;
      s.dispatch.loading = false;
      app.renderSide();
    })
    .catch((err: unknown) => {
      if (!s.dispatch) return;
      s.dispatch.loading = false;
      s.dispatch.error = errorText(err);
      app.renderSide();
    });
};

let inputsSeq = 0;
const loadInputs = async (app: App) => {
  const s = app.s;
  const current = s.dispatch;
  const repo = s.dispatchRepo;
  if (!current || !current.workflowId || !repo || !current.ref.trim()) return;
  const seq = ++inputsSeq;
  current.inputsLoading = true;
  app.renderSide();
  try {
    const data = await app.svc<{ dispatchable: boolean; inputs: DispatchInput[]; refusal: string | null }>({
      path: '/dispatch-inputs',
      query: { repo, workflow: current.workflowId, ref: current.ref.trim() },
    });
    if (seq !== inputsSeq || s.dispatch !== current) return;
    current.dispatchable = data.dispatchable;
    current.refusal = data.refusal ?? null;
    current.inputs = data.inputs;
    const values: Record<string, string> = {};
    for (const input of data.inputs) values[input.name] = current.values[input.name] ?? input.default ?? (input.type === 'boolean' ? 'false' : '');
    current.values = values;
    current.error = null;
  } catch (err) {
    if (seq !== inputsSeq || s.dispatch !== current) return;
    current.error = errorText(err);
    current.dispatchable = null;
  }
  current.inputsLoading = false;
  app.renderSide();
};

const inputsLater = debounce(600, (app: App) => void loadInputs(app));

export const renderDispatch = (app: App) => {
  const { side, s } = app;
  const current = s.dispatch;
  const back = h(
    'div',
    { class: 'cih-bar' },
    button(side, { label: s.wide ? 'Close' : '← Runs', variant: 'ghost', size: 'sm', onClick: () => app.show({ kind: 'list' }) }),
    h('span', { class: 'cih-title cih-bar-grow', text: 'Run a workflow' }),
  );
  side.el.append(back);
  const repo = s.dispatchRepo;
  if (!current || !repo) return;
  const form = h('div', { class: 'cih-form' });
  side.el.append(form);
  form.append(h('div', { class: 'cih-muted cih-small', text: `On ${repoName(repo)}. ${viewFor(app, repo).words.dispatchHelp}`.trim() }));
  if (current.loading) {
    const at = slot();
    side.keep(mountSpinner(at, { size: 'sm', label: 'Loading workflows…' }));
    form.append(at);
    return;
  }
  if (current.error) note(side, 'error', current.error, [{ label: 'Try again', onClick: () => (current.workflowId ? void loadInputs(app) : s.dispatchRepo && app.openDispatch(s.dispatchRepo)) }]);
  if (current.workflows.length === 0 && !current.error) {
    form.append(h('div', { class: 'cih-muted', text: 'This repository has no active workflows.' }));
    return;
  }
  const wfAt = slot();
  side.keep(
    mountSelect(wfAt, {
      label: 'Workflow',
      value: current.workflowId,
      placeholder: 'Choose a workflow',
      searchable: current.workflows.length > 8,
      options: current.workflows.map((wf) => ({ id: wf.id, label: wf.name, hint: wf.file })),
      onChange: (id) => {
        current.workflowId = id;
        current.dispatchable = null;
        current.inputs = [];
        app.renderSide();
        void loadInputs(app);
      },
    }),
  );
  form.append(wfAt);
  const refAt = slot();
  side.keep(
    mountTextField(refAt, {
      label: 'Branch or tag',
      value: current.ref,
      mono: true,
      onChange: (value) => {
        current.ref = value;
        inputsLater(app);
      },
    }),
  );
  form.append(refAt);

  if (current.inputsLoading) {
    const at = slot();
    side.keep(mountSpinner(at, { size: 'sm', label: 'Reading the workflow…' }));
    form.append(at);
    return;
  }
  if (!current.workflowId) return;
  if (current.dispatchable === false) {
    form.append(h('div', { class: 'cih-note', 'data-tone': 'warning', text: current.refusal ?? `This ${viewFor(app, repo).words.workflow} cannot be started on ${current.ref}.` }));
  }
  for (const input of current.inputs) {
    const at = slot();
    const label = `${input.name}${input.required ? ' *' : ''}`;
    const value = current.values[input.name] ?? '';
    if (input.type === 'boolean') {
      side.keep(
        mountCheckbox(at, {
          label,
          checked: value === 'true',
          description: input.description || undefined,
          onChange: (checked) => {
            current.values[input.name] = checked ? 'true' : 'false';
            app.renderSide();
          },
        }),
      );
    } else if (input.type === 'choice' && input.options.length > 0) {
      side.keep(
        mountSelect(at, {
          label,
          value: value || null,
          placeholder: input.description || 'Choose',
          options: input.options.map((option) => ({ id: option, label: option })),
          onChange: (id) => {
            current.values[input.name] = id;
            app.renderSide();
          },
        }),
      );
    } else if (input.type === 'variables') {
      const at = slot();
      let rows = parseVariablesField(value);
      const handles: { dispose(): void }[] = [];
      const commit = () => {
        current.values[input.name] = serializeVariablesField(rows);
      };
      const rowsEl = h('div');
      const drawRows = () => {
        for (const handle of handles) handle.dispose();
        handles.length = 0;
        clear(rowsEl);
        rows.forEach((row, index) => {
          const keyAt = slot();
          const valueAt = slot();
          handles.push(
            mountTextField(keyAt, {
                value: row.key,
                placeholder: 'KEY',
                onChange: (next) => {
                  rows[index] = { key: next, value: rows[index]!.value };
                  commit();
                },
              }),
          );
          handles.push(
            mountTextField(valueAt, {
                value: row.value,
                placeholder: 'value',
                onChange: (next) => {
                  rows[index] = { key: rows[index]!.key, value: next };
                  commit();
                },
              }),
          );
          const remove = h('button', {
            class: 'cih-link',
            type: 'button',
            text: '✕',
            'aria-label': `Remove ${row.key || 'variable'}`,
            onclick: () => {
              rows.splice(index, 1);
              commit();
              app.renderSide();
            },
          });
          rowsEl.append(h('div', { style: 'display: flex; gap: 6px; align-items: center;' }, keyAt, valueAt, remove));
        });
      };
      drawRows();
      side.keep({
        dispose: () => {
          for (const handle of handles) handle.dispose();
        },
      });
      const add = h('button', {
        class: 'cih-link',
        type: 'button',
        text: '+ Variable',
        onclick: () => {
          rows = [...rows, { key: '', value: '' }];
          commit();
          app.renderSide();
        },
      });
      at.append(h('div', { class: 'cih-field', text: label }, input.description ? h('div', { class: 'cih-muted cih-small', text: input.description }) : null), rowsEl, add);
      form.append(at);
    } else {
      side.keep(
        mountTextField(at, {
          label,
          value,
          helper: input.description || undefined,
          placeholder: input.type === 'environment' ? 'environment name' : undefined,
          onChange: (next) => {
            current.values[input.name] = next;
          },
        }),
      );
    }
    form.append(at);
  }
  const workflow = current.workflows.find((wf) => wf.id === current.workflowId);
  form.append(
    h(
      'div',
      { class: 'cih-actions' },
      button(side, {
        label: 'Run workflow',
        loading: current.submitting,
        disabled: current.dispatchable === false || !current.ref.trim(),
        onClick: () => {
          const missing = current.inputs.filter((input) => input.required && !(current.values[input.name] ?? '').trim());
          if (missing.length > 0) {
            app.toast('error', `Fill in ${missing.map((input) => input.name).join(', ')} first.`);
            return;
          }
          const name = workflow?.name ?? 'this workflow';
          const ref = current.ref.trim();
          app.ask({
            message: `Start ${name} on ${ref}? This uses runner minutes.`,
            label: 'Run it',
            destructive: false,
            work: async () => {
              current.submitting = true;
              app.renderSide();
              try {
                await app.svc({ method: 'POST', path: '/dispatch', body: { repo, workflowId: current.workflowId, ref, inputs: current.values } });
                app.toast('success', `Started ${name} on ${ref}. It shows up in the list in a few seconds.`);
                s.dispatch = null;
                s.filter = 'all';
                if (s.scope !== SCOPE_ALL) app.resetHistory();
                s.scope = SCOPE_ALL;
                s.expanded.add(projectKey(repo));
                if (current.workflowId) s.expanded.add(workflowKey(repo, current.workflowId));
                app.syncBar();
                app.show({ kind: 'list' });
                await app.loadOverview(true);
              } finally {
                current.submitting = false;
                if (s.view.kind === 'dispatch') app.renderSide();
              }
            },
          });
        },
      }),
    ),
  );
};
