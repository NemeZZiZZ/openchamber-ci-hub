// How the plugin reaches the CI Hub service. The host owns the port and the
// token; the service publishes both in ~/.openchamber-ci-hub/endpoint.json.
// Node builtins are imported dynamically: the plugin folder has no installed
// dependencies and the host must be able to load this file as-is.

export const readEndpoint = async (env = process.env) => {
  const { readFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const path = env.CI_HUB_ENDPOINT || `${homedir()}/.openchamber-ci-hub/endpoint.json`;
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error('CI Hub is not running. Open the CI Hub panel in OpenChamber once, then ask again.');
  }
  let endpoint;
  try {
    endpoint = JSON.parse(raw);
  } catch {
    endpoint = null;
  }
  if (!endpoint || typeof endpoint.port !== 'number' || typeof endpoint.token !== 'string') {
    throw new Error('The CI Hub endpoint file is unreadable. Reopen the CI Hub panel in OpenChamber to rewrite it.');
  }
  return endpoint;
};

export const callService = async (endpoint, method, path, query = {}, body) => {
  const url = new URL(`http://127.0.0.1:${endpoint.port}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${endpoint.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
    if (!response.ok) {
      throw new Error(data.message || data.error || `CI Hub answered HTTP ${response.status}.`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};
