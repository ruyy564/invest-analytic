import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { McpServerConfig } from '../../platform/config/env.schema.js';

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
export async function readJson(response: UpstreamResponse): Promise<unknown> {
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
