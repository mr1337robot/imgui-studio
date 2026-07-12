import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { StudioHttpServer } from '../../apps/studio-service/src/http-server.ts';
import { ProjectService } from '../../apps/studio-service/src/project-service.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
let projectRoot: string;
let project: ProjectService;
let server: StudioHttpServer;
let token: string;
const studioPort = 4273;
const previewPort = 4274;

beforeAll(async () => {
  projectRoot = await mkdtemp(resolve(tmpdir(), 'imgui-studio-http-'));
  await cp(resolve(repositoryRoot, 'examples/starter'), projectRoot, { recursive: true });
  await rm(resolve(projectRoot, '.studio'), { recursive: true, force: true });
  project = await ProjectService.open(projectRoot, repositoryRoot);
  server = new StudioHttpServer(repositoryRoot, project, { studioPort, previewPort });
  ({ token } = await server.listen());
});

afterAll(async () => {
  await server.close();
  await rm(projectRoot, { recursive: true, force: true });
});

describe('Phase 2 HTTP authority', () => {
  it('discovers and reads the active project without exposing an absolute path', async () => {
    const listing = await jsonRequest('/api/v1/projects');
    expect(listing.response.status).toBe(200);
    expect(asArray(asRecord(listing.body).projects)).toHaveLength(1);
    expect(JSON.stringify(listing.body)).not.toContain(projectRoot);

    const read = await jsonRequest(`/api/v1/projects/${project.projectId}/files:read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'agent-v1' },
      body: JSON.stringify({ paths: ['src/studio_managed_theme.cpp'], expectedRevision: '0' }),
    });
    expect(read.response.status).toBe(200);
    const file = asRecord(asArray(asRecord(read.body).files)[0]);
    expect(file.path).toBe('src/studio_managed_theme.cpp');
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects missing authentication and a hostile browser origin', async () => {
    const body = JSON.stringify({ expectedRevision: '0', patches: [] });
    const unauthenticated = await jsonRequest(`/api/v1/projects/${project.projectId}/files:patch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
        'X-Studio-Client': 'agent-v1',
      },
      body,
    });
    expect(unauthenticated.response.status).toBe(401);
    expect(errorCode(unauthenticated.body)).toBe('UNAUTHORIZED');

    const hostile = await jsonRequest(`/api/v1/projects/${project.projectId}/files:patch`, {
      method: 'POST',
      headers: mutationHeaders('11111111-1111-4111-8111-111111111112', {
        Origin: 'https://hostile.example',
      }),
      body,
    });
    expect(hostile.response.status).toBe(401);
    expect(project.currentRevision).toBe('0');
  });

  it('replays an identical idempotent mutation and rejects key reuse with another body', async () => {
    const read = await jsonRequest(`/api/v1/projects/${project.projectId}/files:read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'agent-v1' },
      body: JSON.stringify({ paths: ['src/studio_managed_theme.cpp'], expectedRevision: '0' }),
    });
    const file = asRecord(asArray(asRecord(read.body).files)[0]);
    const sourceLines = asString(file.content).split(/\r?\n/);
    const sourceIndex = sourceLines.findIndex((line: string) =>
      line.includes('animationDurationSeconds = 0.22F'),
    );
    const sourceLine = asString(sourceLines[sourceIndex]);
    const sourceLineNumber = String(sourceIndex + 1);
    const requestBody = {
      expectedRevision: '0',
      patches: [
        {
          path: 'src/studio_managed_theme.cpp',
          expectedSha256: asString(file.sha256),
          unifiedDiff: `@@ -${sourceLineNumber},1 +${sourceLineNumber},1 @@\n-${sourceLine}\n+${sourceLine.replace('0.22F', '0.24F')}\n`,
        },
      ],
      reason: 'HTTP integration fixture',
    };
    const key = '22222222-2222-4222-8222-222222222222';
    const first = await jsonRequest(`/api/v1/projects/${project.projectId}/files:patch`, {
      method: 'POST',
      headers: mutationHeaders(key),
      body: JSON.stringify(requestBody),
    });
    const replay = await jsonRequest(`/api/v1/projects/${project.projectId}/files:patch`, {
      method: 'POST',
      headers: mutationHeaders(key),
      body: JSON.stringify(requestBody),
    });
    expect(first.response.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(project.currentRevision).toBe('1');

    const reused = await jsonRequest(`/api/v1/projects/${project.projectId}/files:patch`, {
      method: 'POST',
      headers: mutationHeaders(key),
      body: JSON.stringify({ ...requestBody, reason: 'different body' }),
    });
    expect(reused.response.status).toBe(400);
    expect(errorCode(reused.body)).toBe('INVALID_REQUEST');
  });

  it('emits sequence-numbered WebSocket hints after an authenticated revision change', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(studioPort)}/api/v1/events`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Studio-Client': 'agent-v1' },
    });
    await new Promise<void>((resolvePromise, reject) => {
      socket.once('open', resolvePromise);
      socket.once('error', reject);
    });
    const eventPromise = new Promise<Record<string, unknown>>((resolvePromise, reject) => {
      socket.once('message', (bytes) => {
        try {
          const payload = Array.isArray(bytes)
            ? Buffer.concat(bytes)
            : bytes instanceof ArrayBuffer
              ? Buffer.from(new Uint8Array(bytes))
              : Buffer.from(bytes);
          resolvePromise(asRecord(JSON.parse(payload.toString('utf8')) as unknown));
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Invalid event payload.'));
        }
      });
    });
    const read = await jsonRequest(`/api/v1/projects/${project.projectId}/files:read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'agent-v1' },
      body: JSON.stringify({ paths: ['src/studio_managed_theme.cpp'], expectedRevision: '1' }),
    });
    const file = asRecord(asArray(asRecord(read.body).files)[0]);
    const content = asString(file.content);
    const lines = content.split(/\r?\n/);
    const index = lines.findIndex((line) => line.includes('animationDurationSeconds = 0.24F'));
    const line = asString(lines[index]);
    const lineNumber = String(index + 1);
    const mutation = await jsonRequest(`/api/v1/projects/${project.projectId}/files:patch`, {
      method: 'POST',
      headers: mutationHeaders('33333333-3333-4333-8333-333333333333'),
      body: JSON.stringify({
        expectedRevision: '1',
        patches: [
          {
            path: 'src/studio_managed_theme.cpp',
            expectedSha256: asString(file.sha256),
            unifiedDiff: `@@ -${lineNumber},1 +${lineNumber},1 @@\n-${line}\n+${line.replace('0.24F', '0.26F')}\n`,
          },
        ],
      }),
    });
    expect(mutation.response.status).toBe(200);
    const event = await eventPromise;
    expect(event.type).toBe('project.revisionChanged');
    expect(event.sequence).toBeTypeOf('number');
    socket.close();
  });
});

async function jsonRequest(
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${String(studioPort)}${path}`, init);
  return { response, body: await response.json() };
}

function mutationHeaders(
  key: string,
  additions: Record<string, string> = {},
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
    'X-Studio-Client': 'agent-v1',
    ...additions,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object response.');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an array response.');
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string response field.');
  return value;
}

function errorCode(value: unknown): string {
  return asString(asRecord(asRecord(value).error).code);
}
