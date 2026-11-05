import { existsSync } from 'node:fs';
import {
  MCP_TLS_MODES,
  MCP_TRANSPORTS,
  isForbiddenTool,
  type McpTlsMode,
  type McpTransport,
} from './env.constants.js';

export interface McpServerConfig {
  name: string;
  url: string;
  transport: McpTransport;
  token?: string;
  allowedTools: string[];
  /** `strict` — проверять сертификат обычно, `extra-ca` — доверять указанному файлу, `insecure` — не проверять. */
  tlsMode: McpTlsMode;
  /** Путь к PEM-файлу с дополнительным CA (для `tlsMode: extra-ca`). */
  caFile?: string;
}

export interface McpServersParseResult {
  servers: McpServerConfig[];
  issues: string[];
}

const SERVER_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Разворачивает `MCP_SERVERS` в конфигурацию серверов, собирая все проблемы сразу. */
export const parseMcpServers = (
  raw: NodeJS.ProcessEnv,
  serverNames: readonly string[],
): McpServersParseResult => {
  const issues: string[] = [];
  const servers: McpServerConfig[] = [];
  const seen = new Set<string>();

  for (const rawName of serverNames) {
    const name = rawName.trim().toLowerCase();
    if (!SERVER_NAME_PATTERN.test(name)) {
      issues.push(
        `MCP_SERVERS: имя "${rawName}" должно соответствовать ${SERVER_NAME_PATTERN.source}`,
      );
      continue;
    }
    if (seen.has(name)) {
      issues.push(`MCP_SERVERS: сервер "${name}" указан дважды`);
      continue;
    }
    seen.add(name);

    const prefix = `MCP_${name.toUpperCase()}_`;
    const urlValue = raw[`${prefix}URL`]?.trim();
    if (!urlValue) {
      issues.push(`${prefix}URL: обязателен для сервера "${name}"`);
      continue;
    }
    try {
      new URL(urlValue);
    } catch {
      issues.push(`${prefix}URL: должен быть корректным URL`);
      continue;
    }

    const transportRaw = (raw[`${prefix}TRANSPORT`]?.trim() || 'http').toLowerCase();
    const transport = MCP_TRANSPORTS.find((item) => item === transportRaw);
    if (!transport) {
      issues.push(`${prefix}TRANSPORT: допустимые значения: ${MCP_TRANSPORTS.join(', ')}`);
      continue;
    }

    const tlsRaw = (raw[`${prefix}TLS_MODE`]?.trim() || 'strict').toLowerCase();
    const tlsMode = MCP_TLS_MODES.find((item) => item === tlsRaw);
    if (!tlsMode) {
      issues.push(`${prefix}TLS_MODE: допустимые значения: ${MCP_TLS_MODES.join(', ')}`);
      continue;
    }

    const caFile = raw[`${prefix}CA_FILE`]?.trim() || undefined;
    if (tlsMode === 'extra-ca' && !caFile) {
      issues.push(`${prefix}CA_FILE: обязателен при ${prefix}TLS_MODE=extra-ca`);
      continue;
    }
    if (caFile && !existsSync(caFile)) {
      issues.push(`${prefix}CA_FILE: файл не найден (${caFile})`);
      continue;
    }

    const allowedTools = (raw[`${prefix}ALLOWED_TOOLS`] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (allowedTools.length === 0) {
      issues.push(`${prefix}ALLOWED_TOOLS: должен перечислять хотя бы один инструмент`);
      continue;
    }
    const forbidden = allowedTools.filter((tool) => isForbiddenTool(tool));
    if (forbidden.length > 0) {
      issues.push(
        `${prefix}ALLOWED_TOOLS: торговые и денежные операции запрещены (${forbidden.join(', ')})`,
      );
      continue;
    }

    servers.push({
      name,
      url: urlValue,
      transport,
      token: raw[`${prefix}TOKEN`]?.trim() || undefined,
      allowedTools,
      tlsMode,
      caFile,
    });
  }

  if (servers.length === 0 && issues.length === 0) {
    issues.push('MCP_SERVERS: должен быть указан хотя бы один сервер');
  }

  return { servers, issues };
};
