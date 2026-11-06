import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  postToUpstream,
  readJson,
  releaseExtraCa,
  trustExtraCa,
} from './proxy-upstream.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { McpServerConfig } from '../../config/env.schema.js';

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
  private caTrusted = false;

  constructor(private readonly config: AppConfigService) {}

  async start(server: McpServerConfig): Promise<string> {
    if (this.server) {
      return this.url;
    }
    this.upstream = server;
    this.trustCa(server);

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

  /** Останавливаем прокси и возвращаем корневые сертификаты в исходное состояние. */
  onModuleDestroy(): void {
    this.server?.close();
    this.server = undefined;
    if (this.caTrusted) {
      releaseExtraCa();
      this.caTrusted = false;
    }
  }

  private trustCa(server: McpServerConfig): void {
    if (server.tlsMode !== 'extra-ca' || !server.caFile) {
      return;
    }
    try {
      const added = trustExtraCa(server.caFile);
      this.caTrusted = added > 0;
      this.logger.log(`Доверяем ${added} CA из ${server.caFile} (${server.name})`);
    } catch (error) {
      this.logger.warn(`Не удалось добавить CA ${server.caFile}: ${(error as Error).message}`);
    }
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
      const upstreamResponse = await postToUpstream(
        upstream,
        raw,
        request.headers['mcp-session-id']
          ? String(request.headers['mcp-session-id'])
          : undefined,
      );

      const sessionId = upstreamResponse.headers['mcp-session-id'];
      const payload = isNotification ? undefined : await readJson(upstreamResponse);

      response.writeHead(upstreamResponse.status === 202 ? 200 : upstreamResponse.status, {
        'content-type': 'application/json',
        ...(sessionId ? { 'mcp-session-id': String(sessionId) } : {}),
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

/** Ответ апстрима в минимальном виде: статус, заголовки и тело (поток). */

export {
  caFileToPem,
  postToUpstream,
  releaseExtraCa,
  trustExtraCa,
  type UpstreamResponse,
} from './proxy-upstream.js';
