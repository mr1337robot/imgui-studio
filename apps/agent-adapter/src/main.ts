/**
 * Minimal MCP-compatible JSON-RPC stdio adapter. Each tool is a declarative route mapping to the
 * canonical HTTP API; stdin/stdout framing is owned here, while all business state stays local to
 * studio-service.
 */
import { createInterface } from 'node:readline';
import { StudioApiError, StudioClient } from './studio-client.ts';

interface ToolRoute {
  readonly method: 'GET' | 'POST';
  readonly path: (argumentsValue: Record<string, unknown>) => string;
  readonly mutation: boolean;
  readonly body?: (argumentsValue: Record<string, unknown>) => unknown;
}

const projectPath = (value: Record<string, unknown>): string =>
  `/api/v1/projects/${requiredString(value, 'projectId')}`;
const previewPath = (value: Record<string, unknown>): string =>
  `/api/v1/previews/${requiredString(value, 'previewInstanceId')}`;

const routes: Readonly<Record<string, ToolRoute>> = {
  project_get: { method: 'GET', path: projectPath, mutation: false },
  source_read: {
    method: 'POST',
    path: (value) => `${projectPath(value)}/files:read`,
    mutation: false,
    body: withoutRouting,
  },
  source_patch: {
    method: 'POST',
    path: (value) => `${projectPath(value)}/files:patch`,
    mutation: true,
    body: withoutRouting,
  },
  build_preview: {
    method: 'POST',
    path: (value) => `${projectPath(value)}/builds`,
    mutation: true,
    body: withoutRouting,
  },
  preview_load: {
    method: 'POST',
    path: (value) => `${projectPath(value)}/previews`,
    mutation: true,
    body: withoutRouting,
  },
  reset_preview: {
    method: 'POST',
    path: (value) => `${previewPath(value)}:reset`,
    mutation: true,
    body: withoutRouting,
  },
  render_frame: {
    method: 'POST',
    path: (value) => `${previewPath(value)}/frames`,
    mutation: true,
    body: withoutRouting,
  },
  perform_action: {
    method: 'POST',
    path: (value) => `${previewPath(value)}/actions`,
    mutation: true,
    body: withoutRouting,
  },
  inspect_widgets: {
    method: 'POST',
    path: (value) => `${previewPath(value)}/inspection:query`,
    mutation: false,
    body: withoutRouting,
  },
  capture_animation: {
    method: 'POST',
    path: (value) => `${previewPath(value)}/captures`,
    mutation: true,
    body: withoutRouting,
  },
  compare_reference: {
    method: 'POST',
    path: (value) => `${projectPath(value)}/comparisons`,
    mutation: true,
    body: withoutRouting,
  },
};

const baseUrl = process.env.IMGUI_STUDIO_URL ?? 'http://127.0.0.1:4173';
const token = process.env.IMGUI_STUDIO_TOKEN;
if (!token)
  throw new Error('IMGUI_STUDIO_TOKEN is required through the trusted launcher environment.');
const client = new StudioClient({ baseUrl, token });
const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

for await (const line of lines) {
  if (line.trim() === '') continue;
  let request: Record<string, unknown>;
  try {
    request = asRecord(JSON.parse(line) as unknown);
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    continue;
  }
  await dispatch(request);
}

async function dispatch(request: Record<string, unknown>): Promise<void> {
  const id = request.id ?? null;
  try {
    if (request.method === 'initialize') {
      write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'imgui-studio', version: '0.1.0' },
        },
      });
      return;
    }
    if (request.method === 'notifications/initialized') return;
    if (request.method === 'tools/list') {
      write({
        jsonrpc: '2.0',
        id,
        result: {
          tools: Object.keys(routes).map((name) => ({
            name,
            description: `Canonical ImGui Studio ${name} operation.`,
            inputSchema: { type: 'object', additionalProperties: true },
          })),
        },
      });
      return;
    }
    if (request.method !== 'tools/call') throw new Error('Method not found.');
    const parameters = asRecord(request.params);
    const name = requiredString(parameters, 'name');
    const route = routes[name];
    if (!route) throw new Error(`Unknown tool '${name}'.`);
    const argumentsValue = asRecord(parameters.arguments ?? {});
    const result = await client.request(
      route.method,
      route.path(argumentsValue),
      route.body?.(argumentsValue),
      route.mutation,
    );
    write({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      },
    });
  } catch (error) {
    const data = error instanceof StudioApiError ? error.envelope : undefined;
    write({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'Adapter failure.',
        ...(data === undefined ? {} : { data }),
      },
    });
  }
}

function withoutRouting(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'projectId' && key !== 'previewInstanceId'),
  );
}
function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== 'string' || result.length === 0) throw new Error(`${key} is required.`);
  return encodeURIComponent(result);
}
function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
