import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { AppConfigService } from '../config/app-config.service.js';
import type { McpServerConfig } from '../config/env.schema.js';

/**
 * Локальный MCP-прокси: говорит с T-Invest MCP по официальному протоколу
 * (initialize → notifications/initialized → tools/list / tools/call с сессией)
 * и отдаёт тот же протокол наружу на 127.0.0.1.
 *
 * Так `@langchain/mcp-adapters` работает штатно: он подключается к этому прокси,
 * а прокси решает проблему стриминговых ответов сервера.
 */
@Injectable()
export class McpProxyService {
  private readonly logger = new Logger(McpProxyService.name);
  private server?: Server;
  private upstream?: McpServerConfig;

  constructor(private readonly config: AppConfigService) {}

  async start(server: McpServerConfig): Promise<string> {
    if (this.server) {
      return this.url;
    }
    this.upstream = server;

    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    this.logger.log(`MCP-прокси запущен: ${this.url} → ${server.url}`);
    return this.url;
  }

  get url(): string {
    const address = this.server?.address() as AddressInfo | null;
    return address ? `http://127.0.0.1:${address.port}/mcp` : '';
  }

  private async handle(
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const upstream = this.upstream;
    let raw = '';
    for await (const chunk of request) {
      raw += Buffer.from(chunk as Buffer).toString('utf8');
    }
    if (!upstream) {
      response.writeHead(503).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }

    const message = raw ? JSON.parse(raw) : {};
    const isNotification = message.id === undefined;

    try {
      const upstreamResponse = await fetch(upstream.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(upstream.token ? { authorization: `Bearer ${upstream.token}` } : {}),
          ...(request.headers['mcp-session-id']
            ? { 'mcp-session-id': String(request.headers['mcp-session-id']) }
            : {}),
        },
        body: raw,
      });

      const sessionId = upstreamResponse.headers.get('mcp-session-id');
      const payload = isNotification ? undefined : await readJson(upstreamResponse);

      response.writeHead(upstreamResponse.status === 202 ? 200 : upstreamResponse.status, {
        'content-type': 'application/json',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      });
      response.end(payload ? JSON.stringify(payload) : '');
    } catch (error) {
      this.logger.warn(`MCP-прокси: ошибка запроса ${message.method}: ${(error as Error).message}`);
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id ?? null,
            error: { code: -32603, message: 'upstream unavailable' },
          }),
        );
    }
  }
}

/** Читает JSON-RPC ответ из JSON-тела или SSE-потока и возвращает его как JSON. */
async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  let buffer = '';
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += Buffer.from(chunk).toString('utf8');
    for (const line of buffer.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try {
        return JSON.parse(line.slice(5).trim());
      } catch {
        // неполная строка
      }
    }
  }
  return { jsonrpc: '2.0', id: null, result: {} };
}

export const toolInputSchema = z.record(z.string(), z.unknown());
