// The only way UI code reaches a CI host: through the extension's service, which
// holds the token. JSON in and out; a status of 400 or more rejects with the
// service's own message.

import type { GuestRequest, HostClient } from '@openchamber/sdk';

export class ServiceError extends Error {
  readonly status: number;
  readonly kind: string | null;
  readonly retryAt: number | null;
  constructor(status: number, message: string, kind: string | null = null, retryAt: number | null = null) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

export interface Call {
  method?: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string | undefined | null>;
  body?: unknown;
}

export type Svc = <T>(call: Call) => Promise<T>;

const parse = (text: string): unknown => {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

export const createSvc = (host: Pick<HostClient, 'serviceRequest'>): Svc => {
  return async <T>(call: Call): Promise<T> => {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(call.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') query[key] = value;
    }
    const request: GuestRequest = {
      method: call.method ?? 'GET',
      path: call.path,
      query,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
    };
    let response: { status: number; body: string };
    try {
      response = await host.serviceRequest(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ServiceError(0, `CI Hub's service did not answer (${message}).`, 'service');
    }
    const body = parse(response.body);
    if (response.status >= 400) {
      const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const message =
        typeof record.message === 'string' && record.message
          ? record.message
          : typeof body === 'string' && body
            ? body.slice(0, 300)
            : `CI Hub's service answered ${response.status}.`;
      throw new ServiceError(
        response.status,
        message,
        typeof record.kind === 'string' ? record.kind : null,
        typeof record.retryAt === 'number' ? record.retryAt : null,
      );
    }
    return body as T;
  };
};

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : 'Something went wrong.';
