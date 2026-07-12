import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioApiError, StudioClient } from '../../../apps/agent-adapter/src/studio-client.ts';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))),
  );
});

describe('thin agent adapter client', () => {
  it('adds authentication and idempotency without changing the canonical request body', async () => {
    let observedHeaders: Record<string, string | string[] | undefined> = {};
    let observedBody = '';
    const origin = await listen((request, response) => {
      observedHeaders = request.headers;
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => (observedBody += chunk));
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"ok":true}\n');
      });
    });
    const client = new StudioClient({ baseUrl: origin, token: 'launch-secret' });
    await expect(client.request('POST', '/api/v1/example', { value: 42 }, true)).resolves.toEqual({
      ok: true,
    });
    expect(observedHeaders.authorization).toBe('Bearer launch-secret');
    expect(observedHeaders['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(observedBody)).toEqual({ value: 42 });
  });

  it('preserves the structured service error envelope', async () => {
    const origin = await listen((_request, response) => {
      response.writeHead(409, { 'Content-Type': 'application/json' });
      response.end('{"error":{"code":"PREVIEW_IDENTITY_MISMATCH"}}\n');
    });
    const client = new StudioClient({ baseUrl: origin, token: 'launch-secret' });
    const error = await client.request('GET', '/api/v1/example').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(StudioApiError);
    expect((error as StudioApiError).envelope).toEqual({
      error: { code: 'PREVIEW_IDENTITY_MISMATCH' },
    });
  });
});

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing test address.');
  return `http://127.0.0.1:${String(address.port)}`;
}
