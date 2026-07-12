/**
 * Thin authenticated client for the canonical local service. It deliberately contains no project,
 * build, preview, capture, or comparison policy; all domain decisions remain server-authoritative.
 */
import { randomUUID } from 'node:crypto';

export interface StudioClientOptions {
  /** Loopback service origin, normally http://127.0.0.1:4173. */
  readonly baseUrl: string;
  /** Per-launch bearer token received through the trusted launcher channel. */
  readonly token: string;
}

/** Maps adapter calls to versioned HTTP requests and preserves structured service errors. */
export class StudioClient {
  public constructor(private readonly options: StudioClientOptions) {}

  /** Sends one canonical API request; mutation requests receive a fresh idempotency identity. */
  public async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    mutation = false,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.options.token}`,
      'X-Request-Id': `req_${randomUUID()}`,
      'X-Studio-Client': 'agent-v1',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (mutation) headers['Idempotency-Key'] = randomUUID();
    const response = await fetch(new URL(path, this.options.baseUrl), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = (await response.json()) as unknown;
    if (!response.ok) throw new StudioApiError(response.status, result);
    return result;
  }
}

/** Error wrapper retaining the canonical machine-readable service envelope. */
export class StudioApiError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly envelope: unknown,
  ) {
    super(`ImGui Studio API request failed with HTTP ${String(statusCode)}.`);
  }
}
