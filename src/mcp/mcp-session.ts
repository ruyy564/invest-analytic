/**
 * MCP-клиент поверх официального SDK с сессиями:
 * у сервера стриминговый транспорт, поэтому обычный `getTools` из адаптера ждёт
 * закрытия SSE и зависает. Здесь ответы читаются из JSON-тела, а сессия
 * (`mcp-session-id`) переиспользуется.
 */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const readRpc = async (response: Response, id: number): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await response.json()) as { id?: number };
    return body;
  }
  let buffer = '';
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += Buffer.from(chunk).toString('utf8');
    for (const line of buffer.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim()) as { id?: number };
        if (parsed.id === id) return parsed;
      } catch {
        // неполная строка — ждём следующий чанк
      }
    }
  }
  return undefined;
};

export interface McpSessionOptions {
  url: string;
  token?: string;
  timeoutMs?: number;
}

export class McpSession {
  private sessionId?: string;

  constructor(private readonly options: McpSessionOptions) {}

  private get headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
    };
  }

  async connect(): Promise<void> {
    const response = await fetch(this.options.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'invest-analytic', version: '1' },
        },
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
    if (!response.ok) {
      throw new Error(`initialize failed: HTTP ${response.status}`);
    }
    this.sessionId = response.headers.get('mcp-session-id') ?? undefined;
    await readRpc(response, 1);

    await fetch(this.options.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    }).then((res) => res.text());
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const response = await fetch(this.options.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
    const body = (await readRpc(response, 2)) as {
      result?: { tools?: McpToolDescriptor[] };
    };
    return body?.result?.tools ?? [];
  }
}
