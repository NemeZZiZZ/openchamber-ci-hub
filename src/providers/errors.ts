// What a provider adapter throws. The service maps the kind onto HTTP answers
// and onto what it tells the person; the message is the provider's own words.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A fetch that gives up on a host that never answers, keeping any signal the caller passed. */
export const withTimeout =
  (fetch: FetchLike, ms: number): FetchLike =>
  (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };

export type ProviderErrorKind =
  | 'auth'
  | 'not-found'
  | 'rate-limit'
  | 'network'
  | 'server'
  | 'forbidden'
  | 'unsupported'
  | 'unknown';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number;
  readonly rateLimitReset: number | null;

  constructor(
    message: string,
    options: { kind: ProviderErrorKind; status?: number; rateLimitReset?: number | null },
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = options.kind;
    this.status = options.status ?? 0;
    this.rateLimitReset = options.rateLimitReset ?? null;
  }
}
