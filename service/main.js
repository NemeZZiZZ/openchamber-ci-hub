// service/main.ts
import { execFile } from "node:child_process";
import { readFile as readFile2 } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = new WeakMap;
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== undefined)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1000));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;
// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);
// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_IDLE_MS = 10 * 60000;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_HOST_TIMEOUT_MS = 30000;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 60000;
var MENTIONS_SEARCH_PATH = "/mentions/search";
var MENTIONS_RESOLVE_PATH = "/mentions/resolve";
var MENTIONS_IDLE_MS = 10 * 60000;
class ServiceHostError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServiceHostError";
    this.code = code;
    this.status = status;
  }
}
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base || !token)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.result !== undefined)
      return body.result;
    throw new ServiceHostError(body?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message) => call("sessions.answerForm", { sessionId, formId, values, ...message === undefined ? {} : { message } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings }) => settings),
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message }),
    setMark: (target, mark) => call("marks.set", { target, mark })
  };
};
// node_modules/@openchamber/sdk/dist/waits.js
var WAITS_START_PATH = "/waits/start";
var WAITS_CHECK_PATH = "/waits/check";
var WAITS_WIRE_VERSION = 1;
var parseBody = (body) => {
  try {
    const parsed = JSON.parse(body);
    return Object(parsed) === parsed && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
var argsOf = (wire) => {
  if (Object(wire) !== wire || wire === undefined || Array.isArray(wire))
    return null;
  const args = {};
  for (const [name, entry] of Object.entries(wire)) {
    if (String(entry) !== entry && !Number.isFinite(entry) && entry !== true && entry !== false)
      return null;
    args[name] = entry;
  }
  return args;
};
var readWaitStartRequest = (body) => {
  const wire = parseBody(body);
  if (!wire || wire.v !== WAITS_WIRE_VERSION)
    return null;
  const { requestId, wait } = wire;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (Object(wait) !== wait || wait === undefined)
    return null;
  const { id, type, session } = wait;
  if (String(id) !== id || id.length === 0 || String(type) !== type || type.length === 0)
    return null;
  const args = argsOf(wait.args);
  if (!args)
    return null;
  if (Object(session) !== session || session === undefined)
    return null;
  const sessionId = session.id;
  if (String(sessionId) !== sessionId || sessionId.length === 0)
    return null;
  const directory = session.directory;
  if (directory !== null && (String(directory) !== directory || directory.length === 0))
    return null;
  return { v: WAITS_WIRE_VERSION, requestId, wait: { id, type, args, session: { id: sessionId, directory } } };
};
var readWaitCheckRequest = (body) => {
  const wire = parseBody(body);
  if (!wire || wire.v !== WAITS_WIRE_VERSION)
    return null;
  const { requestId } = wire;
  if (String(requestId) !== requestId || requestId.length === 0 || !Array.isArray(wire.waits))
    return null;
  const waits = [];
  for (const entry of wire.waits) {
    if (Object(entry) !== entry || entry.state === undefined)
      return null;
    const { id, type, state } = entry;
    if (String(id) !== id || id.length === 0 || String(type) !== type || type.length === 0)
      return null;
    const args = argsOf(entry.args);
    if (!args)
      return null;
    waits.push({ id, type, args, state });
  }
  return { v: WAITS_WIRE_VERSION, requestId, waits };
};
// node_modules/@openchamber/sdk/dist/file-editor.js
var patternExpressions = new Map;
// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 60000;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
var HOST_PUSH_TYPES = new Set([
  "workspace",
  "shells",
  "ready",
  "directory",
  "session",
  "connection",
  "settings",
  "session-lifecycle",
  "item",
  "resolve",
  "action",
  "service-event",
  "status-control-event",
  "popover-closed",
  "file-open",
  "file-snapshot",
  "file-saved",
  "generate-late"
]);
// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 60000;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 60000;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 60000;
var TRACKER_PROVIDER_IDLE_MS = 10 * 60000;
var QUOTA_PROVIDER_IDLE_MS = 10 * 60000;
// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);
// src/service/configStore.ts
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

// src/domain/types.ts
var PROVIDER_IDS = ["github", "gitlab", "gitea", "forgejo", "woodpecker", "bitbucket"];
var EMPTY_CONFIG = { version: 2, repos: [], directoryMap: {} };

// src/domain/repoKey.ts
var HOST = /^[a-z0-9.-]+(:\d+)?$/;
var SEGMENT = /^(?!\.\.?$)[\w.-]+$/;
var isProvider = (value) => PROVIDER_IDS.includes(value);
var formatRepoKey = (ref) => `${ref.provider}:${ref.host.toLowerCase()}/${ref.path}`;
var parseRepoKey = (key) => {
  const colon = key.indexOf(":");
  if (colon <= 0)
    return null;
  const provider = key.slice(0, colon);
  if (!isProvider(provider))
    return null;
  const rest = key.slice(colon + 1);
  const slash = rest.indexOf("/");
  if (slash <= 0)
    return null;
  const host = rest.slice(0, slash).toLowerCase();
  const path = rest.slice(slash + 1);
  if (!HOST.test(host))
    return null;
  const segments = path.split("/");
  if (segments.length < 2 || !segments.every((segment) => SEGMENT.test(segment)))
    return null;
  return { provider, host, path };
};
var repoKeyId = (key) => key.toLowerCase();
var pathOf = (key) => parseRepoKey(key)?.path ?? key;
var repoName = (key) => pathOf(key);
var repoLabel = (key) => {
  const segments = pathOf(key).split("/");
  return segments[segments.length - 1] || key;
};
var hostOf = (url) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};
var webHostForApi = (apiOrigin) => {
  const host = hostOf(apiOrigin) ?? "api.github.com";
  return host === "api.github.com" ? "github.com" : host;
};
var LEGACY_NAME = /^[A-Za-z0-9-]+\/(?!\.\.?$)[\w.-]+$/;
var legacyRepoKey = (fullName, apiOrigin) => {
  if (!LEGACY_NAME.test(fullName))
    return null;
  return formatRepoKey({ provider: "github", host: webHostForApi(apiOrigin ?? "https://api.github.com"), path: fullName });
};

// src/service/configStore.ts
var asRecord = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
var keyOf = (version, value, apiOrigin) => {
  if (typeof value !== "string")
    return null;
  if (version === 2)
    return parseRepoKey(value) ? value : null;
  return legacyRepoKey(value, typeof apiOrigin === "string" ? apiOrigin : undefined);
};
var parseConfig = (raw) => {
  if (!raw)
    return structuredClone(EMPTY_CONFIG);
  try {
    const value = asRecord(JSON.parse(raw));
    if (!value)
      return structuredClone(EMPTY_CONFIG);
    const version = value.version === undefined ? 1 : value.version;
    if (version !== 1 && version !== 2)
      return structuredClone(EMPTY_CONFIG);
    const repos = [];
    const seen = new Set;
    for (const item of Array.isArray(value.repos) ? value.repos : []) {
      const repo = asRecord(item);
      if (!repo)
        continue;
      const key = version === 1 ? keyOf(1, repo.fullName, repo.apiOrigin) : keyOf(2, repo.key);
      if (!key || seen.has(repoKeyId(key)))
        continue;
      seen.add(repoKeyId(key));
      repos.push({
        key,
        ...typeof repo.directory === "string" ? { directory: repo.directory } : {},
        enabled: repo.enabled !== false,
        addedAt: typeof repo.addedAt === "number" ? repo.addedAt : 0
      });
    }
    const directoryMap = {};
    for (const [dir, name] of Object.entries(asRecord(value.directoryMap) ?? {})) {
      const origin = version === 1 && typeof name === "string" ? (Array.isArray(value.repos) ? value.repos : []).map(asRecord).find((repo) => repo && typeof repo.fullName === "string" && repo.fullName.toLowerCase() === name.toLowerCase())?.apiOrigin : undefined;
      const key = keyOf(version, name, origin);
      if (key)
        directoryMap[dir] = key;
    }
    return { version: 2, repos, directoryMap };
  } catch {
    return structuredClone(EMPTY_CONFIG);
  }
};
var createFileConfigStore = (dir) => {
  const path = join(dir, "config.json");
  let cached = null;
  return {
    async load() {
      if (cached)
        return structuredClone(cached);
      const raw = await readFile(path, "utf8").catch(() => {
        return;
      });
      cached = parseConfig(raw);
      return structuredClone(cached);
    },
    async save(config) {
      await mkdir(dir, { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(config, null, 2)}
`, { mode: 384 });
      await rename(tmp, path);
      cached = structuredClone(config);
    }
  };
};
var AUDIT_MAX_BYTES = 512 * 1024;
var createFileAudit = (dir) => async (entry) => {
  const path = join(dir, "actions.log");
  try {
    await mkdir(dir, { recursive: true });
    const size = await stat(path).then((info) => info.size, () => 0);
    if (size > AUDIT_MAX_BYTES)
      await rename(path, `${path}.1`).catch(() => {
        return;
      });
    await appendFile(path, `${JSON.stringify(entry)}
`, { mode: 384 });
  } catch {}
};

// src/domain/format.ts
var formatDuration = (ms) => {
  if (!Number.isFinite(ms) || ms < 0)
    return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  if (h > 0)
    return `${h}h ${m}m`;
  if (m > 0)
    return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
};
var formatAgo = (at, now = Date.now()) => {
  if (at === null)
    return "—";
  const diff = Math.max(0, now - at);
  const min = Math.floor(diff / 60000);
  if (min < 1)
    return "just now";
  if (min < 60)
    return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24)
    return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};
var runDuration = (run, now = Date.now()) => {
  const start = run.startedAt ?? run.createdAt;
  const end = run.finishedAt ?? (run.status === "completed" ? null : now);
  if (start === null || end === null)
    return null;
  return Math.max(0, end - start);
};
var conclusionLabel = (conclusion, status) => {
  if (status === "in_progress")
    return "in progress";
  if (status === "queued" || status === "waiting" || status === "pending")
    return "queued";
  switch (conclusion) {
    case null:
      return status === "completed" ? "completed" : "unknown";
    case "success":
      return "succeeded";
    case "failure":
      return "failed";
    case "timed_out":
      return "timed out";
    case "action_required":
      return "needs action";
    case "startup_failure":
      return "startup failed";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "skipped";
    default:
      return conclusion.replace(/_/g, " ");
  }
};
var isFailedConclusion = (conclusion) => conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure";
var isFailed = (run) => isFailedConclusion(run.conclusion);
var isActive = (run) => run.status !== "completed";
var parseRemote = (remote) => {
  const value = remote.trim();
  if (value === "")
    return null;
  let host = "";
  let path = "";
  let ssh = true;
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/.exec(value);
  if (scp && !value.includes("://")) {
    host = scp[1];
    path = scp[2];
  } else {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol === "http:" || url.protocol === "https:") {
      ssh = false;
      host = url.host;
    } else if (url.protocol === "ssh:" || url.protocol === "git:" || url.protocol === "git+ssh:") {
      host = url.hostname;
    } else {
      return null;
    }
    path = url.pathname;
  }
  host = host.toLowerCase();
  if (host === "")
    return null;
  const segments = path.replace(/\.git\/*$/, "").split("/").filter(Boolean);
  if (segments.length === 0)
    return null;
  return { host, segments, ssh };
};
var remoteIdentity = (remote) => {
  const parts = parseRemote(remote);
  if (!parts)
    return null;
  const host = parts.host.split(":")[0] ?? parts.host;
  return `${host}/${parts.segments.map((segment) => segment.toLowerCase()).join("/")}`;
};

// src/domain/log.ts
var TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/;
var ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
var ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
var LINE_END = /\r?\n/;
var stripTimestamp = (line) => line.replace(TIMESTAMP, "");
var stripAnsi = (text) => text.replace(ANSI_OSC, "").replace(ANSI_CSI, "");
var encoder = new TextEncoder;
var decoder = new TextDecoder;
var byteLength = (text) => encoder.encode(text).length;
var sliceByBytes = (text, start, end) => {
  const bytes = encoder.encode(text);
  let stop = Math.min(Math.max(end, 0), bytes.length);
  while (stop > 0 && stop < bytes.length && (bytes[stop] & 192) === 128)
    stop -= 1;
  let from = Math.min(Math.max(start, 0), stop);
  while (from > 0 && (bytes[from] & 192) === 128)
    from -= 1;
  return decoder.decode(bytes.subarray(from, stop));
};
var traceLines = (raw) => {
  const lines = raw.split(LINE_END);
  if (lines.length > 1 && lines.at(-1) === "")
    lines.pop();
  return lines;
};
var SECTION_START = /^section_start:\d+:([^[\r\s]+)(?:\[[^\]]*\])?\r?(.*)$/;
var SECTION_END = /^section_end:\d+:[^\r]*\r?(.*)$/;
var lastFrame = (line) => {
  const frames = line.split("\r");
  for (let i = frames.length - 1;i >= 0; i -= 1)
    if (frames[i].trim() !== "")
      return frames[i];
  return "";
};
var gitlabTone = (text) => {
  if (/^(?:ERROR|error):/.test(text))
    return "error";
  if (/^WARNING:/.test(text))
    return "warning";
  if (/^\$ /.test(text))
    return "command";
  return "normal";
};
var parseGitLab = (raw) => {
  const out = [];
  const open = [];
  const take = (line) => {
    const start = SECTION_START.exec(line);
    if (start) {
      const header = lastFrame(start[2]).trim() || start[1];
      out.push({ text: header, depth: Math.min(1, open.length), group: open.at(-1) ?? null, tone: "group" });
      open.push(header);
      return;
    }
    const end = SECTION_END.exec(line);
    if (end) {
      open.pop();
      if (end[1].trim() !== "")
        take(end[1]);
      return;
    }
    const text = lastFrame(line);
    out.push({ text, depth: Math.min(1, open.length), group: open.at(-1) ?? null, tone: gitlabTone(text) });
  };
  for (const line of traceLines(raw))
    take(stripAnsi(line));
  return out;
};
var ERROR_PATTERNS = [
  /##\[error\]/,
  /::error/,
  /\berror\b/i,
  /\bfailed\b/i,
  /\bfailure\b/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /\bexit code\b/i,
  /\bnpm ERR!/,
  /\bELIFECYCLE\b/,
  /\bcannot find\b/i,
  /\bnot found\b/i,
  /\bpanic:/,
  /\bsegmentation fault\b/i
];
var looksLikeError = (line) => ERROR_PATTERNS.some((re) => re.test(line));
var GENERIC_EXIT = {
  github: /Process completed with exit code/,
  gitlab: /^ERROR: Job failed: exit code/,
  plain: /Process completed with exit code|^ERROR: Job failed: exit code/
};
var excerptLines = (raw, dialect) => {
  if (dialect === "gitlab")
    return parseGitLab(raw).map((line) => line.text);
  if (dialect === "plain")
    return raw.split(LINE_END);
  return raw.split(LINE_END).map(stripTimestamp);
};
var errorExcerpt = (raw, options, dialect = "github") => {
  const maxLines = options?.maxLines ?? 120;
  const context = options?.context ?? 12;
  const lines = excerptLines(raw, dialect);
  const cap = (picked) => picked.length > maxLines ? { lines: picked.slice(0, maxLines), truncated: true } : { lines: picked, truncated: false };
  const maxBytes = options?.maxBytes ?? 8 * 1024;
  const generic = (line) => GENERIC_EXIT[dialect].test(line);
  let first = lines.findIndex((line) => line.trim() !== "" && looksLikeError(line) && !generic(line));
  if (first === -1)
    first = lines.findIndex((line) => looksLikeError(line) && line.trim() !== "");
  if (first === -1) {
    return capBytes(cap(lines.slice(-Math.min(maxLines, lines.length))), maxBytes);
  }
  const start = Math.max(0, first - context);
  const taken = lines.slice(start, Math.min(lines.length, first + maxLines - context));
  const head = start > 0 ? [`… ${start} earlier lines omitted …`, ...taken] : taken;
  return capBytes({ lines: head, truncated: start > 0 || taken.length < lines.length - start }, maxBytes);
};
var capBytes = (excerpt, maxBytes) => {
  let size = 0;
  const kept = [];
  for (const line of excerpt.lines) {
    size += line.length + 1;
    if (size > maxBytes)
      return { lines: kept, truncated: true };
    kept.push(line);
  }
  return excerpt;
};

// src/domain/handoff.ts
var failedJobs = (jobs) => jobs.filter((job) => isFailedConclusion(job.conclusion));
var focusJob = (jobs) => failedJobs(jobs)[0] ?? jobs.find((job) => job.status !== "completed") ?? jobs[0] ?? null;
var failingStep = (job) => job.steps.find((step) => step.conclusion === "failure" || step.conclusion === "timed_out") ?? null;
var handoffTitle = (run, job) => {
  const what = job?.name ?? run.workflow;
  const verdict = isFailed(run) || job && failedJobs([job]).length > 0 ? "failed" : run.conclusion ?? run.status;
  return `#${run.number} ${what} ${verdict}`.slice(0, 200);
};
var TEXT_LIMIT = 15000;
var buildHandoff = ({ run, jobs, job, log, logTruncated }) => {
  const step = job ? failingStep(job) : null;
  const duration = runDuration(run);
  const ref = parseRepoKey(run.repo);
  const lines = [
    `CI run ${run.workflow} #${run.number} on ${repoName(run.repo)} ${run.conclusion ?? run.status}.`,
    "",
    `- Repository: ${ref ? `${ref.host}/${ref.path}` : run.repo}`,
    `- Run: ${run.url}`,
    `- Workflow: ${run.workflow}`,
    `- Branch: ${run.branch || "—"} @ ${run.sha.slice(0, 12)}`,
    `- Commit: ${run.title || "—"}`,
    `- Event: ${run.event}, attempt ${run.attempt}${duration !== null ? `, ${formatDuration(duration)}` : ""}`
  ];
  const failed = failedJobs(jobs);
  if (failed.length > 0) {
    lines.push(`- Failed jobs: ${failed.map((item) => item.name).join(", ")}`);
  }
  if (job) {
    lines.push(`- Job: ${job.name}${job.url ? ` (${job.url})` : ""}`);
    if (step)
      lines.push(`- Failing step: ${step.number}. ${step.name}`);
  }
  if (log !== null && log.trim() !== "") {
    const excerpt = errorExcerpt(log, { maxLines: 120, context: 20, maxBytes: 8 * 1024 });
    lines.push("", `Log excerpt${logTruncated || excerpt.truncated ? " (partial)" : ""}:`, "```", ...excerpt.lines.map((line) => line.replace(/```/g, "'''")), "```");
  } else if (job) {
    lines.push("", "The job log could not be read.");
  }
  let text = lines.join(`
`);
  if (text.length > TEXT_LIMIT)
    text = `${text.slice(0, TEXT_LIMIT - 4)}
…`;
  return { title: handoffTitle(run, job), text, url: run.url };
};

// src/domain/statusView.ts
var slug = (text) => {
  let hash = 2166136261;
  for (let i = 0;i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
};
var runPart = (runId) => /^[a-z0-9-]{1,16}$/.test(runId) ? runId : slug(runId);
var statusActionId = (kind, repo = "", runId = "") => kind === "refresh" ? "refresh" : `${kind}-${slug(repo)}-${runPart(runId)}`;
var readStatusActionId = (id, resolveRepo = (input) => parseRepoKey(input) ? input : legacyRepoKey(input)) => {
  if (id === "refresh")
    return { kind: "refresh" };
  const match = /^rerun-failed:(.+):(\d+)$/.exec(id);
  if (!match)
    return null;
  const repo = resolveRepo(match[1]);
  return repo ? { kind: "rerun-failed", repo, runId: match[2] } : null;
};
var clip = (text, max) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
var latestPerWorkflow = (runs) => {
  const seen = new Set;
  const out = [];
  for (const run of [...runs].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = `${run.workflowId || run.workflow}\x00${run.branch}`;
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(run);
  }
  return out;
};
var buildStatusView = (input) => {
  const rows = [];
  const actions = new Map;
  if (input.authProblem) {
    rows.push({ kind: "note", id: "auth", text: clip(input.authProblem, 300), tone: "warning" });
    return { view: { rows }, actions };
  }
  if (input.repos.length === 0) {
    rows.push({
      kind: "note",
      id: "empty",
      text: input.noRepoText,
      tone: "muted"
    });
    return { view: { rows }, actions };
  }
  const multi = input.repos.length > 1;
  for (const repo of input.repos.slice(0, 4)) {
    const active = repo.runs.filter(isActive);
    const latest = latestPerWorkflow(repo.runs.filter((run) => !isActive(run)));
    const broken = latest.filter(isFailed);
    const prefix = multi ? `${repoLabel(repo.key)}: ` : "";
    if (repo.error && repo.runs.length === 0) {
      rows.push({ kind: "note", id: `error-${slug(repo.key)}`, text: clip(`${prefix}${repo.error}`, 300), tone: "error" });
      continue;
    }
    const chips = [
      ...active.length > 0 ? [{ id: "building", label: `${active.length} building`, tone: "info" }] : [],
      ...broken.length > 0 ? [{ id: "failed", label: `${broken.length} failed`, tone: "error" }] : []
    ];
    rows.push({
      kind: "line",
      id: multi ? `summary-${slug(repo.key)}` : "summary",
      label: clip(repoLabel(repo.key), 40),
      icon: "git-branch-line",
      dot: broken.length > 0 ? "error" : active.length > 0 ? "info" : "success",
      content: chips.length > 0 ? { kind: "chips", chips } : undefined,
      value: repo.polledAt ? formatAgo(repo.polledAt, input.now) : "…",
      valueTone: "muted",
      tooltip: repo.error ? clip(repo.error, 200) : `Checked ${formatAgo(repo.polledAt, input.now)}`
    });
    const failing = broken.slice(0, 3);
    for (const run of failing) {
      rows.push({
        kind: "line",
        id: `failed-${slug(run.repo)}-${runPart(run.id)}`,
        label: clip(`${prefix}${run.workflow} #${run.number}`, 60),
        dot: "error",
        content: {
          kind: "chips",
          chips: [{ id: "open", label: "Open run", tone: "error", url: run.url }]
        },
        tooltip: clip(`${run.workflow} ${conclusionLabel(run.conclusion, run.status)} on ${run.branch}, ${formatAgo(run.finishedAt ?? run.createdAt, input.now)}: ${run.title}`, 200),
        actions: [
          {
            kind: "button",
            id: statusActionId("rerun-failed", run.repo, run.id),
            label: "Re-run failed",
            variant: "outline",
            confirm: "Re-run the failed jobs?"
          }
        ]
      });
      actions.set(statusActionId("rerun-failed", run.repo, run.id), { repo: run.repo, runId: run.id });
    }
    for (const run of active.slice(0, Math.max(1, 3 - failing.length))) {
      const elapsed = runDuration(run, input.now);
      rows.push({
        kind: "line",
        id: `active-${slug(run.repo)}-${runPart(run.id)}`,
        label: clip(`${prefix}${run.workflow} #${run.number}`, 60),
        dot: "info",
        content: { kind: "text", text: clip(`${run.branch || "—"} · ${conclusionLabel(run.conclusion, run.status)}`, 200), tone: "muted" },
        ...elapsed !== null ? { value: formatDuration(elapsed), valueTone: "muted" } : {}
      });
    }
  }
  if (input.blocked && input.blocked.until > input.now) {
    rows.push({
      kind: "note",
      id: "rate-limit",
      text: `${input.blocked.label} rate limit reached; checking again in ${formatDuration(input.blocked.until - input.now)}.`,
      tone: "info"
    });
  }
  return { view: { rows: rows.slice(0, 16) }, actions };
};

// src/domain/waits.ts
var keyOrLegacy = (input) => parseRepoKey(input) ? input : legacyRepoKey(input);
var readWaitArgs = async (params, parseRunUrl, resolveRepo = keyOrLegacy) => {
  const args = params && typeof params === "object" ? params : {};
  const rawRepo = typeof args.repo === "string" ? args.repo.trim() : "";
  const rawRun = typeof args.runId === "string" ? args.runId.trim() : typeof args.runId === "number" ? String(args.runId) : "";
  const conclusion = typeof args.conclusion === "string" && args.conclusion.trim() ? args.conclusion.trim().toLowerCase() : null;
  const fromUrl = await parseRunUrl(rawRun) ?? await parseRunUrl(rawRepo);
  if (fromUrl)
    return { repo: fromUrl.repo, runId: fromUrl.runId, conclusion };
  const runId = rawRun.replace(/^#/, "");
  if (!/^\d+$/.test(runId))
    throw new Error("runId must be a run id or a run URL.");
  if (rawRepo === "")
    return { repo: null, runId, conclusion };
  const repo = await resolveRepo(rawRepo);
  if (repo === null)
    throw new Error("repo must be owner/name, a repository URL or a CI Hub repo key.");
  return { repo, runId, conclusion };
};
var readWaitState = (state, resolveRepo = keyOrLegacy) => {
  if (!state || typeof state !== "object")
    return null;
  const value = state;
  if (typeof value.repo !== "string" || typeof value.runId !== "string")
    return null;
  const repo = resolveRepo(value.repo);
  if (repo === null)
    return null;
  return {
    repo,
    runId: value.runId,
    conclusion: typeof value.conclusion === "string" ? value.conclusion : null,
    attempt: typeof value.attempt === "number" ? value.attempt : 1,
    number: typeof value.number === "number" ? value.number : 0,
    workflow: typeof value.workflow === "string" ? value.workflow : ""
  };
};
var waitLabel = (run) => `${run.workflow} #${run.number} on ${repoName(run.repo)}`.slice(0, 80);
var judgeWait = (state, run, jobs) => {
  if (run.status === "completed")
    return { fired: true, early: false };
  if (state.conclusion && jobs) {
    const hit = jobs.some((job) => job.status === "completed" && job.conclusion === state.conclusion);
    if (hit)
      return { fired: true, early: true };
  }
  return { fired: false };
};
var clean = (text) => text.replace(/[<>]/g, "");
var waitSummary = (run, jobs, early, excerpt) => {
  const duration = runDuration(run);
  const verdict = early ? "has a failed job (run still in progress)" : run.conclusion ?? run.status;
  const parts = [
    `CI run ${run.workflow} #${run.number} on ${repoName(run.repo)} (${run.branch || "no branch"}) ${verdict}` + (duration !== null && !early ? ` after ${formatDuration(duration)}` : "") + ".",
    `Run: ${run.url}`
  ];
  const failed = failedJobs(jobs);
  if (failed.length > 0) {
    parts.push(`Failed jobs: ${failed.map((job) => {
      const step = failingStep(job);
      return step ? `${job.name} (step "${step.name}")` : job.name;
    }).join("; ")}.`);
  }
  let text = parts.join(`
`);
  if (excerpt && excerpt.length > 0) {
    const room = 1900 - text.length;
    let block = "";
    for (const line of excerpt) {
      if (block.length + line.length + 1 > room - 40)
        break;
      block += `${line}
`;
    }
    if (block)
      text += `
Log excerpt:
${block.trimEnd()}`;
  }
  return clean(text).slice(0, 2000);
};

// src/providers/errors.ts
class ProviderError extends Error {
  kind;
  status;
  rateLimitReset;
  constructor(message, options) {
    super(message);
    this.name = "ProviderError";
    this.kind = options.kind;
    this.status = options.status ?? 0;
    this.rateLimitReset = options.rateLimitReset ?? null;
  }
}

// src/providers/compat.ts
var RUN_STATUS = {
  queued: "queued",
  requested: "requested",
  waiting: "waiting",
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed"
};
var CONCLUSIONS = new Set([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "neutral",
  "stale",
  "startup_failure"
]);
var time = (value) => {
  if (typeof value !== "string")
    return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < -2208988800000)
    return null;
  return parsed;
};
var parseVariablesObject = (raw) => {
  if (typeof raw !== "string" || raw.trim() === "")
    return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isObject(parsed))
    return {};
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== "" && typeof value === "string")
      out[key] = value;
  }
  return out;
};
var asString = (value, fallback = "") => typeof value === "string" ? value : fallback;
var statusOf = (value) => RUN_STATUS[asString(value)] ?? "unknown";
var conclusionOf = (value) => {
  const text = asString(value);
  return text !== "" && CONCLUSIONS.has(text) ? text : null;
};
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var workflowFileOf = (value) => {
  const path = value.split("@")[0] ?? "";
  return path.split("/").pop() ?? path;
};

// src/providers/github.ts
var GITHUB_API_ORIGIN = "https://api.github.com";
var GITHUB_API_VERSION = "2022-11-28";
var apiOriginFor = (host) => host.toLowerCase() === "github.com" ? GITHUB_API_ORIGIN : `https://${host.toLowerCase()}/api/v3`;
var webUrlOf = (ref) => `https://${ref.host}/${ref.path}`;
var mapRun = (ref, raw) => {
  if (!isObject(raw))
    return null;
  const id = raw.id;
  if (typeof id !== "number" && typeof id !== "string")
    return null;
  const number = typeof raw.run_number === "number" ? raw.run_number : 0;
  const attempt = typeof raw.run_attempt === "number" && raw.run_attempt > 0 ? raw.run_attempt : 1;
  const sha = asString(raw.head_sha);
  return {
    id: String(id),
    provider: "github",
    repo: formatRepoKey(ref),
    number,
    workflow: asString(raw.name) || asString(raw.display_title) || "workflow",
    workflowId: raw.workflow_id === undefined ? "" : String(raw.workflow_id),
    branch: asString(raw.head_branch),
    sha,
    title: asString(raw.display_title) || asString(raw.head_commit && isObject(raw.head_commit) ? raw.head_commit.message : ""),
    event: asString(raw.event),
    attempt,
    status: statusOf(raw.status),
    conclusion: conclusionOf(raw.conclusion),
    createdAt: time(raw.created_at) ?? 0,
    startedAt: time(raw.run_started_at) ?? time(raw.created_at) ?? null,
    finishedAt: statusOf(raw.status) === "completed" ? time(raw.updated_at) ?? null : null,
    actor: isObject(raw.actor) ? asString(raw.actor.login) : "",
    url: asString(raw.html_url),
    commitUrl: sha === "" ? null : `${webUrlOf(ref)}/commit/${sha}`
  };
};
var mapJob = (runId, raw) => {
  if (!isObject(raw) || raw.id === undefined)
    return null;
  const steps = Array.isArray(raw.steps) ? raw.steps.filter(isObject).map((step, index) => ({
    number: typeof step.number === "number" ? step.number : index + 1,
    name: asString(step.name) || `step ${index + 1}`,
    status: statusOf(step.status),
    conclusion: conclusionOf(step.conclusion),
    startedAt: time(step.started_at),
    finishedAt: time(step.completed_at)
  })) : [];
  return {
    id: String(raw.id),
    runId,
    name: asString(raw.name) || `job ${String(raw.id)}`,
    status: statusOf(raw.status),
    conclusion: conclusionOf(raw.conclusion),
    startedAt: time(raw.started_at),
    finishedAt: time(raw.completed_at),
    steps,
    url: asString(raw.html_url)
  };
};
var WORKFLOW_DIR = ".github/workflows/";
var createGitHubClient = (options) => {
  const apiOrigin = apiOriginFor(options.host);
  const now = options.now ?? (() => Date.now());
  const request = async (path, init = {}, extraHeaders = {}) => {
    const url = path.startsWith("http") ? path : `${apiOrigin}${path}`;
    let response;
    try {
      response = await options.fetch(url, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "User-Agent": "openchamber-ci-hub",
          Authorization: `Bearer ${options.token}`,
          ...extraHeaders,
          ...init.headers
        }
      });
    } catch (err) {
      throw new ProviderError(err instanceof Error ? `GitHub unreachable: ${err.message}` : "GitHub unreachable", { kind: "network" });
    }
    if (response.status === 401) {
      throw new ProviderError("GitHub rejected the token (401). Reconnect the account.", { kind: "auth", status: 401 });
    }
    const remaining = response.headers.get("x-ratelimit-remaining");
    const retryAfter = Number(response.headers.get("retry-after"));
    if (response.status === 429 || response.status === 403 && (remaining === "0" || Number.isFinite(retryAfter) && retryAfter > 0)) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      const resetAt = Number.isFinite(retryAfter) && retryAfter > 0 ? now() + retryAfter * 1000 : Number.isFinite(reset) && reset > 0 ? reset * 1000 : now() + 60000;
      throw new ProviderError("GitHub rate limit reached.", {
        kind: "rate-limit",
        status: response.status,
        rateLimitReset: resetAt
      });
    }
    if (response.status === 403) {
      throw new ProviderError("GitHub refused the request (403). The token may lack the workflow scope.", {
        kind: "forbidden",
        status: 403
      });
    }
    if (response.status === 404) {
      throw new ProviderError("Not found on GitHub (404).", { kind: "not-found", status: 404 });
    }
    if (response.status >= 500) {
      throw new ProviderError(`GitHub answered ${response.status}.`, { kind: "server", status: response.status });
    }
    if (!response.ok && response.status !== 304) {
      throw new ProviderError(`GitHub answered ${response.status}.`, { kind: "unknown", status: response.status });
    }
    return response;
  };
  const ETAG_LIMIT = 200;
  const etags = new Map;
  const json = async (path, init) => {
    const conditional = init?.method === undefined;
    const cached = conditional ? etags.get(path) : undefined;
    const response = await request(path, init, cached ? { "If-None-Match": cached.etag } : {});
    if (response.status === 304 && cached) {
      etags.delete(path);
      etags.set(path, cached);
      return cached.body;
    }
    const text = response.status === 204 || response.status === 304 ? "" : await response.text();
    if (text.trim() === "")
      return null;
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ProviderError(`GitHub answered ${response.status} with a body that is not JSON.`, {
        kind: "unknown",
        status: response.status
      });
    }
    const etag = response.headers.get("etag");
    if (etag && conditional) {
      etags.delete(path);
      etags.set(path, { etag, body });
      if (etags.size > ETAG_LIMIT)
        etags.delete(etags.keys().next().value);
    }
    return body;
  };
  const base = (repo) => `/repos/${repo.path.split("/").map(encodeURIComponent).join("/")}`;
  const runParams = (opts, perPage) => {
    const params = new URLSearchParams;
    params.set("per_page", String(opts.perPage ?? perPage));
    params.set("page", String(opts.page ?? 1));
    if (opts.branch)
      params.set("branch", opts.branch);
    if (opts.event)
      params.set("event", opts.event);
    if (opts.status)
      params.set("status", opts.status);
    if (opts.actor)
      params.set("actor", opts.actor);
    return params.toString();
  };
  const runsOf = (repo, body) => {
    const runs = isObject(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
    return runs.map((raw) => mapRun(repo, raw)).filter((run) => run !== null);
  };
  return {
    async listRuns(repo, opts = {}) {
      const body = await json(`${base(repo)}/actions/runs?${runParams(opts, 40)}`);
      return runsOf(repo, body);
    },
    async listWorkflowRuns(repo, workflowId, opts = {}) {
      const id = encodeURIComponent(workflowId);
      const body = await json(`${base(repo)}/actions/workflows/${id}/runs?${runParams(opts, 20)}`);
      const total = isObject(body) && typeof body.total_count === "number" ? body.total_count : 0;
      return { runs: runsOf(repo, body), total };
    },
    async getRun(repo, runId) {
      const raw = await json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}`);
      const run = mapRun(repo, raw);
      if (run === null)
        throw new ProviderError("That run is not readable.", { kind: "unknown" });
      return run;
    },
    async listJobs(repo, runId) {
      const body = await json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`);
      const jobs = isObject(body) && Array.isArray(body.jobs) ? body.jobs : [];
      return jobs.map((raw) => mapJob(runId, raw)).filter((job) => job !== null);
    },
    async getJobLog(repo, jobId, opts = {}) {
      const tailBytes = opts.tailBytes ?? 256 * 1024;
      const path = `${base(repo)}/actions/jobs/${encodeURIComponent(jobId)}/logs`;
      let response;
      try {
        response = await request(path, { redirect: "follow" }, opts.full ? {} : { Range: `bytes=-${tailBytes}` });
      } catch (err) {
        if (!(err instanceof ProviderError) || err.status !== 416)
          throw err;
        response = await request(path, { redirect: "follow" });
      }
      let text = await response.text();
      let truncated = response.status === 206;
      const cap = opts.full ? 4 * 1024 * 1024 : tailBytes;
      if (text.length > cap) {
        text = text.slice(text.length - cap);
        truncated = true;
      }
      if (truncated) {
        const cut = text.indexOf(`
`);
        if (cut !== -1 && cut < 4096)
          text = text.slice(cut + 1);
      }
      return { text, truncated };
    },
    async rerunAll(repo, runId) {
      await request(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/rerun`, { method: "POST" });
    },
    async rerunFailed(repo, runId) {
      await request(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/rerun-failed-jobs`, {
        method: "POST"
      });
    },
    async cancel(repo, runId) {
      await request(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    },
    async listWorkflows(repo) {
      const body = await json(`${base(repo)}/actions/workflows?per_page=100`);
      const list = isObject(body) && Array.isArray(body.workflows) ? body.workflows : [];
      return list.filter(isObject).map((raw) => {
        const path = asString(raw.path);
        return {
          id: String(raw.id ?? ""),
          name: asString(raw.name) || path,
          path,
          file: path.startsWith(WORKFLOW_DIR) ? path.slice(WORKFLOW_DIR.length) : path
        };
      }).filter((workflow) => workflow.id !== "");
    },
    async getDispatchInputs(repo, workflow, ref) {
      const path = `${base(repo)}/contents/${workflow.path.split("/").map(encodeURIComponent).join("/")}`;
      const response = await request(`${path}?ref=${encodeURIComponent(ref)}`, { headers: { Accept: "application/vnd.github.raw" } });
      const yaml = await response.text();
      const dispatchable = hasDispatchTrigger(yaml);
      return {
        dispatchable,
        inputs: parseDispatchInputs(yaml),
        refusal: dispatchable ? null : `This workflow has no workflow_dispatch trigger on ${ref}, so GitHub will refuse to start it.`
      };
    },
    async dispatch(repo, workflowId, ref, inputs) {
      await request(`${base(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`, {
        method: "POST",
        body: JSON.stringify({ ref, inputs }),
        headers: { "Content-Type": "application/json" }
      });
    },
    async defaultBranch(repo) {
      const body = await json(base(repo));
      return isObject(body) ? asString(body.default_branch, "main") : "main";
    }
  };
};
var indentOf = (line) => line.length - line.trimStart().length;
var unquote = (value) => {
  let text = value.trim();
  const comment = /^([^#'"]*?)\s+#.*$/.exec(text);
  if (comment)
    text = comment[1].trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length > 1 || text.startsWith("'") && text.endsWith("'") && text.length > 1) {
    text = text.slice(1, -1);
  }
  return text;
};
var hasDispatchTrigger = (yaml) => yaml.replace(/\r\n/g, `
`).split(`
`).some((line) => !/^\s*#/.test(line) && /(^|[\s\[,:])workflow_dispatch\b/.test(line));
var parseDispatchInputs = (yaml) => {
  const lines = yaml.replace(/\r\n/g, `
`).split(`
`);
  const significant = lines.filter((line) => line.trim() !== "" && !/^\s*#/.test(line));
  if (significant.length === 0)
    return [];
  const startIndex = significant.findIndex((line) => /^\s*workflow_dispatch\s*:\s*$/.test(line));
  if (startIndex === -1)
    return [];
  const dispatchIndent = indentOf(significant[startIndex]);
  let inputsIndent = -1;
  const inputs = [];
  let current = null;
  let inOptions = false;
  let optionsIndent = -1;
  let nameIndent = -1;
  for (let i = startIndex + 1;i < significant.length; i += 1) {
    const line = significant[i];
    const indent = indentOf(line);
    const trimmed = line.trim();
    if (indent <= dispatchIndent)
      break;
    if (inputsIndent === -1) {
      const match = /^inputs\s*:\s*$/.exec(trimmed);
      if (match)
        inputsIndent = indent;
      continue;
    }
    if (inOptions && indent > optionsIndent && trimmed.startsWith("-")) {
      if (current !== null)
        current.options.push(unquote(trimmed.replace(/^-\s*/, "")));
      continue;
    }
    inOptions = false;
    if (indent <= inputsIndent)
      break;
    const keyMatch = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!keyMatch)
      continue;
    const key = keyMatch[1];
    const value = keyMatch[2] ?? "";
    if (nameIndent === -1)
      nameIndent = indent;
    if (indent <= nameIndent) {
      if (value === "") {
        current = {
          name: key,
          description: "",
          required: false,
          default: "",
          type: "string",
          options: []
        };
        inputs.push(current);
        continue;
      }
      current = null;
      continue;
    }
    if (current === null)
      continue;
    if (key === "description")
      current.description = unquote(value);
    else if (key === "required")
      current.required = unquote(value) === "true";
    else if (key === "default")
      current.default = unquote(value);
    else if (key === "type") {
      const type = unquote(value);
      if (type === "boolean" || type === "choice" || type === "environment")
        current.type = type;
      else
        current.type = "string";
    } else if (key === "options") {
      const inline = value.trim();
      if (inline.startsWith("[")) {
        current.options.push(...inline.replace(/^\[|\]$/g, "").split(",").map((entry) => unquote(entry)).filter((entry) => entry !== ""));
      } else {
        inOptions = true;
        optionsIndent = indent;
      }
    }
  }
  return inputs;
};
var CAPABILITIES = {
  rerunAll: "same-run",
  rerunFailed: true,
  cancel: true,
  retryJob: false,
  playManualJob: false,
  dispatch: "workflow-inputs",
  jobDetail: "steps",
  approve: false,
  groupHistory: true
};
var RUN_URL = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/;
var github = {
  id: "github",
  label: "GitHub",
  words: {
    run: "run",
    runs: "runs",
    workflow: "workflow",
    workflows: "workflows",
    rerunFailed: "Re-run failed jobs",
    rerunFailedShort: "Re-run failed",
    rerunAll: "Re-run all jobs",
    rerunAllShort: "Re-run all",
    cancelDelay: "GitHub takes a few seconds to stop it.",
    logPending: "GitHub publishes the log when the job finishes.",
    logMissing: "GitHub has no log for this job (it may have been skipped or the log expired).",
    dispatchHelp: "Only workflows with a workflow_dispatch trigger can be started here.",
    repoPlaceholder: "owner/name or a GitHub URL",
    tokenOrder: "CI Hub looks for a token in this order: the GitHub account connected in OpenChamber, the token pasted on the CI Hub card in Extensions, then the gh CLI (gh auth login). Re-runs, cancel and workflow runs need the repo and workflow scopes.",
    noAccount: "No GitHub account. Connect GitHub in OpenChamber, paste a token on the CI Hub card, or run gh auth login."
  },
  capabilities: CAPABILITIES,
  logDialect: "github",
  publicHosts: ["github.com"],
  hostPattern: /^github\./,
  storeKey: "github",
  settingKey: "github-token",
  serverSetting: null,
  authSetting: null,
  cli: { program: "gh", tokenArgs: (host) => ["auth", "token", "--hostname", host] },
  apiOrigin: apiOriginFor,
  repoPath: (segments) => segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null,
  webUrl: webUrlOf,
  ciUrl: (ref) => `${webUrlOf(ref)}/actions`,
  parseRunUrl: (url) => {
    const match = RUN_URL.exec(url.trim());
    if (!match)
      return null;
    return {
      repo: formatRepoKey({ provider: "github", host: match[1], path: match[2] }),
      runId: match[3]
    };
  },
  createClient: createGitHubClient
};

// src/providers/forgejo.ts
var WINDOW = 50;
var GROUP_PAGE_CAP = 5;
var TAIL_BYTES = 128 * 1024;
var FULL_TRACE_CAP_BYTES = 1024 * 1024;
var STEPS_CAP = 20;
var WORKFLOW_DIRS = [".gitea/workflows", ".github/workflows"];
var apiOriginFor2 = (host) => `https://${host.toLowerCase()}/api/v1`;
var webUrlOf2 = (ref) => `https://${ref.host}/${ref.path}`;
var STATE = {
  unknown: { status: "queued", conclusion: null },
  waiting: { status: "queued", conclusion: null },
  blocked: { status: "queued", conclusion: null },
  running: { status: "in_progress", conclusion: null },
  success: { status: "completed", conclusion: "success" },
  failure: { status: "completed", conclusion: "failure" },
  cancelled: { status: "completed", conclusion: "cancelled" },
  skipped: { status: "completed", conclusion: "skipped" }
};
var stateOf = (value) => STATE[asString(value)] ?? { status: "unknown", conclusion: null };
var STATUS_QUERY = {
  in_progress: "running",
  failed: "failure",
  succeeded: "success",
  cancelled: "cancelled"
};
var RUN_URL2 = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/;

class ForgejoApi {
  fetch;
  token;
  origin;
  host;
  constructor(options) {
    this.fetch = options.fetch;
    this.token = options.token;
    this.host = options.host;
    this.origin = apiOriginFor2(options.host);
  }
  async send(path, init = {}, extraHeaders = {}) {
    const url = path.startsWith("http") ? path : `${this.origin}${path}`;
    let response;
    try {
      response = await this.fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          "User-Agent": "openchamber-ci-hub",
          Authorization: `token ${this.token}`,
          ...extraHeaders,
          ...init.headers
        }
      });
    } catch (err) {
      throw new ProviderError(err instanceof Error ? `Forgejo unreachable: ${err.message}` : "Forgejo unreachable", {
        kind: "network"
      });
    }
    if (response.status === 401) {
      throw new ProviderError("Forgejo rejected the token (401). Reconnect the account.", { kind: "auth", status: 401 });
    }
    if (response.status === 403) {
      throw new ProviderError("Forgejo refused the request (403). The token may lack the scopes it needs.", {
        kind: "forbidden",
        status: 403
      });
    }
    if (response.status === 404) {
      throw new ProviderError("Not found on Forgejo (404).", { kind: "not-found", status: 404 });
    }
    if (response.status >= 500) {
      throw new ProviderError(`Forgejo answered ${response.status}.`, { kind: "server", status: response.status });
    }
    if (!response.ok) {
      throw new ProviderError(`Forgejo answered ${response.status}.`, { kind: "unknown", status: response.status });
    }
    return response;
  }
  async json(path, init) {
    const response = await this.send(path, init);
    const text = await response.text();
    if (text.trim() === "")
      return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError(`Forgejo answered ${response.status} with a body that is not JSON.`, {
        kind: "unknown",
        status: response.status
      });
    }
  }
  async jsonOrNull(path, init) {
    return await this.json(path, init).catch((err) => {
      if (err instanceof ProviderError && err.kind === "not-found")
        return null;
      throw err;
    });
  }
}
var contentsText = (body) => {
  if (!isObject(body))
    return "";
  const content = body.content;
  if (typeof content !== "string")
    return "";
  return asString(body.encoding) === "base64" ? atob(content.replace(/\s+/g, "")) : content;
};
var mapForgejoRun = (ref, raw) => {
  if (!isObject(raw))
    return null;
  const id = raw.id;
  if (typeof id !== "number" && typeof id !== "string")
    return null;
  const sha = asString(raw.commit_sha);
  const started = time(raw.started);
  const state = stateOf(raw.status);
  return {
    id: String(id),
    provider: "forgejo",
    repo: formatRepoKey(ref),
    number: typeof raw.index_in_repo === "number" ? raw.index_in_repo : 0,
    workflow: asString(raw.title) || workflowFileOf(asString(raw.workflow_id)) || "workflow",
    workflowId: asString(raw.workflow_id),
    branch: asString(raw.prettyref),
    sha,
    title: asString(raw.title),
    event: asString(raw.event),
    attempt: 1,
    status: state.status,
    conclusion: state.conclusion,
    createdAt: time(raw.created) ?? started ?? 0,
    startedAt: started,
    finishedAt: time(raw.stopped),
    actor: isObject(raw.trigger_user) ? asString(raw.trigger_user.login) : "",
    url: asString(raw.html_url),
    commitUrl: sha === "" ? null : `${webUrlOf2(ref)}/commit/${sha}`
  };
};
var runsOf = (ref, body) => {
  const runs = isObject(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
  return runs.map((raw) => mapForgejoRun(ref, raw)).filter((run) => run !== null);
};
var minTime = (values) => {
  const present = values.filter((value) => value !== null);
  return present.length === 0 ? null : Math.min(...present);
};
var maxTime = (values) => {
  const present = values.filter((value) => value !== null);
  return present.length === 0 ? null : Math.max(...present);
};
var mapForgejoJob = (runId, raw, steps) => {
  if (!isObject(raw) || raw.id === undefined)
    return null;
  const state = stateOf(raw.status);
  const stepList = Array.isArray(steps) ? steps.filter(isObject).map((step, index) => ({
    number: typeof step.number === "number" ? step.number : index + 1,
    name: asString(step.name) || `step ${index + 1}`,
    status: stateOf(step.status).status,
    conclusion: stateOf(step.status).conclusion,
    startedAt: time(step.started),
    finishedAt: time(step.stopped)
  })) : [];
  return {
    id: String(raw.id),
    runId,
    name: asString(raw.name) || `job ${String(raw.id)}`,
    status: state.status,
    conclusion: state.conclusion,
    startedAt: minTime(stepList.map((step) => step.startedAt)),
    finishedAt: maxTime(stepList.map((step) => step.finishedAt)),
    steps: stepList,
    url: asString(raw.html_url)
  };
};
var createForgejoClient = (options) => {
  const api = new ForgejoApi(options);
  const host = options.host;
  const base = (repo) => `/repos/${repo.path.split("/").map(encodeURIComponent).join("/")}`;
  const runParams = (opts, page, limit) => {
    const params = new URLSearchParams;
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (opts.event)
      params.set("event", opts.event);
    if (opts.branch)
      params.set("ref", opts.branch.startsWith("refs/") ? opts.branch : `refs/heads/${opts.branch}`);
    if (opts.status) {
      const query = STATUS_QUERY[opts.status];
      if (query)
        params.set("status", query);
    }
    return params.toString();
  };
  const runsList = async (repo, opts, page, limit) => {
    const body = await api.json(`${base(repo)}/actions/runs?${runParams(opts, page, limit)}`).catch((err) => {
      if (err instanceof ProviderError && err.kind === "not-found") {
        throw new ProviderError("This Forgejo does not expose the Actions runs API; CI Hub needs a Forgejo with Actions runs and logs.", { kind: "unsupported" });
      }
      throw err;
    });
    return runsOf(repo, body);
  };
  const client = {
    async listRuns(repo, opts = {}) {
      const runs = await runsList(repo, opts, opts.page ?? 1, opts.perPage ?? 50);
      return opts.actor ? runs.filter((run) => run.actor === opts.actor) : runs;
    },
    async listWorkflowRuns(repo, workflowId, opts = {}) {
      const page = Math.max(1, opts.page ?? 1);
      const perPage = opts.perPage ?? 20;
      const pages = Math.min(GROUP_PAGE_CAP, Math.ceil(page * perPage / WINDOW));
      const group = [];
      let lastPageFull = false;
      for (let underlying = 1;underlying <= pages; underlying += 1) {
        const runs = await runsList(repo, opts, underlying, WINDOW);
        lastPageFull = runs.length >= WINDOW;
        for (const run of runs) {
          const file = workflowFileOf(run.workflowId);
          if (file === workflowId || run.workflowId === workflowId)
            group.push(run);
        }
      }
      let total = group.length;
      if (lastPageFull && pages < GROUP_PAGE_CAP) {
        const more = (await runsList(repo, opts, pages + 1, WINDOW)).some((run) => {
          const file = workflowFileOf(run.workflowId);
          return file === workflowId || run.workflowId === workflowId;
        });
        if (more)
          total = group.length + 1;
      }
      const actor = opts.actor;
      const filtered = actor ? group.filter((run) => run.actor === actor) : group;
      return { runs: filtered.slice((page - 1) * perPage, page * perPage), total };
    },
    async getRun(repo, runId) {
      const direct = await api.json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}`).then((raw) => mapForgejoRun(repo, raw)).catch((err) => {
        if (err instanceof ProviderError && err.kind === "not-found")
          return null;
        throw err;
      });
      if (direct)
        return direct;
      if (!/^\d+$/.test(runId))
        throw new ProviderError("That run is not readable.", { kind: "unknown" });
      const wanted = Number(runId);
      const newest = await this.listRuns(repo, { perPage: 50 });
      const hit = newest.find((run) => run.number === wanted);
      if (hit)
        return hit;
      throw new ProviderError("That run is not readable.", { kind: "unknown" });
    },
    async listJobs(repo, runId) {
      const list = await api.json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs?limit=50`).then((body) => Array.isArray(body) ? body : []);
      const kept = list.slice(0, STEPS_CAP);
      const jobs = await Promise.all(list.map(async (raw, index) => {
        const steps = index < kept.length ? await api.jsonOrNull(`${base(repo)}/actions/jobs/${String(raw.id)}`).then((job) => isObject(job) && Array.isArray(job.steps) ? job.steps : []) : [];
        return mapForgejoJob(runId, raw, steps);
      }));
      return jobs.filter((job) => job !== null);
    },
    async getJobLog(repo, jobId, opts = {}) {
      const tailBytes = opts.tailBytes ?? TAIL_BYTES;
      const response = await api.send(`${base(repo)}/actions/jobs/${encodeURIComponent(jobId)}/logs`, {}, opts.full ? {} : { Range: `bytes=-${tailBytes}` });
      let text = await response.text();
      let truncated = response.status === 206;
      const cap = opts.full ? FULL_TRACE_CAP_BYTES : tailBytes;
      const size = byteLength(text);
      if (size > cap) {
        text = sliceByBytes(text, size - cap, size);
        truncated = true;
      }
      if (truncated) {
        const cut = text.indexOf(`
`);
        if (cut !== -1 && cut < 4096 && cut < text.length - 1)
          text = text.slice(cut + 1);
      }
      return { text, truncated };
    },
    async rerunAll(repo, runId) {
      await api.send(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/rerun`, { method: "POST" });
    },
    async rerunFailed() {
      throw new ProviderError("Forgejo has no re-run-failed-jobs API; re-run the whole run instead.", {
        kind: "unsupported"
      });
    },
    async cancel(repo, runId) {
      await api.send(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    },
    async listWorkflows(repo) {
      const found = [];
      for (const dir of WORKFLOW_DIRS) {
        const listing = await api.jsonOrNull(`${base(repo)}/contents/${dir}`);
        if (!Array.isArray(listing))
          continue;
        for (const raw of listing.filter(isObject)) {
          const name = asString(raw.name);
          if (!name.endsWith(".yml") && !name.endsWith(".yaml"))
            continue;
          if (found.some((entry) => entry.id === name))
            continue;
          const stem = name.replace(/\.(yml|yaml)$/, "");
          found.push({ id: name, name: stem, path: asString(raw.path) || `${dir}/${name}`, file: name });
        }
      }
      return found;
    },
    async getDispatchInputs(repo, workflow, ref) {
      let yaml = "";
      for (const dir of WORKFLOW_DIRS) {
        const body = await api.jsonOrNull(`${base(repo)}/contents/${dir}/${encodeURIComponent(workflow.file)}`, {
          headers: {}
        });
        const text = contentsText(body);
        if (text !== "") {
          yaml = text;
          break;
        }
      }
      const dispatchable = hasDispatchTrigger(yaml);
      return {
        dispatchable,
        inputs: parseDispatchInputs(yaml),
        refusal: dispatchable ? null : `This workflow has no workflow_dispatch trigger on ${ref}, so Forgejo will refuse to start it.`
      };
    },
    async dispatch(repo, workflowId, ref, inputs) {
      const file = workflowFileOf(workflowId);
      await api.send(`${base(repo)}/actions/workflows/${encodeURIComponent(file)}/dispatches`, {
        method: "POST",
        body: JSON.stringify({ ref, inputs }),
        headers: { "Content-Type": "application/json" }
      });
    },
    async defaultBranch(repo) {
      const body = await api.json(`${base(repo)}`);
      return isObject(body) ? asString(body.default_branch, "main") : "main";
    }
  };
  return client;
};
var CAPABILITIES2 = {
  rerunAll: "same-run",
  rerunFailed: false,
  cancel: true,
  retryJob: true,
  playManualJob: false,
  dispatch: "workflow-inputs",
  jobDetail: "steps",
  approve: false,
  groupHistory: true
};
var forgejo = {
  id: "forgejo",
  label: "Forgejo",
  words: {
    run: "run",
    runs: "runs",
    workflow: "workflow",
    workflows: "workflows",
    rerunFailed: "Re-run failed jobs",
    rerunFailedShort: "Re-run failed",
    rerunAll: "Re-run all jobs",
    rerunAllShort: "Re-run all",
    cancelDelay: "Forgejo takes a few seconds to stop it.",
    logPending: "Forgejo publishes the log while the job runs.",
    logMissing: "Forgejo has no log for this job (it may have been skipped or cleaned up).",
    dispatchHelp: "Workflows with a workflow_dispatch trigger can be started here.",
    repoPlaceholder: "owner/name or a Forgejo URL",
    tokenOrder: "CI Hub looks for a token in this order: the Forgejo account connected in OpenChamber, then the token pasted on the CI Hub card (codeberg.org only). Watching needs read access; cancel, re-run and starting workflows need repo write.",
    noAccount: "No Forgejo account. Connect Forgejo in OpenChamber or paste a token on the CI Hub card."
  },
  capabilities: CAPABILITIES2,
  logDialect: "github",
  publicHosts: ["codeberg.org"],
  hostPattern: /^forgejo\./,
  storeKey: "forgejo",
  settingKey: "forgejo-token",
  serverSetting: null,
  authSetting: null,
  cli: null,
  apiOrigin: apiOriginFor2,
  repoPath: (segments) => segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null,
  webUrl: webUrlOf2,
  ciUrl: (ref) => `${webUrlOf2(ref)}/actions`,
  parseRunUrl: (url) => {
    const match = url.trim().match(RUN_URL2);
    if (!match)
      return null;
    const host = match[1] ?? "";
    const path = match[2] ?? "";
    const runId = match[3] ?? "";
    if (host === "" || path === "" || runId === "")
      return null;
    return { repo: formatRepoKey({ provider: "forgejo", host, path }), runId };
  },
  createClient: createForgejoClient
};

// src/providers/bitbucket.ts
var WINDOW2 = 50;
var TAIL_BYTES2 = 128 * 1024;
var BASE = "https://api.bitbucket.org/2.0";
var STATUS_QUERY2 = {
  queued: "PENDING",
  in_progress: "IN_PROGRESS",
  succeeded: "SUCCESSFUL",
  failed: "FAILED",
  cancelled: "STOPPED"
};
var stateOf2 = (raw) => {
  const state = isObject(raw) ? raw : {};
  const name = asString(state["name"]);
  if (name === "IN_PROGRESS")
    return { status: "in_progress", conclusion: null };
  if (name === "PENDING")
    return { status: "queued", conclusion: null };
  if (name === "NOT_RUN")
    return { status: "completed", conclusion: "skipped" };
  if (name !== "COMPLETED")
    return { status: "unknown", conclusion: null };
  const result = isObject(state["result"]) ? asString(state["result"]["name"]) : "";
  const conclusion = result === "SUCCESSFUL" ? "success" : result === "FAILED" || result === "ERROR" || result === "EXPIRED" ? "failure" : result === "STOPPED" ? "cancelled" : result === "NOT_RUN" ? "skipped" : null;
  return { status: "completed", conclusion };
};
var unbraced = (value) => asString(value).replace(/^\{/, "").replace(/\}$/, "");
var valuesOf = (data) => {
  const envelope = isObject(data) ? data : {};
  return Array.isArray(envelope["values"]) ? envelope["values"] : [];
};
var webUrlOf3 = (ref) => `https://${ref.host}/${ref.path}`;
var slug2 = (ref) => ref.path;
var targetOf = (raw) => {
  const source = isObject(raw) ? raw : {};
  return isObject(source["target"]) ? source["target"] : {};
};
var mapBitbucketRun = (raw, ref, web) => {
  const source = isObject(raw) ? raw : {};
  const id = unbraced(source["uuid"]);
  const target = targetOf(raw);
  const commit = isObject(target["commit"]) ? target["commit"] : {};
  const links = isObject(commit["links"]) && isObject(commit["links"]["html"]) ? commit["links"]["html"] : {};
  const creator = isObject(source["creator"]) ? source["creator"] : {};
  const number = typeof source["build_number"] === "number" ? source["build_number"] : 0;
  const branch = asString(target["ref_name"]);
  const { status, conclusion } = stateOf2(source["state"]);
  return {
    id,
    provider: "bitbucket",
    repo: formatRepoKey(ref),
    number,
    workflow: "Pipelines",
    workflowId: "pipelines",
    branch,
    sha: asString(commit["hash"]),
    title: `#${number}${branch ? ` ${branch}` : ""}`,
    event: asString((isObject(source["trigger"]) ? source["trigger"] : {})["name"]),
    attempt: 1,
    status,
    conclusion,
    createdAt: time(source["created_on"]) ?? 0,
    startedAt: null,
    finishedAt: time(source["completed_on"]),
    actor: asString(creator["nickname"]) || asString(creator["display_name"]),
    url: web ? `${web}/pipelines/${id}` : "",
    commitUrl: asString(links["href"]) || null
  };
};
var mapBitbucketJobs = (raw, runId) => {
  const imageOf = (value) => typeof value === "string" ? value : asString(isObject(value) ? value["name"] : "");
  const jobs = [];
  const steps = valuesOf(raw);
  for (const [index, step] of steps.entries()) {
    if (!isObject(step))
      continue;
    const { status, conclusion } = stateOf2(step["state"]);
    const stepId = unbraced(step["uuid"]);
    if (!stepId)
      continue;
    jobs.push({
      id: `${runId}:${stepId}`,
      runId,
      name: imageOf(step["image"]) || `step ${index + 1}`,
      status,
      conclusion,
      startedAt: time(step["started_on"]),
      finishedAt: time(step["completed_on"]),
      steps: [],
      url: ""
    });
  }
  return jobs;
};

class BitbucketApi {
  fetch;
  user;
  token;
  constructor(options) {
    this.fetch = options.fetch;
    this.user = options.user ?? "";
    this.token = options.token;
  }
  auth() {
    let encoded;
    try {
      encoded = btoa(`${this.user}:${this.token}`);
    } catch {
      throw new ProviderError("The pasted credentials contain characters Basic auth cannot carry (non-Latin letters or symbols). Check bitbucket-email and bitbucket-token on the CI Hub card.", { kind: "unknown" });
    }
    return { Authorization: `Basic ${encoded}` };
  }
  async send(method, url, extraHeaders = {}, body) {
    const headers = { ...this.auth(), ...body ? { "Content-Type": "application/json" } : {}, ...extraHeaders };
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        ...body ? { body } : {}
      });
    } catch (err) {
      throw new ProviderError(err instanceof Error ? `Bitbucket unreachable: ${err.message}` : "Bitbucket unreachable", {
        kind: "network"
      });
    }
    if (response.status === 401)
      throw new ProviderError("Bitbucket rejected the credentials (401). Check bitbucket-email and bitbucket-token on the CI Hub card.", {
        kind: "auth",
        status: 401
      });
    if (response.status === 403)
      throw new ProviderError("Bitbucket refused the request (403). The token or branch permissions may not allow it.", {
        kind: "forbidden",
        status: 403
      });
    if (response.status === 404)
      throw new ProviderError("Not found on Bitbucket (404).", { kind: "not-found", status: 404 });
    if (response.status === 429)
      throw new ProviderError("Bitbucket is rate limiting this account (429). Try again shortly.", {
        kind: "rate-limit",
        status: 429
      });
    if (response.status >= 500)
      throw new ProviderError(`Bitbucket answered ${response.status}.`, { kind: "server", status: response.status });
    if (!response.ok)
      throw new ProviderError(`Bitbucket answered ${response.status}.`, { kind: "unknown", status: response.status });
    return response;
  }
  async request(method, url, extraHeaders = {}, body) {
    const response = await this.send(method, url, extraHeaders, body);
    try {
      return await response.json();
    } catch {
      throw new ProviderError(`Bitbucket answered ${response.status} with a body that is not JSON.`, {
        kind: "unknown",
        status: response.status
      });
    }
  }
  async requestRaw(method, url, extraHeaders = {}) {
    const response = await this.send(method, url, extraHeaders);
    const bodyBytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      bodyBytes,
      bodyText: new TextDecoder().decode(bodyBytes),
      header: (name) => response.headers.get(name)
    };
  }
  async fetchRuns(ref, options) {
    const page = options.page ?? 1;
    const query = new URLSearchParams({ page: String(page), pagelen: String(WINDOW2) });
    if (options.branch)
      query.set("target.ref_name", options.branch);
    if (options.event)
      query.set("trigger_type", options.event);
    const native = options.status ? STATUS_QUERY2[options.status] : undefined;
    if (native)
      query.set("status", native);
    const data = await this.request("GET", `${BASE}/repositories/${slug2(ref)}/pipelines?${query}`);
    const web = webUrlOf3(ref);
    const values = valuesOf(data);
    return { runs: values.map((raw) => mapBitbucketRun(raw, ref, web)), page, full: values.length >= WINDOW2, next: Boolean((isObject(data) ? data : {})["next"]) };
  }
}
var createBitbucketClient = (options) => {
  const api = new BitbucketApi(options);
  return {
    async listRuns(repo, listOptions = {}) {
      const { runs } = await api.fetchRuns(repo, listOptions);
      return runs;
    },
    async listWorkflowRuns(repo, _workflowId, listOptions = {}) {
      const { runs, page, full, next } = await api.fetchRuns(repo, listOptions);
      const total = full && next ? page * WINDOW2 + 1 : (page - 1) * WINDOW2 + runs.length;
      return { runs, total };
    },
    async getRun(repo, runId) {
      const data = await api.request("GET", `${BASE}/repositories/${slug2(repo)}/pipelines/${encodeURIComponent(runId)}`);
      return mapBitbucketRun(data, repo, webUrlOf3(repo));
    },
    async listJobs(repo, runId) {
      const data = await api.request("GET", `${BASE}/repositories/${slug2(repo)}/pipelines/${encodeURIComponent(runId)}/steps?pagelen=100`);
      return mapBitbucketJobs(data, runId);
    },
    async getJobLog(repo, composite, logOptions = {}) {
      const at = composite.indexOf(":");
      const runId = at === -1 ? "" : composite.slice(0, at);
      const jobId = at === -1 ? "" : composite.slice(at + 1);
      if (!runId || !jobId)
        throw new ProviderError("That job is not readable.", { kind: "not-found" });
      const url = `${BASE}/repositories/${slug2(repo)}/pipelines/${encodeURIComponent(runId)}/steps/${encodeURIComponent(jobId)}/log`;
      const tailBytes = logOptions.tailBytes ?? TAIL_BYTES2;
      let probe;
      try {
        probe = await api.requestRaw("GET", url, { Range: "bytes=0-0" });
      } catch (err) {
        if (err instanceof ProviderError && err.status === 416)
          return { text: "", truncated: false };
        throw err;
      }
      const contentRange = probe.header("Content-Range");
      const total = contentRange === null ? null : Number(/^bytes 0-0\/(\d+)$/.exec(contentRange)?.[1]);
      if (contentRange === null) {
        const body = probe.bodyText;
        const size = byteLength(body);
        const text = size > tailBytes ? sliceByBytes(body, size - tailBytes, size) : body;
        return { text, truncated: size > tailBytes };
      }
      if (total === null || !Number.isFinite(total))
        return { text: probe.bodyText, truncated: false };
      if (total === 0)
        return { text: "", truncated: false };
      if (total <= tailBytes) {
        const whole = await api.requestRaw("GET", url, { Range: "bytes=0-" });
        return { text: whole.bodyText, truncated: false };
      }
      const tail = await api.requestRaw("GET", url, { Range: `bytes=${total - tailBytes}-` });
      let from = 0;
      while (from < tail.bodyBytes.length && (tail.bodyBytes[from] & 192) === 128)
        from += 1;
      return { text: new TextDecoder().decode(tail.bodyBytes.subarray(from)), truncated: true };
    },
    async rerunAll(repo, runId) {
      const data = await api.request("GET", `${BASE}/repositories/${slug2(repo)}/pipelines/${encodeURIComponent(runId)}`);
      await api.request("POST", `${BASE}/repositories/${slug2(repo)}/pipelines`, {}, JSON.stringify({ target: targetOf(data) }));
    },
    async rerunFailed() {
      throw new ProviderError("Bitbucket has no re-run-failed API; start a new pipeline instead.", { kind: "unsupported" });
    },
    async cancel(repo, runId) {
      await api.request("POST", `${BASE}/repositories/${slug2(repo)}/pipelines/${encodeURIComponent(runId)}/stopPipeline`);
    },
    async listWorkflows() {
      return [{ id: "pipelines", name: "Pipelines", path: "pipelines", file: "pipelines" }];
    },
    async getDispatchInputs() {
      const inputs = [
        { name: "variables", type: "variables", description: "Pipeline variables, as key/value pairs.", required: false, default: "", options: [] }
      ];
      return { dispatchable: true, inputs, refusal: null };
    },
    async dispatch(repo, _workflowId, ref, inputs) {
      const variables = Object.entries(parseVariablesObject(inputs?.["variables"])).map(([key, value]) => ({ key, value }));
      await api.request("POST", `${BASE}/repositories/${slug2(repo)}/pipelines`, {}, JSON.stringify({ target: { type: "pipeline_ref_target", ref_type: "branch", ref_name: ref }, variables }));
    },
    async defaultBranch(repo) {
      const data = await api.request("GET", `${BASE}/repositories/${slug2(repo)}`);
      const branch = asString((isObject(data) ? data : {})["main_branch"]);
      if (!branch)
        throw new ProviderError("Bitbucket did not say which branch is the main one.", { kind: "unknown" });
      return branch;
    }
  };
};
var BITBUCKET_CAPABILITIES = {
  rerunAll: "new-pipeline",
  rerunFailed: false,
  cancel: true,
  retryJob: false,
  playManualJob: false,
  dispatch: "pipeline-variables",
  jobDetail: "none",
  approve: false,
  groupHistory: true
};
var BITBUCKET_WORDS = {
  run: "pipeline",
  runs: "pipelines",
  workflow: "pipeline",
  workflows: "pipelines",
  rerunFailed: "Retry failed jobs",
  rerunFailedShort: "Retry failed",
  rerunAll: "Run pipeline again",
  rerunAllShort: "Run again",
  cancelDelay: "Bitbucket takes a few seconds to stop it.",
  logPending: "Bitbucket shows the log while the step runs.",
  logMissing: "Bitbucket has no log for this step (it may have been skipped or erased).",
  dispatchHelp: "Pick a branch; Bitbucket starts a pipeline on it.",
  repoPlaceholder: "workspace/slug or a Bitbucket URL",
  tokenOrder: "CI Hub reads bitbucket-token together with bitbucket-email on the CI Hub card. Reading needs the pipeline scope; stopping and starting pipelines need pipeline:write.",
  noAccount: "No Bitbucket credentials. Paste bitbucket-email and bitbucket-token on the CI Hub card."
};
var RUN_URL3 = /^https?:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/pipelines\/(\{?[0-9a-fA-F-]+\}?)$/;
var bitbucket = {
  id: "bitbucket",
  label: "Bitbucket",
  words: BITBUCKET_WORDS,
  capabilities: BITBUCKET_CAPABILITIES,
  logDialect: "gitlab",
  publicHosts: ["bitbucket.org"],
  hostPattern: null,
  storeKey: null,
  settingKey: "bitbucket-token",
  serverSetting: null,
  authSetting: "bitbucket-email",
  cli: null,
  apiOrigin: () => `${BASE}`,
  repoPath: (segments) => segments.length === 2 ? segments.join("/") : null,
  webUrl: (ref) => webUrlOf3(ref),
  ciUrl: (ref) => `${webUrlOf3(ref)}/pipelines`,
  parseRunUrl: (url) => {
    const match = RUN_URL3.exec(url);
    if (!match)
      return null;
    const key = formatRepoKey({ provider: "bitbucket", host: "bitbucket.org", path: `${match[1]}/${match[2]}` });
    const runId = match[3].replace(/^\{/, "").replace(/\}$/, "");
    return parseRepoKey(key) && runId ? { repo: key, runId } : null;
  },
  createClient: (options) => createBitbucketClient(options)
};

// src/providers/gitea.ts
var WINDOW3 = 50;
var GROUP_PAGE_CAP2 = 5;
var TAIL_BYTES3 = 128 * 1024;
var FULL_TRACE_CAP_BYTES2 = 1024 * 1024;
var apiOriginFor3 = (host) => `https://${host.toLowerCase()}/api/v1`;
var webUrlOf4 = (ref) => `https://${ref.host}/${ref.path}`;
var STATUS_QUERY3 = {
  in_progress: "in_progress",
  failed: "failure",
  succeeded: "success",
  cancelled: "cancelled"
};
var RUN_URL4 = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/;

class GiteaApi {
  fetch;
  token;
  origin;
  host;
  constructor(options) {
    this.fetch = options.fetch;
    this.token = options.token;
    this.host = options.host;
    this.origin = apiOriginFor3(options.host);
  }
  async send(path, init = {}, extraHeaders = {}) {
    const url = path.startsWith("http") ? path : `${this.origin}${path}`;
    let response;
    try {
      response = await this.fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          "User-Agent": "openchamber-ci-hub",
          Authorization: `token ${this.token}`,
          ...extraHeaders,
          ...init.headers
        }
      });
    } catch (err) {
      throw new ProviderError(err instanceof Error ? `Gitea unreachable: ${err.message}` : "Gitea unreachable", {
        kind: "network"
      });
    }
    if (response.status === 401) {
      throw new ProviderError("Gitea rejected the token (401). Reconnect the account.", { kind: "auth", status: 401 });
    }
    if (response.status === 403) {
      throw new ProviderError("Gitea refused the request (403). The token may lack the scopes it needs.", {
        kind: "forbidden",
        status: 403
      });
    }
    if (response.status === 404) {
      throw new ProviderError("Not found on Gitea (404).", { kind: "not-found", status: 404 });
    }
    if (response.status >= 500) {
      throw new ProviderError(`Gitea answered ${response.status}.`, { kind: "server", status: response.status });
    }
    if (!response.ok) {
      throw new ProviderError(`Gitea answered ${response.status}.`, { kind: "unknown", status: response.status });
    }
    return response;
  }
  async json(path, init) {
    const response = await this.send(path, init);
    const text = await response.text();
    if (text.trim() === "")
      return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError(`Gitea answered ${response.status} with a body that is not JSON.`, {
        kind: "unknown",
        status: response.status
      });
    }
  }
}
var contentsText2 = (body) => {
  if (!isObject(body))
    return "";
  const content = body.content;
  if (typeof content !== "string")
    return "";
  return asString(body.encoding) === "base64" ? atob(content.replace(/\s+/g, "")) : content;
};
var mapGiteaRun = (ref, raw) => {
  if (!isObject(raw))
    return null;
  const id = raw.id;
  if (typeof id !== "number" && typeof id !== "string")
    return null;
  const workflowId = workflowFileOf(asString(raw.path));
  const sha = asString(raw.head_sha);
  const started = time(raw.started_at);
  return {
    id: String(id),
    provider: "gitea",
    repo: formatRepoKey(ref),
    number: typeof raw.run_number === "number" ? raw.run_number : 0,
    workflow: asString(raw.display_title) || workflowId || "workflow",
    workflowId,
    branch: asString(raw.head_branch),
    sha,
    title: asString(raw.display_title),
    event: asString(raw.event),
    attempt: typeof raw.run_attempt === "number" && raw.run_attempt > 0 ? raw.run_attempt : 1,
    status: statusOf(raw.status),
    conclusion: conclusionOf(raw.conclusion),
    createdAt: started ?? 0,
    startedAt: started,
    finishedAt: statusOf(raw.status) === "completed" ? time(raw.completed_at) : null,
    actor: isObject(raw.actor) ? asString(raw.actor.login) : "",
    url: asString(raw.html_url),
    commitUrl: sha === "" ? null : `${webUrlOf4(ref)}/commit/${sha}`
  };
};
var runsOf2 = (ref, body) => {
  const runs = isObject(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
  return runs.map((raw) => mapGiteaRun(ref, raw)).filter((run) => run !== null);
};
var createGiteaClient = (options) => {
  const api = new GiteaApi(options);
  const host = options.host;
  let gate = null;
  const versionOnce = () => {
    if (!gate) {
      gate = api.json("/version").then((body) => isObject(body) && typeof body.version === "string" ? body.version : null).catch(() => null);
    }
    return gate;
  };
  const versionParts = async () => {
    const version = await versionOnce();
    if (version === null)
      return null;
    const match = /^(\d+)\.(\d+)/.exec(version);
    return match ? [version, Number(match[1]), Number(match[2])] : null;
  };
  const requireRuns = async () => {
    const parsed = await versionParts();
    if (parsed === null)
      return;
    const [version, major, minor] = parsed;
    if (major < 1 || major === 1 && minor < 25) {
      throw new ProviderError(`CI Hub needs Gitea 1.25 or newer; ${host} answers ${version}.`, {
        kind: "unsupported"
      });
    }
  };
  const requireReRun = async () => {
    const parsed = await versionParts();
    if (parsed === null) {
      throw new ProviderError(`CI Hub could not verify the Gitea version on ${host}, so re-run is refused.`, {
        kind: "unsupported"
      });
    }
    const [version, major, minor] = parsed;
    if (major < 1 || major === 1 && minor < 26) {
      throw new ProviderError(`Gitea added the re-run APIs in 1.26; ${host} answers ${version}.`, {
        kind: "unsupported"
      });
    }
  };
  const base = (repo) => `/repos/${repo.path.split("/").map(encodeURIComponent).join("/")}`;
  const runParams = (opts, page, limit) => {
    const params = new URLSearchParams;
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (opts.branch)
      params.set("branch", opts.branch);
    if (opts.event)
      params.set("event", opts.event);
    if (opts.actor)
      params.set("actor", opts.actor);
    if (opts.status) {
      const query = STATUS_QUERY3[opts.status];
      if (query)
        params.set("status", query);
    }
    return params.toString();
  };
  const runPathPrefix = (raw) => isObject(raw) ? asString(raw.path).split("@")[0] ?? "" : "";
  const client = {
    async listRuns(repo, opts = {}) {
      await requireRuns();
      const body = await api.json(`${base(repo)}/actions/runs?${runParams(opts, opts.page ?? 1, opts.perPage ?? 50)}`);
      return runsOf2(repo, body);
    },
    async listWorkflowRuns(repo, workflowId, opts = {}) {
      await requireRuns();
      const page = Math.max(1, opts.page ?? 1);
      const perPage = opts.perPage ?? 20;
      const pages = Math.min(GROUP_PAGE_CAP2, Math.ceil(page * perPage / WINDOW3));
      const group = [];
      let lastPageFull = false;
      for (let underlying = 1;underlying <= pages; underlying += 1) {
        const body = await api.json(`${base(repo)}/actions/runs?${runParams(opts, underlying, WINDOW3)}`);
        const items = isObject(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
        lastPageFull = items.length >= WINDOW3;
        for (const raw of items) {
          const run = mapGiteaRun(repo, raw);
          if (run && run.workflowId === workflowId)
            group.push(run);
        }
      }
      let total = group.length;
      if (lastPageFull && pages < GROUP_PAGE_CAP2) {
        const body = await api.json(`${base(repo)}/actions/runs?${runParams(opts, pages + 1, WINDOW3)}`);
        const items = isObject(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
        const more = items.some((raw) => {
          const prefix = runPathPrefix(raw);
          return prefix === workflowId || prefix.endsWith(`/${workflowId}`);
        });
        if (more)
          total = group.length + 1;
      }
      return { runs: group.slice((page - 1) * perPage, page * perPage), total };
    },
    async getRun(repo, runId) {
      await requireRuns();
      const direct = await api.json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}`).then((raw) => mapGiteaRun(repo, raw)).catch((err) => {
        if (err instanceof ProviderError && err.kind === "not-found")
          return null;
        throw err;
      });
      if (direct)
        return direct;
      if (!/^\d+$/.test(runId))
        throw new ProviderError("That run is not readable.", { kind: "unknown" });
      const wanted = Number(runId);
      const body = await api.json(`${base(repo)}/actions/runs?${runParams({}, 1, 50)}`);
      const hit = runsOf2(repo, body).find((run) => run.number === wanted);
      if (hit)
        return hit;
      throw new ProviderError("That run is not readable.", { kind: "unknown" });
    },
    async listJobs(repo, runId) {
      await requireRuns();
      const body = await api.json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs?limit=50`);
      const jobs = isObject(body) && Array.isArray(body.jobs) ? body.jobs : [];
      return jobs.map((raw) => mapJob(runId, raw)).filter((job) => job !== null);
    },
    async getJobLog(repo, jobId, opts = {}) {
      await requireRuns();
      const tailBytes = opts.tailBytes ?? TAIL_BYTES3;
      const response = await api.send(`${base(repo)}/actions/jobs/${encodeURIComponent(jobId)}/logs`);
      let text = await response.text();
      let truncated = false;
      const cap = opts.full ? FULL_TRACE_CAP_BYTES2 : tailBytes;
      const size = byteLength(text);
      if (size > cap) {
        text = sliceByBytes(text, size - cap, size);
        truncated = true;
      }
      if (truncated) {
        const cut = text.indexOf(`
`);
        if (cut !== -1 && cut < 4096 && cut < text.length - 1)
          text = text.slice(cut + 1);
      }
      return { text, truncated };
    },
    async rerunAll(repo, runId) {
      await requireReRun();
      await api.send(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/rerun`, { method: "POST" });
    },
    async rerunFailed(repo, runId) {
      await requireReRun();
      await api.send(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/rerun-failed-jobs`, { method: "POST" });
    },
    async cancel() {
      throw new ProviderError("Gitea has no cancel API; stop the workflow on the server.", { kind: "unsupported" });
    },
    async listWorkflows(repo) {
      await requireRuns();
      const body = await api.json(`${base(repo)}/actions/workflows?limit=50`);
      const list = isObject(body) && Array.isArray(body.workflows) ? body.workflows : [];
      return list.filter(isObject).map((raw) => {
        const path = asString(raw.path);
        const id = asString(raw.id);
        return { id, name: asString(raw.name) || path || id, path, file: id };
      }).filter((workflow) => workflow.id !== "");
    },
    async getDispatchInputs(repo, workflow, ref) {
      await requireRuns();
      const path = `${base(repo)}/contents/${workflow.path.split("/").map(encodeURIComponent).join("/")}`;
      const body = await api.json(`${path}?ref=${encodeURIComponent(ref)}`);
      const yaml = contentsText2(body);
      const dispatchable = hasDispatchTrigger(yaml);
      return {
        dispatchable,
        inputs: parseDispatchInputs(yaml),
        refusal: dispatchable ? null : `This workflow has no workflow_dispatch trigger on ${ref}, so Gitea will refuse to start it.`
      };
    },
    async dispatch(repo, workflowId, ref, inputs) {
      await requireRuns();
      await api.send(`${base(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`, {
        method: "POST",
        body: JSON.stringify({ ref, inputs }),
        headers: { "Content-Type": "application/json" }
      });
    },
    async defaultBranch(repo) {
      await requireRuns();
      const body = await api.json(`${base(repo)}`);
      return isObject(body) ? asString(body.default_branch, "main") : "main";
    }
  };
  return client;
};
var CAPABILITIES3 = {
  rerunAll: "same-run",
  rerunFailed: true,
  cancel: false,
  retryJob: false,
  playManualJob: false,
  dispatch: "workflow-inputs",
  jobDetail: "steps",
  approve: false,
  groupHistory: true
};
var gitea = {
  id: "gitea",
  label: "Gitea",
  words: {
    run: "run",
    runs: "runs",
    workflow: "workflow",
    workflows: "workflows",
    rerunFailed: "Re-run failed jobs",
    rerunFailedShort: "Re-run failed",
    rerunAll: "Re-run all jobs",
    rerunAllShort: "Re-run all",
    cancelDelay: "Gitea takes a few seconds to stop it.",
    logPending: "Gitea publishes the log while the job runs.",
    logMissing: "Gitea has no log for this job (it may have been skipped or cleaned up).",
    dispatchHelp: "Workflows with a workflow_dispatch trigger can be started here.",
    repoPlaceholder: "owner/name or a Gitea URL",
    tokenOrder: "CI Hub looks for a token in this order: the Gitea account connected in OpenChamber, then the token pasted on the CI Hub card (gitea.com only). Watching needs read access; re-runs and starting workflows need repo write.",
    noAccount: "No Gitea account. Connect Gitea in OpenChamber or paste a token on the CI Hub card."
  },
  capabilities: CAPABILITIES3,
  logDialect: "github",
  publicHosts: ["gitea.com"],
  hostPattern: /^gitea\./,
  storeKey: "gitea",
  settingKey: "gitea-token",
  serverSetting: null,
  authSetting: null,
  cli: null,
  apiOrigin: apiOriginFor3,
  repoPath: (segments) => segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null,
  webUrl: webUrlOf4,
  ciUrl: (ref) => `${webUrlOf4(ref)}/actions`,
  parseRunUrl: (url) => {
    const match = url.trim().match(RUN_URL4);
    if (!match)
      return null;
    const host = match[1] ?? "";
    const path = match[2] ?? "";
    const runId = match[3] ?? "";
    if (host === "" || path === "" || runId === "")
      return null;
    return { repo: formatRepoKey({ provider: "gitea", host, path }), runId };
  },
  createClient: createGiteaClient
};

// src/providers/gitlab.ts
class GitLabApi {
  fetchLike;
  token;
  origin;
  now;
  constructor(options) {
    this.fetchLike = options.fetch;
    this.token = options.token;
    this.origin = `https://${options.host}/api/v4`;
    this.now = options.now ?? Date.now;
  }
  url(path, query) {
    const params = new URLSearchParams;
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined)
        params.set(key, String(value));
    }
    const text = params.toString();
    return text === "" ? `${this.origin}${path}` : `${this.origin}${path}?${text}`;
  }
  async send(method, url, headers, body) {
    let response;
    try {
      response = await this.fetchLike(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000)
      });
    } catch (err) {
      throw new ProviderError(err instanceof Error ? `GitLab unreachable: ${err.message}` : "GitLab unreachable", { kind: "network" });
    }
    if (response.status === 401) {
      throw new ProviderError("GitLab rejected the token (401). Reconnect the account.", { kind: "auth", status: 401 });
    }
    if (response.status === 403) {
      throw new ProviderError("GitLab refused the request (403). The token may lack the api scope.", {
        kind: "forbidden",
        status: 403
      });
    }
    if (response.status === 404) {
      throw new ProviderError("GitLab answered 404.", { kind: "not-found", status: 404 });
    }
    if (response.status === 429) {
      throw new ProviderError("GitLab rate limit reached.", {
        kind: "rate-limit",
        status: 429,
        rateLimitReset: this.retryAt(response)
      });
    }
    if (response.status >= 500) {
      throw new ProviderError(`GitLab had a server error (${response.status}).`, {
        kind: "server",
        status: response.status
      });
    }
    return response;
  }
  retryAt(response) {
    const value = response.headers.get("Retry-After");
    if (value !== null) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && value.trim() !== "" && seconds >= 0)
        return this.now() + seconds * 1000;
      const date = Date.parse(value);
      if (Number.isFinite(date))
        return date;
    }
    return this.now() + 60000;
  }
  async request(method, path, query, body) {
    const headers = { Accept: "application/json" };
    if (body !== undefined)
      headers["Content-Type"] = "application/json";
    const response = await this.send(method, this.url(path, query), headers, body);
    const totalHeader = response.headers.get("X-Total");
    const totalNumber = totalHeader === null ? NaN : Number(totalHeader);
    const total = totalHeader !== null && totalHeader !== "" && Number.isFinite(totalNumber) ? totalNumber : null;
    const text = await response.text();
    if (text === "")
      return { data: undefined, total };
    try {
      return { data: JSON.parse(text), total };
    } catch {
      throw new ProviderError(`GitLab answered ${response.status} with a body that is not JSON.`, {
        kind: "unknown",
        status: response.status
      });
    }
  }
  async requestRaw(method, path, headers = {}) {
    const response = await this.send(method, this.url(path), headers);
    const bodyBytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      bodyBytes,
      bodyText: new TextDecoder().decode(bodyBytes),
      header: (name) => response.headers.get(name)
    };
  }
}
var isObject2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var asString2 = (value, fallback = "") => typeof value === "string" ? value : fallback;
var time2 = (value) => {
  if (typeof value !== "string")
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
var STATE2 = {
  created: { status: "queued", conclusion: null },
  preparing: { status: "queued", conclusion: null },
  waiting_for_resource: { status: "queued", conclusion: null },
  pending: { status: "queued", conclusion: null },
  scheduled: { status: "queued", conclusion: null },
  running: { status: "in_progress", conclusion: null },
  manual: { status: "waiting", conclusion: null },
  success: { status: "completed", conclusion: "success" },
  failed: { status: "completed", conclusion: "failure" },
  canceled: { status: "completed", conclusion: "cancelled" },
  skipped: { status: "completed", conclusion: "skipped" }
};
var JOB_STATE = {
  ...STATE2,
  canceling: { status: "in_progress", conclusion: null }
};
var stateOf3 = (table, value) => {
  const found = table[asString2(value)];
  if (found)
    return found;
  return { status: "unknown", conclusion: null };
};
var STATUS_QUERY4 = {
  in_progress: "running",
  failure: "failed",
  success: "success",
  cancelled: "canceled"
};
var webUrlOf5 = (ref) => `https://${ref.host}/${ref.path}`;
var dropPartialFirstLine = (text) => {
  const cut = text.indexOf(`
`);
  return cut !== -1 && cut < 4096 && cut < text.length - 1 ? text.slice(cut + 1) : text;
};
var mapRun2 = (ref, raw) => {
  if (!isObject2(raw))
    return null;
  const id = raw.id;
  if (typeof id !== "number" && typeof id !== "string")
    return null;
  const sha = asString2(raw.sha);
  const state = stateOf3(STATE2, raw.status);
  const name = asString2(raw.name).trim() || asString2(raw.source) || "pipeline";
  return {
    id: String(id),
    provider: "gitlab",
    repo: formatRepoKey(ref),
    number: typeof raw.iid === "number" ? raw.iid : 0,
    workflow: name,
    workflowId: name,
    branch: asString2(raw.ref),
    sha,
    title: "",
    event: asString2(raw.source),
    attempt: 1,
    status: state.status,
    conclusion: state.conclusion,
    createdAt: time2(raw.created_at) ?? 0,
    startedAt: time2(raw.started_at),
    finishedAt: state.status === "completed" ? time2(raw.finished_at) : null,
    actor: isObject2(raw.user) ? asString2(raw.user.username) : "",
    url: asString2(raw.web_url),
    commitUrl: sha === "" ? null : `${webUrlOf5(ref)}/-/commit/${sha}`
  };
};
var mapJob2 = (runId, raw) => {
  if (!isObject2(raw) || raw.id === undefined)
    return null;
  const state = stateOf3(JOB_STATE, raw.status);
  const name = asString2(raw.name) || `job ${String(raw.id)}`;
  return {
    id: String(raw.id),
    runId,
    name: state.conclusion === "failure" && raw.allow_failure === true ? `${name} (allowed to fail)` : name,
    status: state.status,
    conclusion: state.conclusion,
    startedAt: time2(raw.started_at),
    finishedAt: time2(raw.finished_at),
    steps: asString2(raw.stage).trim() === "" ? [] : [{
      number: 1,
      name: asString2(raw.stage).trim(),
      status: state.status,
      conclusion: state.conclusion,
      startedAt: time2(raw.started_at),
      finishedAt: time2(raw.finished_at)
    }],
    url: asString2(raw.web_url)
  };
};
var TRACE_WINDOW_BYTES = 65536;
var FULL_TRACE_CAP_BYTES3 = 1048576;
var TAIL_BYTES4 = 131072;
var GROUP_PAGE_CAP3 = 5;
var encodeProjectId = (id) => id.includes("/") ? encodeURIComponent(id) : id;
var createGitLabClient = (options) => {
  const api = new GitLabApi({ fetch: options.fetch, token: options.token, host: options.host, now: options.now });
  const project = (ref) => encodeProjectId(ref.path);
  const pipelines = (ref) => `/projects/${project(ref)}/pipelines`;
  const runOrFail = (ref, raw, what) => {
    const run = mapRun2(ref, raw);
    if (!run)
      throw new ProviderError(`GitLab returned an unusable ${what}.`, { kind: "unknown" });
    return run;
  };
  const client = {
    async listRuns(ref, listOptions = {}) {
      const status = listOptions.status === undefined ? undefined : STATUS_QUERY4[listOptions.status];
      const { data } = await api.request("GET", pipelines(ref), {
        ref: listOptions.branch,
        username: listOptions.actor,
        status: status === undefined || status === "" ? undefined : status,
        per_page: listOptions.perPage,
        page: listOptions.page
      });
      return (Array.isArray(data) ? data : []).map((raw) => mapRun2(ref, raw)).filter((run) => run !== null);
    },
    async listWorkflowRuns(ref, workflowId, listOptions = {}) {
      const page = Math.max(1, listOptions.page ?? 1);
      const perPage = listOptions.perPage ?? 20;
      const pages = Math.min(GROUP_PAGE_CAP3, Math.ceil(page * perPage / 100));
      const status = listOptions.status === undefined ? undefined : STATUS_QUERY4[listOptions.status];
      const statusQuery = status === undefined || status === "" ? undefined : status;
      const group = [];
      let lastPageFull = false;
      for (let underlying = 1;underlying <= pages; underlying += 1) {
        const { data } = await api.request("GET", pipelines(ref), {
          ref: listOptions.branch,
          username: listOptions.actor,
          status: statusQuery,
          per_page: 100,
          page: underlying
        });
        const items = Array.isArray(data) ? data : [];
        lastPageFull = items.length >= 100;
        for (const raw of items) {
          const run = mapRun2(ref, raw);
          if (run && (run.workflowId || run.workflow) === workflowId)
            group.push(run);
        }
      }
      let total = group.length;
      if (lastPageFull && pages < GROUP_PAGE_CAP3) {
        const { data } = await api.request("GET", pipelines(ref), {
          ref: listOptions.branch,
          username: listOptions.actor,
          status: statusQuery,
          per_page: 100,
          page: pages + 1
        });
        const more = (Array.isArray(data) ? data : []).some((raw) => {
          const run = mapRun2(ref, raw);
          return run !== null && (run.workflowId || run.workflow) === workflowId;
        });
        if (more)
          total = group.length + 1;
      }
      return { runs: group.slice((page - 1) * perPage, page * perPage), total };
    },
    async getRun(ref, runId) {
      const { data } = await api.request("GET", `${pipelines(ref)}/${encodeURIComponent(runId)}`);
      const run = runOrFail(ref, data, "pipeline");
      if (run.sha === "")
        return run;
      try {
        const commit = await api.request("GET", `/projects/${project(ref)}/repository/commits/${encodeURIComponent(run.sha)}`);
        const title = asString2(commit.data?.title).trim();
        if (title !== "")
          run.title = title;
      } catch {}
      return run;
    },
    async listJobs(ref, runId) {
      const { data } = await api.request("GET", `${pipelines(ref)}/${encodeURIComponent(runId)}/jobs`, {
        per_page: 100,
        include_retried: "false"
      });
      return (Array.isArray(data) ? data : []).map((raw) => mapJob2(String(runId), raw)).filter((job) => job !== null);
    },
    async getJobLog(ref, jobId, logOptions = {}) {
      const path = `/projects/${project(ref)}/jobs/${encodeURIComponent(jobId)}/trace`;
      if (logOptions.full) {
        let text2 = "";
        let offset = 0;
        let truncated = false;
        const decoder2 = new TextDecoder;
        while (offset < FULL_TRACE_CAP_BYTES3) {
          const window2 = await api.requestRaw("GET", path, {
            Range: `bytes=${offset}-${offset + TRACE_WINDOW_BYTES - 1}`
          });
          if (window2.status === 416)
            break;
          if (window2.status === 200) {
            text2 = byteLength(window2.bodyText) > FULL_TRACE_CAP_BYTES3 ? sliceByBytes(window2.bodyText, 0, FULL_TRACE_CAP_BYTES3) : window2.bodyText;
            truncated = byteLength(window2.bodyText) > FULL_TRACE_CAP_BYTES3;
            return { text: text2, truncated };
          }
          if (window2.bodyBytes.length === 0)
            break;
          text2 += decoder2.decode(window2.bodyBytes, { stream: true });
          const served = /^bytes (\d+)-(\d+)/.exec(window2.header("Content-Range") ?? "");
          offset += served ? Number(served[2]) - Number(served[1]) + 1 : window2.bodyBytes.length;
        }
        text2 += decoder2.decode();
        if (byteLength(text2) > FULL_TRACE_CAP_BYTES3) {
          text2 = sliceByBytes(text2, 0, FULL_TRACE_CAP_BYTES3);
          truncated = true;
        }
        if (offset >= FULL_TRACE_CAP_BYTES3)
          truncated = true;
        return { text: text2, truncated };
      }
      const tailBytes = logOptions.tailBytes ?? TAIL_BYTES4;
      const probe = await api.requestRaw("GET", path, { Range: "bytes=0-0" });
      const contentRange = probe.header("Content-Range");
      const total = contentRange === null ? null : Number(/^bytes 0-0\/(\d+)$/.exec(contentRange)?.[1]);
      if (contentRange === null) {
        const body = probe.bodyText;
        const size = byteLength(body);
        const text2 = size > tailBytes ? sliceByBytes(body, size - tailBytes, size) : body;
        return { text: size > tailBytes ? dropPartialFirstLine(text2) : text2, truncated: size > tailBytes };
      }
      if (total === null || !Number.isFinite(total))
        return { text: probe.bodyText, truncated: false };
      if (total === 0)
        return { text: "", truncated: false };
      if (total <= tailBytes) {
        const whole = await api.requestRaw("GET", path, { Range: `bytes=0-${total - 1}` });
        return { text: whole.bodyText, truncated: false };
      }
      const tail = await api.requestRaw("GET", path, { Range: `bytes=${total - tailBytes}-${total - 1}` });
      let from = 0;
      while (from < tail.bodyBytes.length && (tail.bodyBytes[from] & 192) === 128)
        from += 1;
      const text = new TextDecoder().decode(tail.bodyBytes.subarray(from));
      return { text: dropPartialFirstLine(text), truncated: true };
    },
    async rerunAll(ref, runId) {
      const { data } = await api.request("GET", `${pipelines(ref)}/${encodeURIComponent(runId)}`);
      const refName = asString2(isObject2(data) ? data.ref : undefined).trim();
      if (refName === "") {
        throw new ProviderError("This pipeline has no branch (a merge request or detached pipeline), so GitLab cannot re-run it. Start a new pipeline on a branch.", { kind: "unknown" });
      }
      await api.request("POST", `/projects/${project(ref)}/pipeline`, undefined, { ref: refName });
    },
    async rerunFailed(ref, runId) {
      await api.request("POST", `${pipelines(ref)}/${encodeURIComponent(runId)}/retry`);
    },
    async cancel(ref, runId) {
      await api.request("POST", `${pipelines(ref)}/${encodeURIComponent(runId)}/cancel`);
    },
    async listWorkflows() {
      return [{ id: "pipelines", name: "Pipelines", path: ".gitlab-ci.yml", file: ".gitlab-ci.yml" }];
    },
    async getDispatchInputs() {
      return { dispatchable: true, inputs: [], refusal: null };
    },
    async dispatch(ref, _workflowId, branch, _inputs) {
      await api.request("POST", `/projects/${project(ref)}/pipeline`, undefined, { ref: branch });
    },
    async defaultBranch(ref) {
      const { data } = await api.request("GET", `/projects/${project(ref)}`);
      return asString2(data?.default_branch).trim() || "main";
    }
  };
  return client;
};
var GITLAB_CAPABILITIES = {
  rerunAll: "new-pipeline",
  rerunFailed: true,
  cancel: true,
  retryJob: false,
  playManualJob: false,
  dispatch: "pipeline-variables",
  jobDetail: "stages",
  approve: false,
  groupHistory: true
};
var GITLAB_WORDS = {
  run: "pipeline",
  runs: "pipelines",
  workflow: "pipeline",
  workflows: "pipelines",
  rerunFailed: "Retry failed jobs",
  rerunFailedShort: "Retry failed",
  rerunAll: "Run pipeline again",
  rerunAllShort: "Run again",
  cancelDelay: "GitLab takes a few seconds to stop it.",
  logPending: "GitLab streams the trace while the job runs.",
  logMissing: "GitLab has no trace for this job (it may have been skipped or erased).",
  dispatchHelp: "Pick a branch or tag; GitLab starts a new pipeline on it.",
  repoPlaceholder: "group/project or a GitLab URL",
  tokenOrder: "CI Hub looks for a token in this order: the GitLab account connected in OpenChamber, the token pasted on the CI Hub card, then the glab CLI (glab auth login). Reading pipelines needs the read_api scope; retry, cancel and starting pipelines need api.",
  noAccount: "No GitLab account. Connect GitLab in OpenChamber, paste a token on the CI Hub card, or run glab auth login."
};
var PIPELINE_URL = /^https?:\/\/([^/]+)\/([^/]+(?:\/[^/]+)+)\/-\/pipelines\/(\d+)/;
var gitlab = {
  id: "gitlab",
  label: "GitLab",
  words: GITLAB_WORDS,
  capabilities: GITLAB_CAPABILITIES,
  logDialect: "gitlab",
  publicHosts: ["gitlab.com"],
  hostPattern: /^gitlab\./,
  storeKey: "gitlab",
  settingKey: "gitlab-token",
  serverSetting: null,
  authSetting: null,
  cli: { program: "glab", tokenArgs: (host) => ["config", "get", "token", "--host", host] },
  apiOrigin: (host) => `https://${host.toLowerCase()}/api/v4`,
  repoPath: (segments) => segments.length >= 2 ? segments.join("/") : null,
  webUrl: (ref) => webUrlOf5(ref),
  ciUrl: (ref) => `${webUrlOf5(ref)}/-/pipelines`,
  parseRunUrl: (url) => {
    const match = PIPELINE_URL.exec(url);
    if (!match)
      return null;
    const key = formatRepoKey({ provider: "gitlab", host: match[1], path: match[2] });
    return parseRepoKey(key) ? { repo: key, runId: match[3] } : null;
  },
  createClient: (options) => createGitLabClient(options)
};

// src/providers/woodpecker.ts
var WINDOW4 = 50;
var TAIL_BYTES5 = 128 * 1024;
var FULL_LOG_CAP_BYTES = 1024 * 1024;
var MAX_JOBS = 100;
var STATUS_FILTER = {
  in_progress: "running",
  failed: "failure",
  succeeded: "success",
  cancelled: "killed"
};
var stateOf4 = (value) => {
  switch (value) {
    case "pending":
    case "created":
      return { status: "queued", conclusion: null };
    case "blocked":
      return { status: "waiting", conclusion: null };
    case "declined":
      return { status: "completed", conclusion: "cancelled" };
    case "running":
      return { status: "in_progress", conclusion: null };
    case "success":
      return { status: "completed", conclusion: "success" };
    case "failure":
    case "error":
      return { status: "completed", conclusion: "failure" };
    case "killed":
    case "canceled":
      return { status: "completed", conclusion: "cancelled" };
    case "skipped":
      return { status: "completed", conclusion: "skipped" };
    default:
      return { status: "unknown", conclusion: null };
  }
};
var unixMs = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value * 1000 : null;
var runUrl = (web, repoId, number) => `${web}/repos/${repoId}/pipeline/${number}`;
var jobIdOf = (number, stepId) => {
  if (typeof number !== "number" || typeof stepId !== "number")
    return null;
  return `${number}-${stepId}`;
};
var splitJobId = (jobId) => {
  const cut = jobId.indexOf("-");
  if (cut <= 0 || cut === jobId.length - 1)
    return null;
  return { number: jobId.slice(0, cut), stepId: jobId.slice(cut + 1) };
};
var decodeEntry = (data) => {
  if (typeof data !== "string")
    return "";
  const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
};
var decodeWoodpeckerLog = (raw) => {
  if (!Array.isArray(raw))
    return "";
  const lines = [];
  for (const entry of raw) {
    if (!isObject(entry))
      continue;
    const type = entry["type"];
    if (type !== 0 && type !== 1 && type !== 2)
      continue;
    lines.push(decodeEntry(entry["data"]));
  }
  return lines.join(`
`);
};
var mapWoodpeckerRun = (raw, web, ref, repoId) => {
  const source = isObject(raw) ? raw : {};
  const { status, conclusion } = stateOf4(asString(source["status"]));
  const number = typeof source["number"] === "number" ? source["number"] : 0;
  const message = asString(source["message"]) || asString(source["title"]);
  return {
    id: String(number),
    provider: "woodpecker",
    repo: formatRepoKey(ref),
    number,
    workflow: "Pipelines",
    workflowId: "pipelines",
    branch: asString(source["branch"]),
    sha: asString(source["commit"]),
    title: message.split(`
`, 1)[0] ?? "",
    event: asString(source["event"]),
    attempt: 1,
    status,
    conclusion,
    createdAt: unixMs(source["created"]) ?? 0,
    startedAt: unixMs(source["started"]),
    finishedAt: unixMs(source["finished"]),
    actor: asString(source["sender"]),
    url: number ? runUrl(web, repoId, String(number)) : "",
    commitUrl: asString(source["forge_url"]) || null
  };
};
var mapWoodpeckerJobs = (raw, web, repoId) => {
  const source = isObject(raw) ? raw : {};
  const number = typeof source["number"] === "number" ? String(source["number"]) : "";
  const jobs = [];
  const workflows = Array.isArray(source["workflows"]) ? source["workflows"] : [];
  for (const workflow of workflows) {
    const children = isObject(workflow) && Array.isArray(workflow["children"]) ? workflow["children"] : [];
    for (const step of children) {
      if (!isObject(step))
        continue;
      if (step["type"] === "clone" || step["type"] === "service")
        continue;
      const { status, conclusion } = stateOf4(asString(step["state"]));
      const id = jobIdOf(source["number"], step["id"]);
      if (!id)
        continue;
      jobs.push({
        id,
        runId: number,
        name: asString(step["name"]),
        status,
        conclusion,
        startedAt: unixMs(step["started"]),
        finishedAt: unixMs(step["finished"]),
        steps: [],
        url: number ? runUrl(web, repoId, number) : ""
      });
      if (jobs.length >= MAX_JOBS)
        return jobs;
    }
  }
  return jobs;
};

class WoodpeckerApi {
  base;
  fetch;
  token;
  repoIds = new Map;
  branches = new Map;
  constructor(opts) {
    this.base = `${opts.origin ?? `https://${opts.host}`}/api`;
    this.fetch = opts.fetch;
    this.token = opts.token;
  }
  async send(path, init) {
    let response;
    try {
      response = await this.fetch(`${this.base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, ...init?.headers ?? {} }
      });
    } catch (cause) {
      throw new ProviderError(`Woodpecker is unreachable: ${String(cause)}`, { kind: "network" });
    }
    if (response.status === 401) {
      throw new ProviderError("The Woodpecker token was rejected (CI Hub card, woodpecker-token).", {
        kind: "auth",
        status: response.status
      });
    }
    if (response.status === 403) {
      throw new ProviderError("The Woodpecker token may not see this repository.", {
        kind: "forbidden",
        status: response.status
      });
    }
    if (response.status === 404) {
      throw new ProviderError("Woodpecker does not know this repository.", {
        kind: "not-found",
        status: response.status
      });
    }
    if (response.status >= 500) {
      throw new ProviderError("The Woodpecker server failed on this request.", {
        kind: "server",
        status: response.status
      });
    }
    if (!response.ok) {
      throw new ProviderError(`Woodpecker answered ${response.status}.`, {
        kind: "unknown",
        status: response.status
      });
    }
    try {
      return await response.json();
    } catch {
      throw new ProviderError(`Woodpecker answered ${response.status} with a body that is not JSON.`, {
        kind: "unknown",
        status: response.status
      });
    }
  }
  path(segments) {
    return segments.map((segment) => encodeURIComponent(segment)).join("/");
  }
  lookupPath(repo) {
    return `/repos/lookup/${this.path(repo.path.split("/"))}`;
  }
  async repoId(repo) {
    const known = this.repoIds.get(repo.path);
    if (known)
      return known;
    const found = await this.send(this.lookupPath(repo));
    const id = typeof found["id"] === "number" ? String(found["id"]) : "";
    if (!id)
      throw new ProviderError("Woodpecker does not know this repository.", { kind: "not-found" });
    this.repoIds.set(repo.path, id);
    this.branches.set(repo.path, asString(found["default_branch"]));
    return id;
  }
  async pipelinesPath(repo) {
    return `/repos/${await this.repoId(repo)}/pipelines`;
  }
  seedRepos(repos) {
    for (const repo of repos)
      this.repoIds.set(repo.path, repo.id);
  }
  repoIdSync(repo) {
    return this.repoIds.get(repo.path) ?? "";
  }
  branchSync(repo) {
    return this.branches.get(repo.path);
  }
}
var createWoodpeckerClient = (opts) => {
  const web = opts.origin ?? `https://${opts.host}`;
  const api = new WoodpeckerApi(opts);
  const client = {
    async listRuns(repo, options) {
      const base = await api.pipelinesPath(repo);
      const params = new URLSearchParams;
      if (options?.branch)
        params.set("branch", options.branch);
      if (options?.event)
        params.set("event", options.event);
      if (options?.status)
        params.set("status", STATUS_FILTER[options.status] ?? options.status);
      const perPage = options?.perPage ?? WINDOW4;
      params.set("perPage", String(perPage));
      params.set("page", String(options?.page ?? 1));
      const query = params.toString();
      const list = await api.send(`${base}${query ? `?${query}` : ""}`);
      return (Array.isArray(list) ? list : []).map((raw) => mapWoodpeckerRun(raw, web, repo, api.repoIdSync(repo)));
    },
    async listWorkflowRuns(repo, workflowId, options) {
      if (workflowId !== "pipelines")
        return { runs: [], total: 0 };
      const perPage = options?.perPage ?? WINDOW4;
      const runs = await this.listRuns(repo, { ...options, perPage });
      const total = runs.length === perPage ? perPage * (options?.page ?? 1) + 1 : runs.length;
      return { runs, total };
    },
    async getRun(repo, runId) {
      const base = await api.pipelinesPath(repo);
      const found = await api.send(`${base}/${encodeURIComponent(runId)}`);
      return mapWoodpeckerRun(found, web, repo, api.repoIdSync(repo));
    },
    async listJobs(repo, runId) {
      const base = await api.pipelinesPath(repo);
      const found = await api.send(`${base}/${encodeURIComponent(runId)}`);
      return mapWoodpeckerJobs(found, web, api.repoIdSync(repo));
    },
    async getJobLog(repo, jobId, options) {
      const parts = splitJobId(jobId);
      if (!parts)
        throw new ProviderError("That job id is not a Woodpecker step.", { kind: "not-found" });
      const repoId = await api.repoId(repo);
      const path = `/repos/${repoId}/logs/${encodeURIComponent(parts.number)}/${encodeURIComponent(parts.stepId)}`;
      const log = await api.send(path);
      let text = decodeWoodpeckerLog(log);
      let truncated = false;
      const tailBytes = options?.tailBytes ?? TAIL_BYTES5;
      const cap = options?.full ? FULL_LOG_CAP_BYTES : tailBytes;
      const bytes = new TextEncoder().encode(text);
      if (bytes.byteLength > cap) {
        const cut = bytes.byteLength - cap;
        text = new TextDecoder("utf-8").decode(bytes.slice(cut));
        truncated = true;
      }
      if (truncated) {
        const newline = text.indexOf(`
`);
        if (newline !== -1 && newline < 4096 && newline < text.length - 1)
          text = text.slice(newline + 1);
      }
      return { text, truncated };
    },
    async rerunAll(repo, runId) {
      const base = await api.pipelinesPath(repo);
      await api.send(`${base}/${encodeURIComponent(runId)}`, { method: "POST" });
    },
    async rerunFailed() {
      throw new ProviderError("Woodpecker has no re-run-failed API; restart the pipeline instead.", {
        kind: "unsupported"
      });
    },
    async cancel(repo, runId) {
      const base = await api.pipelinesPath(repo);
      await api.send(`${base}/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    },
    async approve(repo, runId) {
      const base = await api.pipelinesPath(repo);
      await api.send(`${base}/${encodeURIComponent(runId)}/approve`, { method: "POST" });
    },
    async decline(repo, runId) {
      const base = await api.pipelinesPath(repo);
      await api.send(`${base}/${encodeURIComponent(runId)}/decline`, { method: "POST" });
    },
    async listWorkflows() {
      return [{ id: "pipelines", name: "Pipelines", path: "pipelines", file: "pipelines" }];
    },
    async getDispatchInputs(repo) {
      const repoId = await api.repoId(repo);
      const list = await api.send(`/repos/${repoId}/workflows`);
      const names = (Array.isArray(list) ? list : []).map((entry) => isObject(entry) ? asString(entry["name"]) : null).filter((name) => Boolean(name));
      const inputs = [];
      if (names.length > 1) {
        inputs.push({
          name: "workflow",
          description: "Which pipeline to run; empty runs all of them.",
          required: false,
          default: "",
          type: "choice",
          options: names
        });
      }
      inputs.push({
        name: "variables",
        description: "Pipeline variables, as key/value pairs.",
        required: false,
        default: "",
        type: "variables",
        options: []
      });
      return { dispatchable: true, inputs, refusal: null };
    },
    async dispatch(repo, _workflowId, branch, inputs) {
      const base = await api.pipelinesPath(repo);
      const workflow = inputs?.["workflow"]?.trim();
      await api.send(base, {
        method: "POST",
        body: JSON.stringify({ branch, variables: parseVariablesObject(inputs?.["variables"]), ...workflow ? { workflow } : {} })
      });
    },
    async defaultBranch(repo) {
      const cached = api.branchSync(repo);
      if (cached)
        return cached;
      await api.repoId(repo);
      return api.branchSync(repo) ?? "main";
    },
    async resolveRunUrl(url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      const target = parsed.hash.startsWith("#/") ? parsed.hash.slice(1) : parsed.pathname;
      const match = /^\/repos\/(\d+)(?:\/pipeline\/(\d+))?$/.exec(target);
      if (!match || !match[2])
        return null;
      const found = await api.send(`/repos/${match[1]}`);
      const path = asString(found["full_name"]);
      if (!path)
        return null;
      return { path, runId: match[2] };
    },
    async listServerRepos() {
      const list = await api.send("/user/repos");
      const repos = [];
      for (const entry of Array.isArray(list) ? list : []) {
        if (!isObject(entry))
          continue;
        const path = asString(entry["full_name"]);
        const id = typeof entry["id"] === "number" ? String(entry["id"]) : "";
        if (!path || !id)
          continue;
        const cloneUrls = [asString(entry["clone_url"]), asString(entry["clone_url_ssh"])].filter(Boolean);
        repos.push({ path, id, cloneUrls, forgeUrl: asString(entry["forge_url"]) || null });
      }
      api.seedRepos(repos);
      return repos;
    }
  };
  return client;
};
var WOODPECKER_CAPABILITIES = {
  rerunAll: "new-pipeline",
  rerunFailed: false,
  cancel: true,
  retryJob: false,
  playManualJob: false,
  dispatch: "pipeline-variables",
  jobDetail: "none",
  approve: true,
  groupHistory: true
};
var WOODPECKER_WORDS = {
  run: "pipeline",
  runs: "pipelines",
  workflow: "pipeline",
  workflows: "pipelines",
  rerunFailed: "Retry failed jobs",
  rerunFailedShort: "Retry failed",
  rerunAll: "Restart pipeline",
  rerunAllShort: "Restart",
  cancelDelay: "Woodpecker takes a few seconds to stop it.",
  logPending: "Woodpecker shows the log while the step runs.",
  logMissing: "Woodpecker has no log for this step (it may have been skipped or erased).",
  dispatchHelp: "Pick a branch; Woodpecker starts a manual pipeline on it.",
  repoPlaceholder: "owner/name or a Woodpecker repository URL",
  tokenOrder: "CI Hub reads the woodpecker-token on the CI Hub card for the server set as woodpecker-server. Reading needs a token with repository scope; restart, cancel and manual runs need write.",
  noAccount: "No Woodpecker server. Set woodpecker-server and paste a woodpecker-token on the CI Hub card."
};
var woodpecker = {
  id: "woodpecker",
  label: "Woodpecker",
  words: WOODPECKER_WORDS,
  capabilities: WOODPECKER_CAPABILITIES,
  logDialect: "github",
  publicHosts: [],
  hostPattern: null,
  storeKey: null,
  settingKey: "woodpecker-token",
  serverSetting: "woodpecker-server",
  authSetting: null,
  cli: null,
  apiOrigin: (host) => `https://${host.toLowerCase()}/api`,
  repoPath: (segments) => segments.length === 2 ? segments.join("/") : null,
  webUrl: (ref) => `https://${ref.host.toLowerCase()}/repos/${ref.path}`,
  ciUrl: (ref) => `https://${ref.host.toLowerCase()}/repos/${ref.path}`,
  parseRunUrl: () => null,
  createClient: (options) => createWoodpeckerClient(options)
};

// src/providers/index.ts
var PROVIDERS = [github, gitlab, gitea, forgejo, woodpecker, bitbucket];
var providerFor = (id) => {
  const provider = PROVIDERS.find((entry) => entry.id === id);
  if (!provider)
    throw new Error(`Unknown CI provider: ${id}`);
  return provider;
};
var withoutPort = (host) => host.replace(/:\d+$/, "");
var hostOwner = (host, ssh, known) => {
  for (const provider of PROVIDERS)
    if (provider.publicHosts.includes(host))
      return { provider, host };
  const instance = known.find((entry) => ssh ? withoutPort(entry.host.toLowerCase()) === host : entry.host.toLowerCase() === host);
  if (instance)
    return { provider: providerFor(instance.provider), host: instance.host.toLowerCase() };
  for (const provider of PROVIDERS)
    if (provider.hostPattern?.test(withoutPort(host)))
      return { provider, host };
  return null;
};
var detectRemote = (url, known) => {
  const parts = parseRemote(url);
  if (!parts)
    return null;
  const owner = hostOwner(parts.host, parts.ssh, known);
  if (!owner)
    return null;
  const path = owner.provider.repoPath(parts.segments);
  if (path === null)
    return null;
  const key = formatRepoKey({ provider: owner.provider.id, host: owner.host, path });
  return parseRepoKey(key) ? key : null;
};
var resolveRepoInput = (input, known) => {
  const value = input.trim();
  if (value === "")
    return null;
  const ref = parseRepoKey(value);
  if (ref)
    return formatRepoKey(ref);
  if (value.includes("://") || value.includes("@"))
    return detectRemote(value, known);
  const first = value.split("/")[0] ?? "";
  if (first.includes("."))
    return detectRemote(`https://${value}`, known);
  return legacyRepoKey(value.replace(/\/+$/, "").replace(/\.git$/, ""));
};
var providerView = (provider) => ({
  id: provider.id,
  label: provider.label,
  words: provider.words,
  capabilities: provider.capabilities,
  logDialect: provider.logDialect
});

// src/service/auth.ts
var asRecord2 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
var hostOf2 = (url) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};
var instancesOf = (raw, storeKey) => {
  if (!raw || storeKey === null)
    return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return asRecord2(asRecord2(asRecord2(asRecord2(parsed)?.providers)?.[storeKey])?.instances);
};
var tokenFromStore = (raw, storeKey, host) => {
  const instances = instancesOf(raw, storeKey);
  if (!instances)
    return null;
  for (const [baseUrl, value] of Object.entries(instances)) {
    if (hostOf2(baseUrl) !== host && hostOf2(baseUrl) !== `api.${host}`)
      continue;
    const instance = asRecord2(value);
    const credentials = Array.isArray(instance?.credentials) ? instance.credentials : [];
    const activeId = typeof instance?.activeCredentialId === "string" ? instance.activeCredentialId : null;
    const candidates = credentials.map(asRecord2).filter((entry) => entry !== null).sort((a, b) => Number(b.credentialId === activeId) - Number(a.credentialId === activeId));
    for (const credential of candidates) {
      const status = typeof credential.status === "string" ? credential.status : "valid";
      if (status !== "valid" && status !== "unknown")
        continue;
      const token = credential.token ?? credential.accessToken;
      if (typeof token === "string" && token.trim())
        return token.trim();
    }
  }
  return null;
};
var knownInstances = (raw) => {
  const known = [];
  for (const provider of PROVIDERS) {
    if (provider.storeKey === null)
      continue;
    for (const baseUrl of Object.keys(instancesOf(raw, provider.storeKey) ?? {})) {
      const host = hostOf2(baseUrl);
      if (host && !known.some((entry) => entry.provider === provider.id && entry.host === host))
        known.push({ provider: provider.id, host });
    }
  }
  return known;
};
var missingMessage = (provider, host) => {
  const login = provider.cli ? `${provider.cli.program} auth login` : null;
  if (provider.publicHosts.includes(host)) {
    const ways = [`Connect ${provider.label} in OpenChamber`];
    if (provider.settingKey)
      ways.push(provider.authSetting ? `paste ${provider.settingKey} and ${provider.authSetting} on the CI Hub card` : "paste a token on the CI Hub card");
    if (login)
      ways.push(`run ${login}`);
    const list = ways.length > 1 ? `${ways.slice(0, -1).join(", ")}, or ${ways[ways.length - 1]}` : ways[0];
    return `No ${provider.label} account for ${host}. ${list}.`;
  }
  if (provider.serverSetting && provider.settingKey) {
    return `No ${provider.label} token for ${host}. Set ${provider.serverSetting} and paste ${provider.settingKey} on the CI Hub card.`;
  }
  return `No ${provider.label} account for ${host}. Connect that server in OpenChamber${login ? ` or run ${login} --hostname ${host}` : ""}.`;
};
var serverOf = (settings, provider) => {
  if (!provider.serverSetting)
    return null;
  const raw = settings[provider.serverSetting]?.trim();
  if (!raw)
    return null;
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.pathname && url.pathname !== "/")
      return null;
    return { origin: url.origin, host: url.host.toLowerCase() };
  } catch {
    return null;
  }
};
var resolveToken = async (deps, provider, host) => {
  const stored = tokenFromStore(await deps.readStore().catch(() => {
    return;
  }), provider.storeKey, host);
  if (stored)
    return { token: stored, source: "openchamber" };
  const settings = await deps.readSettings().catch(() => ({}));
  const configuredServer = serverOf(settings, provider)?.host;
  if (provider.settingKey && (provider.publicHosts.includes(host) || configuredServer === host)) {
    const pasted = settings[provider.settingKey]?.trim();
    const companion = provider.authSetting ? settings[provider.authSetting]?.trim() : undefined;
    if (pasted && (!provider.authSetting || companion))
      return { token: pasted, source: "setting" };
  }
  if (provider.cli) {
    const fromCli = (await deps.cliToken(provider.cli.program, provider.cli.tokenArgs(host)).catch(() => null))?.trim();
    if (fromCli)
      return { token: fromCli, source: "cli" };
  }
  return { token: null, source: null, message: missingMessage(provider, host) };
};
var sourceLabel = (source, provider) => source === "openchamber" ? "OpenChamber account" : source === "setting" ? "token on the CI Hub card" : `${provider.cli?.program ?? provider.label} CLI`;

// src/service/engine.ts
class EngineError extends Error {
  status;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
var POLL_FAST_MS = 20000;
var POLL_SLOW_MS = 180000;
var PANEL_WINDOW_MS = 75000;
var STATUS_WINDOW_MS = 60000;
var RECENT_MS = 60 * 60000;
var QUERY_TTL_MS = 15000;
var KNOWN_TTL_MS = 15000;
var HISTORY_PAGE = 20;
var MENTION_TAIL = 2000;
var MENTION_TEXT = 16000;
var describe = (err) => err instanceof ProviderError || err instanceof EngineError ? err.message : err instanceof Error ? err.message : "Something went wrong.";
var accountOf = (provider, host) => `${provider.id}:${host.toLowerCase()}`;
var CAPABLE = {
  "rerun-all": (provider) => provider.capabilities.rerunAll !== null,
  "rerun-failed": (provider) => provider.capabilities.rerunFailed,
  cancel: (provider) => provider.capabilities.cancel,
  approve: (provider) => provider.capabilities.approve,
  decline: (provider) => provider.capabilities.approve
};
var LABELS = PROVIDERS.map((provider) => provider.label).join(" or ");
var createEngine = (deps) => {
  const now = deps.now ?? (() => Date.now());
  const timers = deps.timers ?? {
    set: (fn, ms) => {
      const handle = setTimeout(fn, ms);
      handle.unref?.();
      return handle;
    },
    clear: (handle) => clearTimeout(handle)
  };
  const cache = new Map;
  const CACHE_CAP = 256;
  const evictOldest = (map) => {
    while (map.size > CACHE_CAP) {
      const oldest = map.keys().next().value;
      if (oldest === undefined)
        break;
      map.delete(oldest);
    }
  };
  const detected = new Map;
  const clients = new Map;
  const auths = new Map;
  const rates = new Map;
  let known = null;
  let panelSeenAt = 0;
  let statusSeenAt = 0;
  const statusActions = new Map;
  let statusRepos = new Set;
  let panelRepos = new Set;
  const historyCache = new Map;
  let loop = null;
  let loopDueAt = 0;
  let polling = null;
  let lastConfigMessage;
  let serverList = [];
  const knownHosts = async () => {
    if (known && now() - known.at < KNOWN_TTL_MS)
      return known.list;
    const raw = await deps.auth.readStore().catch(() => {
      return;
    });
    known = { at: now(), list: knownInstances(raw) };
    return known.list;
  };
  const viewOf = (key, directory, enabled, origin) => {
    const ref = parseRepoKey(key);
    if (!ref)
      return null;
    const provider = providerFor(ref.provider);
    const forgeUrl = forgeUrls.get(`${ref.host.toLowerCase()}/${ref.path.toLowerCase()}`);
    return {
      key: formatRepoKey(ref),
      provider: ref.provider,
      name: ref.path,
      webUrl: forgeUrl ?? provider.webUrl(ref),
      ciUrl: provider.ciUrl(ref),
      directory,
      enabled,
      origin
    };
  };
  const targetOf2 = (view) => {
    const ref = parseRepoKey(view.key);
    const provider = providerFor(ref.provider);
    return { key: view.key, ref, provider, account: accountOf(provider, ref.host), view };
  };
  const servers = async () => {
    const settings = await deps.auth.readSettings().catch(() => ({}));
    const out = [];
    for (const provider of PROVIDERS) {
      const server = serverOf(settings, provider);
      if (server)
        out.push({ provider, origin: server.origin, host: server.host });
    }
    serverList = out;
    return out;
  };
  const setAuth = (provider, host, state2) => {
    auths.set(accountOf(provider, host), state2);
    const lower = host.toLowerCase();
    const ownsHost = provider.publicHosts.includes(lower) || serverList.some((s) => s.provider.id === provider.id && s.host === lower);
    if (!provider.settingKey || !ownsHost)
      return;
    const message = state2.ok ? null : state2.message;
    if (message !== lastConfigMessage) {
      lastConfigMessage = message;
      deps.needsConfiguration(message ? message.slice(0, 200) : null);
    }
  };
  const rejected = new Map;
  const rejectedMessage = (provider, source) => `${provider.label} rejected the ${sourceLabel(source, provider)}. Reconnect ${provider.label} in OpenChamber or paste a new token on the CI Hub card.`;
  const clientFor = async (provider, host) => {
    const account = accountOf(provider, host);
    const result = await resolveToken(deps.auth, provider, host);
    if (result.token === null) {
      setAuth(provider, host, { ok: false, source: null, sourceLabel: null, message: result.message });
      throw new EngineError(result.message, 401);
    }
    const label = sourceLabel(result.source, provider);
    if (rejected.get(account)?.has(result.token)) {
      const message = rejectedMessage(provider, result.source);
      setAuth(provider, host, { ok: false, source: result.source, sourceLabel: label, message });
      throw new EngineError(message, 401);
    }
    setAuth(provider, host, { ok: true, source: result.source, sourceLabel: label, message: null });
    const server = (await servers()).find((entry) => entry.provider.id === provider.id && entry.host === host.toLowerCase());
    const origin = server?.origin;
    const settings = await deps.auth.readSettings().catch(() => ({}));
    const user = provider.authSetting ? settings[provider.authSetting]?.trim() || undefined : undefined;
    const existing = clients.get(account);
    if (existing && existing.token === result.token && existing.origin === origin && existing.user === user)
      return existing.client;
    const client = provider.createClient({
      fetch: deps.fetch,
      token: result.token,
      host,
      now,
      ...origin ? { origin } : {},
      ...user ? { user } : {}
    });
    clients.set(account, { token: result.token, client, origin, user });
    return client;
  };
  const SERVER_REPOS_TTL_MS = 15000;
  const serverRepoCache = new Map;
  const serverRepoBusy = new Map;
  const forgeUrls = new Map;
  const serverRepos = async () => {
    const list = await servers();
    return Promise.all(list.map(async (server) => {
      const account = accountOf(server.provider, server.host);
      const cached = serverRepoCache.get(account);
      if (cached && now() - cached.at < SERVER_REPOS_TTL_MS)
        return { ...server, list: cached.list };
      let busy2 = serverRepoBusy.get(account);
      if (!busy2) {
        busy2 = (async () => {
          try {
            const client = await clientFor(server.provider, server.host);
            const repos2 = await client.listServerRepos?.() ?? [];
            serverRepoCache.set(account, { at: now(), list: repos2 });
            for (const repo of repos2) {
              if (repo.forgeUrl)
                forgeUrls.set(`${server.host.toLowerCase()}/${repo.path.toLowerCase()}`, repo.forgeUrl);
            }
            evictOldest(forgeUrls);
            return repos2;
          } catch {
            serverRepoCache.set(account, { at: now(), list: serverRepoCache.get(account)?.list ?? null });
            return serverRepoCache.get(account)?.list ?? null;
          }
        })().finally(() => serverRepoBusy.delete(account));
        serverRepoBusy.set(account, busy2);
      }
      const repos = await busy2;
      return { ...server, list: repos };
    }));
  };
  const identityOf = (remote) => remoteIdentity(remote);
  const hitByIdentity = (identity, repos) => repos.find((repo) => repo.cloneUrls.some((url) => remoteIdentity(url) === identity)) ?? null;
  const hitByPath = (path, repos) => repos.find((repo) => repo.path.toLowerCase() === path.toLowerCase()) ?? null;
  const claim = async (remote) => {
    const all = await serverRepos();
    if (all.length === 0)
      return null;
    const identity = identityOf(remote);
    for (const server of all) {
      if (!server.list)
        continue;
      const hit = identity ? hitByIdentity(identity, server.list) : null;
      if (hit)
        return formatRepoKey({ provider: server.provider.id, host: server.host, path: hit.path });
    }
    if (all.every((entry) => entry.list === null))
      return "pending";
    return null;
  };
  const resolveInput = async (input) => {
    const trimmed = input.trim();
    const asKey = parseRepoKey(trimmed);
    if (asKey)
      return formatRepoKey(asKey);
    if (/\/pipeline\/\d+/.test(trimmed) || /#\//.test(trimmed)) {
      const runParsed = await parseRunUrl(trimmed, await knownHosts());
      if (runParsed)
        return runParsed.repo;
    }
    const all = await serverRepos();
    if (all.length > 0) {
      const candidate = /^[\w.-]+\.[\w.-:]+\//.test(trimmed) ? `https://${trimmed}` : trimmed;
      const parsed = parseRemote(candidate);
      if (parsed) {
        const host = parsed.host.toLowerCase().replace(/:\d+$/, "");
        const segments = (parsed.segments ?? []).filter((segment) => segment.toLowerCase() !== "repos");
        const server = all.find((entry) => entry.host === host);
        if (server && segments.length >= 2) {
          return formatRepoKey({ provider: server.provider.id, host: server.host, path: segments.slice(0, 2).join("/") });
        }
        const identity = identityOf(trimmed);
        if (identity) {
          for (const entry of all) {
            if (!entry.list)
              continue;
            const hit = hitByIdentity(identity, entry.list);
            if (hit)
              return formatRepoKey({ provider: entry.provider.id, host: entry.host, path: hit.path });
          }
        }
      } else {
        const bare = trimmed.replace(/\.git$/i, "").replace(/\/+$/, "");
        if (/^[\w.-]+\/[\w.-]+$/.test(bare)) {
          for (const entry of all) {
            if (!entry.list)
              continue;
            const hit = hitByPath(bare, entry.list);
            if (hit)
              return formatRepoKey({ provider: entry.provider.id, host: entry.host, path: hit.path });
          }
        }
      }
    }
    return resolveRepoInput(trimmed, await knownHosts());
  };
  const observe = (target, err) => {
    if (!(err instanceof ProviderError))
      return;
    if (err.kind === "rate-limit") {
      rates.set(target.account, {
        remaining: 0,
        resetAt: err.rateLimitReset,
        blockedUntil: err.rateLimitReset ?? now() + 60000,
        message: err.message
      });
    } else if (err.kind === "auth") {
      const current = clients.get(target.account);
      const source = auths.get(target.account)?.source ?? null;
      if (current) {
        const set = rejected.get(target.account) ?? new Set;
        set.add(current.token);
        rejected.set(target.account, set);
      }
      if (source) {
        setAuth(target.provider, target.ref.host, {
          ok: false,
          source,
          sourceLabel: sourceLabel(source, target.provider),
          message: rejectedMessage(target.provider, source)
        });
      }
    }
  };
  const blockOf = (account) => {
    const rate = rates.get(account);
    return rate && rate.blockedUntil !== null && rate.blockedUntil > now() ? rate : null;
  };
  const call = async (target, work) => {
    if (blockOf(target.account)) {
      throw new EngineError(`${target.provider.label} rate limit reached; try again after it resets.`, 429);
    }
    const client = await clientFor(target.provider, target.ref.host);
    try {
      return await work(client);
    } catch (err) {
      observe(target, err);
      throw err;
    }
  };
  const accountsFor = async (views, extra = []) => {
    const hosts = new Map;
    for (const key of [...views.filter((view) => view.enabled).map((view) => view.key), ...extra]) {
      const ref = parseRepoKey(key);
      if (!ref)
        continue;
      const provider = providerFor(ref.provider);
      hosts.set(accountOf(provider, ref.host), { provider, host: ref.host });
    }
    if (hosts.size === 0) {
      for (const provider of PROVIDERS) {
        const host = provider.publicHosts[0];
        if (host)
          hosts.set(accountOf(provider, host), { provider, host });
      }
    }
    for (const server of await servers()) {
      hosts.set(accountOf(server.provider, server.host), { provider: server.provider, host: server.host });
    }
    return Promise.all([...hosts].map(async ([account, { provider, host }]) => {
      await clientFor(provider, host).catch(() => {
        return;
      });
      const auth = auths.get(account) ?? { ok: false, source: null, sourceLabel: null, message: null };
      const rate = blockOf(account);
      return { provider: provider.id, host, label: provider.label, ...auth, rateLimit: rate ? { ...rate } : null };
    }));
  };
  const detect = async (directory) => {
    const cached = detected.get(directory);
    if (cached && now() - cached.at < 60000)
      return cached.value;
    const remote = await deps.git(["remote", "get-url", "origin"], directory).catch(() => null);
    const remoteUrl = remote && remote.code === 0 ? remote.stdout.trim() : null;
    let key = null;
    if (remoteUrl)
      key = await claim(remoteUrl);
    if (key === "pending")
      return null;
    if (!key && remoteUrl)
      key = detectRemote(remoteUrl, await knownHosts());
    let value = null;
    if (key) {
      const head = await deps.git(["rev-parse", "--abbrev-ref", "HEAD"], directory).catch(() => null);
      const branch = head && head.code === 0 && head.stdout.trim() !== "HEAD" ? head.stdout.trim() : null;
      value = { key, branch };
    }
    detected.set(directory, { value, at: now() });
    evictOldest(detected);
    return value;
  };
  const settingsRepos = async () => {
    const settings = await deps.auth.readSettings().catch(() => ({}));
    const entries = (settings.repos ?? "").split(/[\s,]+/).map((entry) => entry.trim()).filter((entry) => entry !== "");
    const keys = await Promise.all(entries.map((entry) => resolveInput(entry)));
    return keys.filter((key) => key !== null);
  };
  const listRepos = async (config, includeSettings = true) => {
    const current = config ?? await deps.config.load();
    const out = new Map;
    for (const repo of current.repos) {
      const view = viewOf(repo.key, repo.directory ?? null, repo.enabled, repo.directory ? "detected" : "manual");
      if (view && !out.has(repoKeyId(view.key)))
        out.set(repoKeyId(view.key), view);
    }
    if (includeSettings) {
      for (const key of await settingsRepos()) {
        const view = viewOf(key, null, true, "settings");
        if (view && !out.has(repoKeyId(view.key)))
          out.set(repoKeyId(view.key), view);
      }
    }
    return [...out.values()];
  };
  const repoForDirectory = async (directory) => {
    if (!directory)
      return null;
    const config = await deps.config.load();
    const mapped = config.directoryMap[directory];
    const found = await detect(directory);
    if (mapped)
      return { key: mapped, branch: found?.branch ?? null };
    if (!found)
      return null;
    if (!config.repos.some((entry) => repoKeyId(entry.key) === repoKeyId(found.key))) {
      config.repos.push({ key: found.key, directory, enabled: true, addedAt: now() });
      await deps.config.save(config);
    }
    return found;
  };
  const keyFor = (input, repos) => {
    if (parseRepoKey(input))
      return input;
    const legacy = legacyRepoKey(input);
    if (!legacy)
      return null;
    const path = input.toLowerCase();
    const matches = repos.filter((repo) => parseRepoKey(repo.key)?.path.toLowerCase() === path);
    const exact = matches.find((repo) => repoKeyId(repo.key) === repoKeyId(legacy));
    return (exact ?? matches[0])?.key ?? legacy;
  };
  const keepLegacy = (input) => parseRepoKey(input) || legacyRepoKey(input) ? input : null;
  const repoInfo = async (input) => {
    const repos = await listRepos();
    const key = keyFor(input, repos);
    if (!key)
      throw new EngineError("Unknown repository.");
    const known2 = repos.find((repo) => repoKeyId(repo.key) === repoKeyId(key));
    return targetOf2(known2 ?? viewOf(key, null, true, "manual"));
  };
  const addRepo = async (input, directory = null) => {
    const key = await resolveInput(input.trim());
    if (!key)
      throw new EngineError("Enter the repository as owner/name, a repository URL or a CI Hub repo key.");
    const config = await deps.config.load();
    const existing = config.repos.find((repo) => repoKeyId(repo.key) === repoKeyId(key));
    const target = targetOf2(viewOf(existing?.key ?? key, null, true, "manual"));
    await record("add-repo", target.key, directory ?? input.trim(), async () => {
      await call(target, (client) => client.defaultBranch(target.ref));
      if (existing)
        existing.enabled = true;
      else
        config.repos.push({ key: target.key, enabled: true, addedAt: now() });
      if (directory)
        config.directoryMap[directory] = target.key;
      await deps.config.save(config);
      pollRepo(target.key);
    });
    return listRepos(config);
  };
  const removeRepo = async (input) => {
    const config = await deps.config.load();
    const id = repoKeyId(keyFor(input, await listRepos(config)) ?? input);
    const key = config.repos.find((repo) => repoKeyId(repo.key) === id)?.key ?? input;
    await record("remove-repo", key, input, async () => {
      config.repos = config.repos.flatMap((repo) => {
        if (repoKeyId(repo.key) !== id)
          return [repo];
        return repo.directory ? [{ ...repo, enabled: false }] : [];
      });
      for (const [dir, mapped] of Object.entries(config.directoryMap)) {
        if (repoKeyId(mapped) === id)
          delete config.directoryMap[dir];
      }
      await deps.config.save(config);
      cache.delete(id);
    });
    return listRepos(config);
  };
  const slotFor = (key) => {
    const id = repoKeyId(key);
    let value = cache.get(id);
    if (!value) {
      value = { runs: [], polledAt: null, error: null, defaultBranch: null };
      cache.set(id, value);
    }
    return value;
  };
  const pollRepo = async (key) => {
    const target = await repoInfo(key);
    const slot = slotFor(target.key);
    try {
      slot.runs = await call(target, (client) => client.listRuns(target.ref, { perPage: 40 }));
      slot.error = null;
      if (!slot.defaultBranch) {
        slot.defaultBranch = await call(target, (client) => client.defaultBranch(target.ref)).catch(() => null);
      }
    } catch (err) {
      if (!(err instanceof ProviderError && err.kind === "rate-limit") && !(err instanceof EngineError && err.status === 429)) {
        slot.error = describe(err);
      }
    }
    slot.polledAt = now();
    deps.emit("runs", { repo: target.key, polledAt: slot.polledAt });
  };
  const busy = (slot) => {
    const t = now();
    return slot.runs.some((run) => isActive(run) || t - (run.finishedAt ?? run.createdAt) < RECENT_MS);
  };
  const watched = async () => {
    const t = now();
    const due = new Map;
    const repos = await listRepos();
    if (t - panelSeenAt < PANEL_WINDOW_MS) {
      for (const repo of repos) {
        if (!repo.enabled)
          continue;
        const slot = slotFor(repo.key);
        const hot = slot.polledAt === null || busy(slot) || panelRepos.has(repoKeyId(repo.key));
        if (hot || t - slot.polledAt >= POLL_SLOW_MS)
          due.set(repoKeyId(repo.key), targetOf2(repo));
      }
    }
    if (t - statusSeenAt < STATUS_WINDOW_MS) {
      for (const key of statusRepos) {
        const slot = slotFor(key);
        if (slot.polledAt !== null && t - slot.polledAt < POLL_SLOW_MS - 2000)
          continue;
        const target = await repoInfo(key).catch(() => null);
        if (target)
          due.set(repoKeyId(target.key), target);
      }
    }
    return [...due.values()];
  };
  const interval = () => {
    const t = now();
    if (t - panelSeenAt < PANEL_WINDOW_MS)
      return POLL_FAST_MS;
    if (t - statusSeenAt < STATUS_WINDOW_MS)
      return POLL_SLOW_MS;
    return null;
  };
  const pollAll = async () => {
    if (polling)
      return polling;
    polling = (async () => {
      for (const target of await watched()) {
        if (blockOf(target.account))
          continue;
        await pollRepo(target.key);
      }
    })().finally(() => {
      polling = null;
    });
    return polling;
  };
  function reschedule() {
    const every = interval();
    if (every === null) {
      if (loop)
        timers.clear(loop);
      loop = null;
      loopDueAt = 0;
      return;
    }
    const due = now() + every;
    if (loop && loopDueAt <= due)
      return;
    if (loop)
      timers.clear(loop);
    loopDueAt = due;
    loop = timers.set(() => {
      loop = null;
      loopDueAt = 0;
      pollAll().finally(reschedule);
    }, every);
  }
  const ensureFresh = async (target, maxAge, waitMs) => {
    const slot = slotFor(target.key);
    if (slot.polledAt !== null && now() - slot.polledAt < maxAge)
      return;
    if (blockOf(target.account))
      return;
    const work = pollRepo(target.key);
    await Promise.race([work, new Promise((resolve) => timers.set(resolve, waitMs))]);
  };
  const providers = () => PROVIDERS.map(providerView);
  const state = async (directory) => {
    panelSeenAt = now();
    reschedule();
    const here = await repoForDirectory(directory);
    const repos = await listRepos();
    const accounts = await accountsFor(repos, here ? [here.key] : []);
    const activeKey = here?.key ?? repos.find((repo) => repo.enabled)?.key ?? null;
    const active = activeKey ? await repoInfo(activeKey).catch(() => null) : null;
    let defaultBranch = active ? slotFor(active.key).defaultBranch : null;
    if (active && !defaultBranch && auths.get(active.account)?.ok && !blockOf(active.account)) {
      defaultBranch = await call(active, (client) => client.defaultBranch(active.ref)).catch(() => null);
      slotFor(active.key).defaultBranch = defaultBranch;
    }
    return {
      providers: providers(),
      repos,
      current: here?.key ?? null,
      currentBranch: here?.branch ?? null,
      defaultBranch,
      accounts
    };
  };
  const overview = async (input) => {
    panelSeenAt = now();
    panelRepos = new Set(input.expanded.map(repoKeyId));
    reschedule();
    const folders = new Map;
    for (const project of input.projects)
      if (!folders.has(project.directory))
        folders.set(project.directory, project);
    if (input.directory && !folders.has(input.directory))
      folders.set(input.directory, null);
    const found = await Promise.all([...folders].map(async ([directory, project]) => ({ directory, project, repo: await detect(directory).catch(() => null) })));
    const config = await deps.config.load();
    let changed = false;
    for (const { directory, repo } of found) {
      if (!repo || config.directoryMap[directory])
        continue;
      if (config.repos.some((entry) => repoKeyId(entry.key) === repoKeyId(repo.key)))
        continue;
      config.repos.push({ key: repo.key, directory, enabled: true, addedAt: now() });
      changed = true;
    }
    if (changed)
      await deps.config.save(config);
    const owners = new Map;
    let current = null;
    for (const { directory, project, repo } of found) {
      const key = config.directoryMap[directory] ?? repo?.key;
      if (!key)
        continue;
      if (directory === input.directory)
        current = key;
      const id = repoKeyId(key);
      const known2 = owners.get(id);
      if (!known2 || !known2.project && project)
        owners.set(id, { project, branch: repo?.branch ?? null });
    }
    const views = (await listRepos(config)).filter((repo) => repo.enabled);
    const targets = views.map(targetOf2);
    const accounts = await accountsFor(views);
    const currentView = views.find((repo) => repoKeyId(repo.key) === repoKeyId(current ?? ""));
    const empty = targets.filter((target) => slotFor(target.key).polledAt === null && auths.get(target.account)?.ok && !blockOf(target.account));
    if (empty.length > 0) {
      await Promise.race([
        Promise.all(empty.map((target) => pollRepo(target.key).catch(() => {
          return;
        }))),
        new Promise((resolve) => timers.set(resolve, 8000))
      ]);
    }
    const repos = views.map((repo) => {
      const slot = slotFor(repo.key);
      const owner = owners.get(repoKeyId(repo.key));
      return {
        key: repo.key,
        provider: repo.provider,
        name: repo.name,
        webUrl: repo.webUrl,
        ciUrl: repo.ciUrl,
        project: owner?.project ?? null,
        defaultBranch: slot.defaultBranch,
        currentBranch: owner?.branch ?? null,
        polledAt: slot.polledAt,
        error: slot.error,
        runs: slot.runs
      };
    });
    return { providers: providers(), repos, current: currentView?.key ?? null, accounts };
  };
  const workflowRuns = async (query) => {
    if (!query.workflowId.trim())
      throw new EngineError("Unknown workflow.");
    const target = await repoInfo(query.repo);
    if (!target.provider.capabilities.groupHistory) {
      throw new EngineError(`${target.provider.label} has no per-${target.provider.words.workflow} history.`);
    }
    const page = Math.max(1, Math.floor(query.page) || 1);
    panelSeenAt = now();
    const key = JSON.stringify([repoKeyId(target.key), "workflow", query.workflowId, query.branch ?? "", query.actor ?? "", page]);
    const hit = historyCache.get(key);
    if (hit && now() - hit.at < QUERY_TTL_MS)
      return hit.view;
    const { runs, total } = await call(target, (client) => client.listWorkflowRuns(target.ref, query.workflowId, {
      branch: query.branch,
      actor: query.actor,
      perPage: HISTORY_PAGE,
      page
    }));
    const view = { runs, hasMore: page * HISTORY_PAGE < total && runs.length > 0 };
    const at = now();
    for (const [k, v] of historyCache)
      if (at - v.at >= QUERY_TTL_MS)
        historyCache.delete(k);
    historyCache.set(key, { at, view });
    return view;
  };
  const runDetail = async (repo, runId) => {
    panelSeenAt = now();
    const target = await repoInfo(repo);
    const [run, jobs] = await call(target, (client) => Promise.all([client.getRun(target.ref, runId), client.listJobs(target.ref, runId)]));
    const slot = slotFor(target.key);
    const index = slot.runs.findIndex((entry) => entry.id === run.id);
    if (index >= 0)
      slot.runs[index] = run;
    return { run, jobs };
  };
  const log = async (repo, jobId, full) => {
    const target = await repoInfo(repo);
    const window2 = await call(target, (client) => client.getJobLog(target.ref, jobId, { full }));
    return { text: window2.text, truncated: window2.truncated };
  };
  const mentionsSearch = async (query) => {
    const q = query.trim().toLowerCase();
    if (!q)
      return [];
    const matches = [];
    for (const view of (await listRepos(undefined, false)).filter((repo) => repo.enabled)) {
      const slot = slotFor(view.key);
      if (slot.error !== null || slot.runs.length === 0)
        continue;
      for (const run of slot.runs) {
        const match = String(run.number) === q || [run.title, run.branch, run.workflow, view.name].some((part) => part.toLowerCase().includes(q));
        if (!match)
          continue;
        matches.push({
          createdAt: run.createdAt,
          hit: {
            id: `${view.key}|${run.id}`.slice(0, 256),
            title: `${run.title} · #${run.number}`.slice(0, 120),
            subtitle: `${view.name} · ${run.workflow} · ${run.branch}`.slice(0, 120),
            url: run.url
          }
        });
      }
    }
    return matches.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((entry) => entry.hit);
  };
  const mentionsResolve = async (id) => {
    const cut = id.lastIndexOf("|");
    if (cut <= 0 || cut >= id.length - 1)
      throw new EngineError("That mention does not name a run.");
    let detail;
    try {
      detail = await runDetail(id.slice(0, cut), id.slice(cut + 1));
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "not-found")
        throw new EngineError("That run is not readable.", 404);
      if (err instanceof EngineError)
        throw new EngineError("That run is not readable.", 404);
      throw err;
    }
    const { run, jobs } = detail;
    const lines = [
      `${repoName(run.repo)} · ${run.workflow} #${run.number}`,
      `branch ${run.branch} · status ${run.status}${run.conclusion ? ` · ${run.conclusion}` : ""}`
    ];
    const took = runDuration(run, now());
    if (took !== null)
      lines.push(`duration ${formatDuration(took)}`);
    lines.push(run.url, "");
    const pick = jobs.find((job) => job.conclusion === "failure" || job.conclusion === "timed_out" || job.conclusion === "startup_failure") ?? jobs.find((job) => job.status !== "completed") ?? null;
    if (!pick)
      lines.push("No failing or running job.");
    else {
      const window2 = await log(run.repo, pick.id, false).catch(() => null);
      if (!window2)
        lines.push(`The log of job "${pick.name}" could not be read.`);
      else {
        const clipped = window2.text.length > MENTION_TAIL ? `…${window2.text.slice(-MENTION_TAIL)}` : window2.text;
        lines.push(`Last of the job "${pick.name}":`, clipped);
      }
    }
    return lines.join(`
`).slice(0, MENTION_TEXT);
  };
  const record = async (action, repo, target, work) => {
    try {
      await work();
      await deps.audit({ at: now(), action, repo, target, ok: true });
    } catch (err) {
      await deps.audit({ at: now(), action, repo, target, ok: false, message: describe(err) });
      throw err;
    }
  };
  const followUp = (key) => {
    const prefix = JSON.stringify([repoKeyId(key)]).slice(0, -1);
    for (const entry of historyCache.keys())
      if (entry.startsWith(prefix))
        historyCache.delete(entry);
    pollRepo(key).catch(() => {
      return;
    });
    timers.set(() => void pollRepo(key).catch(() => {
      return;
    }), 5000);
    timers.set(() => void pollRepo(key).catch(() => {
      return;
    }), 15000);
  };
  const runAction = async (kind, repo, runId) => {
    if (!/^[\w-]+$/.test(runId))
      throw new EngineError("Unknown run.");
    const target = await repoInfo(repo);
    if (!CAPABLE[kind](target.provider))
      throw new EngineError(`${target.provider.label} cannot ${kind} runs.`, 400);
    await record(kind, target.key, runId, () => call(target, (client) => {
      if (kind === "rerun-all")
        return client.rerunAll(target.ref, runId);
      if (kind === "rerun-failed")
        return client.rerunFailed(target.ref, runId);
      if (kind === "cancel")
        return client.cancel(target.ref, runId);
      if (kind === "approve") {
        if (!client.approve)
          throw new EngineError(`${target.provider.label} cannot approve runs.`, 400);
        return client.approve(target.ref, runId);
      }
      if (!client.decline)
        throw new EngineError(`${target.provider.label} cannot decline runs.`, 400);
      return client.decline(target.ref, runId);
    }));
    followUp(target.key);
  };
  const workflows = async (repo) => {
    const target = await repoInfo(repo);
    const [list, branch] = await call(target, (client) => Promise.all([client.listWorkflows(target.ref), client.defaultBranch(target.ref)]));
    return { workflows: list, defaultBranch: branch };
  };
  const dispatchInputs = async (repo, workflowId, ref) => {
    const target = await repoInfo(repo);
    return call(target, async (client) => {
      const list = await client.listWorkflows(target.ref);
      const workflow = list.find((entry) => entry.id === workflowId);
      if (!workflow)
        throw new EngineError(`That ${target.provider.words.workflow} no longer exists.`, 404);
      return client.getDispatchInputs(target.ref, workflow, ref);
    });
  };
  const dispatch = async (repo, workflowId, ref, inputs) => {
    if (!ref.trim())
      throw new EngineError("Choose a branch or tag to run on.");
    const target = await repoInfo(repo);
    if (!target.provider.capabilities.dispatch) {
      throw new EngineError(`${target.provider.label} ${target.provider.words.workflows} cannot be started from CI Hub.`);
    }
    await record("dispatch", target.key, `${workflowId}@${ref}`, () => call(target, (client) => client.dispatch(target.ref, workflowId, ref.trim(), inputs)));
    followUp(target.key);
  };
  const handoff = async (repo, runId, jobId) => {
    const { run, jobs } = await runDetail(repo, runId);
    const job = (jobId ? jobs.find((entry) => entry.id === jobId) : null) ?? focusJob(jobs);
    const target = await repoInfo(repo);
    let text = null;
    let truncated = false;
    if (job) {
      const window2 = await call(target, (client) => client.getJobLog(target.ref, job.id, {})).catch(() => null);
      text = window2?.text ?? null;
      truncated = window2?.truncated ?? false;
    }
    const built = buildHandoff({ run, jobs, job, log: text, logTruncated: truncated });
    return { ...built, id: `${run.repo}#${run.id}`, branch: run.branch, sha: run.sha, directory: target.view.directory };
  };
  const status = async (directory) => {
    statusSeenAt = now();
    const here = await repoForDirectory(directory).catch(() => null);
    const target = here ? await repoInfo(here.key).catch(() => null) : null;
    statusRepos = new Set(target ? [target.key] : []);
    reschedule();
    const provider = target?.provider ?? PROVIDERS[0];
    const host = target?.ref.host ?? provider.publicHosts[0] ?? "";
    let authProblem = null;
    try {
      await clientFor(provider, host);
      const auth = auths.get(accountOf(provider, host));
      if (auth && !auth.ok)
        authProblem = auth.message;
    } catch (err) {
      authProblem = describe(err);
    }
    if (!authProblem && target) {
      await ensureFresh(target, POLL_SLOW_MS, 4000).catch(() => {
        return;
      });
    }
    const slot = target ? slotFor(target.key) : null;
    const branches = new Set([slot?.defaultBranch, here?.branch].filter((b) => !!b));
    const snapshots = target && slot ? [
      {
        key: target.key,
        runs: branches.size > 0 ? slot.runs.filter((run) => branches.has(run.branch)) : slot.runs,
        polledAt: slot.polledAt,
        error: slot.error
      }
    ] : [];
    const rate = blockOf(accountOf(provider, host));
    const built = buildStatusView({
      authProblem,
      repos: snapshots,
      blocked: rate ? { label: provider.label, until: rate.blockedUntil } : null,
      noRepoText: `No ${LABELS} repository for this project. Open CI Hub in the sidebar to add one.`,
      now: now()
    });
    statusActions.clear();
    for (const [id, target2] of built.actions)
      statusActions.set(id, target2);
    return built.view;
  };
  const statusAction = async (id) => {
    const mapped = statusActions.get(id);
    if (mapped) {
      await runAction("rerun-failed", mapped.repo, mapped.runId);
      return;
    }
    const action = readStatusActionId(id, keepLegacy);
    if (!action)
      throw new EngineError("Unknown action.");
    if (action.kind === "refresh") {
      for (const key of statusRepos)
        await pollRepo(key);
      return;
    }
    await runAction("rerun-failed", action.repo, action.runId);
  };
  const parseRunUrl = async (url, hosts = []) => {
    let host = null;
    try {
      host = new URL(url).host.toLowerCase();
    } catch {
      return null;
    }
    const instance = hosts.find((entry) => entry.host === host);
    const candidates = [
      ...PROVIDERS.filter((provider) => provider.publicHosts.includes(host)),
      ...instance ? [providerFor(instance.provider)] : [],
      ...PROVIDERS.filter((provider) => provider.hostPattern?.test(host) ?? false)
    ];
    for (const provider of candidates) {
      const found = provider.parseRunUrl(url);
      if (found)
        return found;
    }
    for (const server of await servers()) {
      if (server.host !== host)
        continue;
      const client = await clientFor(server.provider, server.host);
      const found = await client.resolveRunUrl?.(url);
      if (found)
        return { repo: formatRepoKey({ provider: server.provider.id, host: server.host, path: found.path }), runId: found.runId };
    }
    return null;
  };
  const waitStart = async (args, directory = null) => {
    const hosts = await knownHosts();
    let parsed;
    try {
      parsed = await readWaitArgs(args, (url) => parseRunUrl(url, hosts), (input) => resolveInput(input));
    } catch (err) {
      return { ok: false, error: describe(err).slice(0, 500) };
    }
    try {
      const key = parsed.repo ?? (await repoForDirectory(directory).catch(() => null))?.key;
      if (!key) {
        return {
          ok: false,
          error: `This session's folder has no ${LABELS} remote; pass repo as owner/name or a repository URL.`
        };
      }
      const target = await repoInfo(key);
      const run = await call(target, (client) => client.getRun(target.ref, parsed.runId));
      const state2 = {
        repo: target.key,
        runId: run.id,
        conclusion: parsed.conclusion,
        attempt: run.attempt,
        number: run.number,
        workflow: run.workflow
      };
      return { ok: true, state: state2, label: waitLabel(run) };
    } catch (err) {
      return { ok: false, error: describe(err).slice(0, 500) };
    }
  };
  const checkOne = async (id, rawState) => {
    const state2 = readWaitState(rawState, keepLegacy);
    if (!state2)
      return { id, fired: true, summary: `CI Hub lost track of this wait; check the run on ${LABELS}.` };
    const target = await repoInfo(state2.repo).catch(() => null);
    if (!target)
      return { id, fired: true, summary: `CI Hub lost track of this wait; check the run on ${LABELS}.` };
    try {
      const run = await call(target, (client) => client.getRun(target.ref, state2.runId));
      const jobs = state2.conclusion || run.status === "completed" ? await call(target, (client) => client.listJobs(target.ref, state2.runId)).catch(() => null) : null;
      const verdict = judgeWait(state2, run, jobs);
      if (!verdict.fired)
        return { id, fired: false };
      let excerpt = null;
      const failed = jobs ? focusJob(jobs) : null;
      if (failed && failed.conclusion && failed.conclusion !== "success") {
        const window2 = await call(target, (client) => client.getJobLog(target.ref, failed.id, {})).catch(() => null);
        if (window2)
          excerpt = errorExcerpt(window2.text, { maxLines: 30, context: 3 }, target.provider.logDialect).lines;
      }
      return { id, fired: true, summary: waitSummary(run, jobs ?? [], verdict.early, excerpt) };
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "not-found") {
        return {
          id,
          fired: true,
          summary: `CI run ${state2.runId} on ${repoName(state2.repo)} is gone (${target.provider.label} answered 404).`
        };
      }
      return { id, fired: false };
    }
  };
  const waitCheck = async (waits) => {
    const results = [];
    for (const wait of waits)
      results.push(await checkOne(wait.id, wait.state));
    return results;
  };
  const stop = () => {
    if (loop)
      timers.clear(loop);
    loop = null;
  };
  return {
    state,
    overview,
    workflowRuns,
    runDetail,
    log,
    mentionsSearch,
    mentionsResolve,
    addRepo,
    removeRepo,
    runAction,
    workflows,
    dispatchInputs,
    dispatch,
    handoff,
    status,
    statusAction,
    waitStart,
    waitCheck,
    pollAll,
    stop,
    debug: () => ({
      panelSeenAt,
      statusSeenAt,
      interval: interval(),
      rates: Object.fromEntries([...rates].map(([account, rate]) => [account, { ...rate }])),
      active: [...cache.keys()]
    })
  };
};

// src/service/routes.ts
var ok = (body) => ({ status: 200, body });
var fail = (status, error, extra = {}) => ({
  status,
  body: { error, message: error, ...extra }
});
var readJson = (body) => {
  if (!body.trim())
    return {};
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    throw new EngineError("Request body is not JSON.");
  }
};
var str = (value) => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
var required = (value, name) => {
  if (!value)
    throw new EngineError(`Missing ${name}.`);
  return value;
};
var toResponse = (err) => {
  if (err instanceof EngineError)
    return fail(err.status, err.message);
  if (err instanceof ProviderError) {
    const status = err.kind === "auth" ? 401 : err.kind === "not-found" ? 404 : err.kind === "rate-limit" ? 429 : err.kind === "forbidden" ? 403 : 502;
    return fail(status, err.message, { kind: err.kind, retryAt: err.rateLimitReset ?? null });
  }
  console.error("[ci-hub] unexpected error", err);
  return fail(500, "CI Hub hit an unexpected error; see the service log.");
};
var handleRequest = async (request, engine) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const q = (name) => url.searchParams.get(name) ?? "";
  const method = request.method.toUpperCase();
  const path = url.pathname;
  try {
    if (method === "GET" && path === "/health")
      return ok({ ok: true, ...engine.debug() });
    if (path === WAITS_START_PATH && method === "POST") {
      const parsed = readWaitStartRequest(request.body);
      if (!parsed)
        return fail(400, "Malformed wait request.");
      return ok(await engine.waitStart(parsed.wait.args, parsed.wait.session.directory));
    }
    if (path === WAITS_CHECK_PATH && method === "POST") {
      const parsed = readWaitCheckRequest(request.body);
      if (!parsed)
        return fail(400, "Malformed wait request.");
      return ok({ results: await engine.waitCheck(parsed.waits) });
    }
    if (path === MENTIONS_SEARCH_PATH && method === "POST") {
      const body = readJson(request.body);
      return ok({ items: await engine.mentionsSearch(str(body.query)) });
    }
    if (path === MENTIONS_RESOLVE_PATH && method === "POST") {
      const body = readJson(request.body);
      return ok({ text: await engine.mentionsResolve(required(str(body.id), "id")) });
    }
    if (path === "/status") {
      if (method === "GET")
        return ok(await engine.status(q("directory") || null));
      if (method === "POST") {
        const body = readJson(request.body);
        await engine.statusAction(required(str(body.id), "id"));
        return ok({ ok: true });
      }
    }
    if (method === "GET" && path === "/state")
      return ok(await engine.state(q("directory") || null));
    if (method === "POST" && path === "/overview") {
      const body = readJson(request.body);
      if (!Array.isArray(body.projects))
        throw new EngineError("projects must be a list.");
      const projects = body.projects.filter((entry) => !!entry && typeof entry === "object").map((entry) => ({ id: str(entry.id), name: str(entry.name), directory: str(entry.directory) })).filter((entry) => entry.directory.startsWith("/")).slice(0, 200);
      const expanded = Array.isArray(body.expanded) ? body.expanded.map(str).filter(Boolean).slice(0, 200) : [];
      return ok(await engine.overview({ directory: str(body.directory) || null, projects, expanded }));
    }
    if (method === "GET" && path === "/workflow-runs") {
      return ok(await engine.workflowRuns({
        repo: required(q("repo"), "repo"),
        workflowId: required(q("workflow"), "workflow"),
        branch: q("branch") || undefined,
        actor: q("actor") || undefined,
        page: Number(q("page")) || 1
      }));
    }
    if (path === "/repos") {
      const body = readJson(request.body);
      if (method === "POST") {
        return ok({ repos: await engine.addRepo(required(str(body.repo), "repo"), str(body.directory) || null) });
      }
      if (method === "DELETE")
        return ok({ repos: await engine.removeRepo(required(str(body.repo) || q("repo"), "repo")) });
    }
    if (method === "GET" && path === "/run") {
      return ok(await engine.runDetail(required(q("repo"), "repo"), required(q("id"), "id")));
    }
    if (method === "GET" && path === "/log") {
      return ok(await engine.log(required(q("repo"), "repo"), required(q("job"), "job"), q("full") === "1"));
    }
    if (method === "POST" && path === "/action") {
      const body = readJson(request.body);
      const raw = str(body.kind);
      const kind = raw === "rerun" ? "rerun-all" : raw;
      if (kind !== "rerun-all" && kind !== "rerun-failed" && kind !== "cancel" && kind !== "approve" && kind !== "decline")
        throw new EngineError("Unknown action.");
      await engine.runAction(kind, required(str(body.repo), "repo"), required(str(body.runId), "runId"));
      return ok({ ok: true });
    }
    if (method === "GET" && path === "/workflows")
      return ok(await engine.workflows(required(q("repo"), "repo")));
    if (method === "GET" && path === "/dispatch-inputs") {
      return ok(await engine.dispatchInputs(required(q("repo"), "repo"), required(q("workflow"), "workflow"), required(q("ref"), "ref")));
    }
    if (method === "POST" && path === "/dispatch") {
      const body = readJson(request.body);
      const raw = body.inputs && typeof body.inputs === "object" ? body.inputs : {};
      const inputs = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, str(value)]));
      await engine.dispatch(required(str(body.repo), "repo"), required(str(body.workflowId), "workflowId"), str(body.ref), inputs);
      return ok({ ok: true });
    }
    if (method === "GET" && path === "/handoff") {
      return ok(await engine.handoff(required(q("repo"), "repo"), required(q("runId"), "runId"), q("job") || null));
    }
    return fail(404, `No route for ${method} ${path}.`);
  } catch (err) {
    return toResponse(err);
  }
};

// service/main.ts
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!Number.isInteger(port) || port <= 0 || !token) {
  console.error("[ci-hub] OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required");
  process.exit(1);
}
var home = homedir();
var dataDir = process.env.OPENCHAMBER_SERVICE_DATA_DIR || join2(home, ".openchamber-ci-hub");
var storePath = join2(home, ".config", "openchamber", "source-control-auth.json");
var MAX_BODY_BYTES = 256 * 1024;
var host = process.env.OPENCHAMBER_HOST_CALLBACK_URL ? createServiceHost({ env: process.env }) : null;
var run = (program, args, cwd) => new Promise((resolve) => {
  execFile(program, args, { cwd, timeout: 1e4, maxBuffer: 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
    const code = err ? typeof err.code === "number" ? Number(err.code) : -1 : 0;
    resolve({ code, stdout: String(stdout), stderr: String(stderr) });
  });
});
var CLI_PROGRAMS = new Set(["gh", "glab"]);
var cliCache = new Map;
var cliToken = async (program, args) => {
  if (!CLI_PROGRAMS.has(program))
    return null;
  const key = [program, ...args].join("\x00");
  const hit = cliCache.get(key);
  if (hit && Date.now() - hit.at < 60000)
    return hit.value;
  const result = await run(program, args);
  const value = result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  cliCache.set(key, { value, at: Date.now() });
  return value;
};
var warnedStore = false;
var readStore = async () => {
  try {
    return await readFile2(storePath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT" && !warnedStore) {
      warnedStore = true;
      console.warn("[ci-hub] could not read the OpenChamber credential store:", err.message);
    }
    return;
  }
};
var engine = createEngine({
  config: createFileConfigStore(dataDir),
  audit: createFileAudit(dataDir),
  auth: {
    readStore,
    readSettings: async () => host ? host.readSettings() : {},
    cliToken
  },
  fetch: (input, init) => fetch(input, init),
  git: (args, cwd) => run("git", args, cwd),
  emit: (topic, data) => {
    host?.emit(topic, data).catch(() => {
      return;
    });
  },
  needsConfiguration: (message) => {
    host?.needsConfiguration(message).catch(() => {
      return;
    });
  }
});
var readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(new Error("body too large"));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});
var server = createServer(async (req, res) => {
  const reply = (status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
    res.end(text);
  };
  if (req.headers.authorization !== `Bearer ${token}`)
    return reply(401, { error: "unauthorized" });
  try {
    const body = await readBody(req);
    const result = await handleRequest({ method: req.method ?? "GET", url: req.url ?? "/", body }, engine);
    reply(result.status, result.body);
  } catch (err) {
    console.error("[ci-hub] request failed", err);
    reply(500, { error: "internal" });
  }
});
server.on("error", (err) => {
  console.error("[ci-hub] server error", err);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`[ci-hub] listening on 127.0.0.1:${port}`);
});
var shutdown = () => {
  engine.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
