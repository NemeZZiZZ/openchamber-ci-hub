// Log post-processing, one dialect per provider. GitHub Actions logs are plain
// text with `##[group]` markers and an inline timestamp per line; GitLab job
// traces are ANSI-coloured, fold into `section_start`/`section_end` sections
// and redraw progress lines with a bare `\r`. The panel shows them collapsed;
// the agent handoff gets a focused excerpt instead of the whole blob.

import type { LogDialect } from './types.ts';

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/;
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const LINE_END = /\r?\n/;

export interface LogLine {
  text: string;
  /** 0 for top level, 1 inside a group or section. */
  depth: number;
  group: string | null;
  tone: 'normal' | 'error' | 'warning' | 'command' | 'group';
}

export const stripTimestamp = (line: string): string => line.replace(TIMESTAMP, '');

export const stripAnsi = (text: string): string => text.replace(ANSI_OSC, '').replace(ANSI_CSI, '');

// ---- UTF-8 sizes -----------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The size a string has on the wire and in HTTP byte ranges. */
export const byteLength = (text: string): number => encoder.encode(text).length;

/**
 * A slice by UTF-8 bytes, as the API sees them. An end that would cut a code
 * point in half moves back to its start, so the result is always valid text.
 */
export const sliceByBytes = (text: string, start: number, end: number): string => {
  const bytes = encoder.encode(text);
  let stop = Math.min(Math.max(end, 0), bytes.length);
  while (stop > 0 && stop < bytes.length && (bytes[stop]! & 0xc0) === 0x80) stop -= 1;
  let from = Math.min(Math.max(start, 0), stop);
  while (from > 0 && (bytes[from]! & 0xc0) === 0x80) from -= 1;
  return decoder.decode(bytes.subarray(from, stop));
};

/** Lines of a trace; a trailing newline does not make an empty last line. */
const traceLines = (raw: string): string[] => {
  const lines = raw.split(LINE_END);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
};

/**
 * Collapse GitHub's group markers into a depth, and mark the lines that
 * matter. `::error` workflow commands and `##[error]` both count.
 */
const parseGroupMarkers = (raw: string): LogLine[] => {
  const out: LogLine[] = [];
  let depth = 0;
  let group: string | null = null;

  for (const rawLine of raw.split(LINE_END)) {
    const line = stripTimestamp(rawLine);
    const groupStart = /^##\[group\](.*)$/.exec(line);
    if (groupStart) {
      out.push({ text: groupStart[1]!.trim(), depth, group: null, tone: 'group' });
      group = groupStart[1]!.trim();
      depth = Math.min(1, depth + 1);
      continue;
    }
    if (/^##\[endgroup\]/.test(line)) {
      depth = Math.max(0, depth - 1);
      if (depth === 0) group = null;
      continue;
    }
    const section = /^##\[(error|warning|command)\](.*)$/.exec(line);
    if (section) {
      out.push({
        text: section[2]!.trim(),
        depth,
        group,
        tone: section[1] as 'error' | 'warning' | 'command',
      });
      continue;
    }
    const command = /^::(error|warning)(?: [^:]*)?::(.*)$/.exec(line);
    if (command) {
      out.push({
        text: command[2]!.trim(),
        depth,
        group,
        tone: command[1] as 'error' | 'warning',
      });
      continue;
    }
    out.push({ text: line, depth, group, tone: 'normal' });
  }
  return out;
};

const SECTION_START = /^section_start:\d+:([^[\r\s]+)(?:\[[^\]]*\])?\r?(.*)$/;
const SECTION_END = /^section_end:\d+:[^\r]*\r?(.*)$/;

/** What a terminal would show for a line redrawn with `\r`: its last non-empty frame. */
const lastFrame = (line: string): string => {
  const frames = line.split('\r');
  for (let i = frames.length - 1; i >= 0; i -= 1) if (frames[i]!.trim() !== '') return frames[i]!;
  return '';
};

const gitlabTone = (text: string): LogLine['tone'] => {
  if (/^(?:ERROR|error):/.test(text)) return 'error';
  if (/^WARNING:/.test(text)) return 'warning';
  if (/^\$ /.test(text)) return 'command';
  return 'normal';
};

const parseGitLab = (raw: string): LogLine[] => {
  const out: LogLine[] = [];
  const open: string[] = [];

  const take = (line: string): void => {
    const start = SECTION_START.exec(line);
    if (start) {
      const header = lastFrame(start[2]!).trim() || start[1]!;
      out.push({ text: header, depth: Math.min(1, open.length), group: open.at(-1) ?? null, tone: 'group' });
      open.push(header);
      return;
    }
    const end = SECTION_END.exec(line);
    if (end) {
      open.pop();
      // GitLab often writes the next section's start right after an end.
      if (end[1]!.trim() !== '') take(end[1]!);
      return;
    }
    const text = lastFrame(line);
    out.push({ text, depth: Math.min(1, open.length), group: open.at(-1) ?? null, tone: gitlabTone(text) });
  };

  for (const line of traceLines(raw)) take(stripAnsi(line));
  return out;
};

const parsePlain = (raw: string): LogLine[] =>
  traceLines(raw).map((text): LogLine => ({ text, depth: 0, group: null, tone: 'normal' }));

export const parseLog = (raw: string, dialect: LogDialect = 'github'): LogLine[] => {
  if (dialect === 'gitlab') return parseGitLab(raw);
  if (dialect === 'plain') return parsePlain(raw);
  return parseGroupMarkers(raw);
};

const ERROR_PATTERNS: RegExp[] = [
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
  /\bsegmentation fault\b/i,
];

export const looksLikeError = (line: string): boolean => ERROR_PATTERNS.some((re) => re.test(line));

export interface Excerpt {
  lines: string[];
  truncated: boolean;
}

export interface ExcerptOptions {
  maxLines?: number;
  context?: number;
  maxBytes?: number;
}

// Every failed job ends with a generic exit line (GitHub: "Process completed
// with exit code N", GitLab: "ERROR: Job failed: exit code N"); the cause sits
// above it, so that line only counts when nothing else does.
const GENERIC_EXIT: Record<LogDialect, RegExp> = {
  github: /Process completed with exit code/,
  gitlab: /^ERROR: Job failed: exit code/,
  plain: /Process completed with exit code|^ERROR: Job failed: exit code/,
};

const excerptLines = (raw: string, dialect: LogDialect): string[] => {
  if (dialect === 'gitlab') return parseGitLab(raw).map((line) => line.text);
  if (dialect === 'plain') return raw.split(LINE_END);
  return raw.split(LINE_END).map(stripTimestamp);
};

/**
 * The first interesting failure plus context, capped so a prompt stays small.
 * When nothing matches, the tail is more useful than the head.
 */
export const errorExcerpt = (raw: string, options?: ExcerptOptions, dialect: LogDialect = 'github'): Excerpt => {
  const maxLines = options?.maxLines ?? 120;
  const context = options?.context ?? 12;
  const lines = excerptLines(raw, dialect);
  const cap = (picked: string[]): Excerpt =>
    picked.length > maxLines
      ? { lines: picked.slice(0, maxLines), truncated: true }
      : { lines: picked, truncated: false };

  const maxBytes = options?.maxBytes ?? 8 * 1024;
  const generic = (line: string) => GENERIC_EXIT[dialect].test(line);
  let first = lines.findIndex((line) => line.trim() !== '' && looksLikeError(line) && !generic(line));
  if (first === -1) first = lines.findIndex((line) => looksLikeError(line) && line.trim() !== '');
  if (first === -1) {
    return capBytes(cap(lines.slice(-Math.min(maxLines, lines.length))), maxBytes);
  }

  const start = Math.max(0, first - context);
  const taken = lines.slice(start, Math.min(lines.length, first + maxLines - context));
  const head = start > 0 ? [`… ${start} earlier lines omitted …`, ...taken] : taken;
  return capBytes({ lines: head, truncated: start > 0 || taken.length < lines.length - start }, maxBytes);
};

const capBytes = (excerpt: Excerpt, maxBytes: number): Excerpt => {
  let size = 0;
  const kept: string[] = [];
  for (const line of excerpt.lines) {
    size += line.length + 1;
    if (size > maxBytes) return { lines: kept, truncated: true };
    kept.push(line);
  }
  return excerpt;
};

/** A short, readable size for the log header. */
export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
