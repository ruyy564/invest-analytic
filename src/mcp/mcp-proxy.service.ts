import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { setDefaultCACertificates, getCACertificates } from 'node:tls';
import type { Readable } from 'node:stream';
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
export interface UpstreamResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
}

/**
 * POST в MCP-сервер через `node:http`/`node:https`, а не `fetch`.
 * Причина: `MCP_<NAME>_TLS_MODE`/`CA_FILE` должны применяться именно к этому соединению —
 * `fetch` не принимает `ca` и не видит конфигурацию сервера.
 */
export const postToUpstream = (
  server: McpServerConfig,
  body: string,
  sessionId?: string,
): Promise<UpstreamResponse> =>
  new Promise((resolve, reject) => {
    const target = new URL(server.url);
    const secure = target.protocol === 'https:';
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'content-length': String(Buffer.byteLength(body)),
      ...(server.token ? { authorization: `Bearer ${server.token}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    };
    // `Agent` из `node:https` несёт `ca`/`rejectUnauthorized`; для http агент по умолчанию.
    const agent = secure ? new HttpsAgent({ ...tlsOptions(server), keepAlive: false }) : undefined;
    const request = (secure ? httpsRequest : httpRequest)(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (secure ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers,
        agent,
      },
      (response) => {
        response.on('error', reject);
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response });
      },
    );
    request.on('error', reject);
    request.end(body);
  });

/** Прежний набор корневых сертификатов: нужен, чтобы вернуть его при остановке. */
let previousCa: string[] | undefined;

/**
 * Добавляет CA из `MCP_<NAME>_CA_FILE` к корневым сертификатам процесса.
 * Возвращает число добавленных сертификатов; 0 — файл пуст, ничего не менялось.
 */
export const trustExtraCa = (caFile: string): number => {
  const extra = caFileToPem(caFile);
  if (extra.length === 0) {
    return 0;
  }
  const current = getCACertificates('default') as string[];
  previousCa ??= current;
  setDefaultCACertificates([...current, ...extra]);
  return extra.length;
};

/** Разбирает PEM-файл на отдельные сертификаты (блоки `BEGIN/END CERTIFICATE`). */
export const caFileToPem = (caFile: string): string[] => {
  const content = readFileSync(caFile, 'utf8');
  const matches = content.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  return (matches ?? []).map((block) => `${block.trim()}\n`);
};

/** Возвращает корневой набор к состоянию до `trustExtraCa`. */
export const releaseExtraCa = (): void => {
  if (!previousCa) {
    return;
  }
  setDefaultCACertificates(previousCa);
  previousCa = undefined;
};

/** Параметры TLS для сервера: `strict` — обычная проверка, `extra-ca` — доверять файлу. */
const tlsOptions = (server: McpServerConfig): { ca?: string; rejectUnauthorized: boolean } => {
  if (server.tlsMode === 'insecure') {
    return { rejectUnauthorized: false };
  }
  // `extra-ca` уже подключён к корневым сертификатам процесса (`trustExtraCa`),
  // поэтому здесь достаточно обычной проверки: так же доверяют и LLM-провайдеры.
  return { rejectUnauthorized: true };
};

/** Читает JSON-RPC ответ из JSON-тела или SSE-потока и возвращает его как JSON. */
async function readJson(response: UpstreamResponse): Promise<unknown> {
  const contentType = String(response.headers['content-type'] ?? '');
  if (contentType.includes('application/json')) {
    return JSON.parse(await readAll(response.body));
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

const readAll = async (stream: Readable): Promise<string> => {
  let buffer = '';
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    buffer += Buffer.from(chunk).toString('utf8');
  }
  return buffer;
};

export const toolInputSchema = z.record(z.string(), z.unknown());
