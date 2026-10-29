import { existsSync, readFileSync } from 'node:fs';
import { Agent, type AgentOptions } from 'node:https';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { McpServerConfig } from '../config/env.schema.js';
import type { McpClientFactory } from './mcp-registry.service.js';

/** РџР°СЂР°РјРµС‚СЂС‹ TLS РґР»СЏ MCP-СЃРѕРµРґРёРЅРµРЅРёСЏ: `extra-ca` РґРѕР±Р°РІР»СЏРµС‚ CA, `insecure` РѕС‚РєР»СЋС‡Р°РµС‚ РїСЂРѕРІРµСЂРєСѓ. */
export const tlsAgentOptions = (
  server: Pick<McpServerConfig, 'tlsMode' | 'caFile'>,
): AgentOptions | undefined => {
  if (server.tlsMode === 'insecure') {
    return { rejectUnauthorized: false };
  }
  if (server.tlsMode === 'extra-ca' && server.caFile && existsSync(server.caFile)) {
    return { ca: readFileSync(server.caFile, 'utf8') };
  }
  return undefined;
};

/**
 * РџРѕРґРјРµРЅСЏРµС‚ `fetch` С‚РѕР»СЊРєРѕ РґР»СЏ РїСѓС‚РµР№ TLS: Р°РґР°РїС‚РµСЂ MCP РЅРµ РїСЂРёРЅРёРјР°РµС‚ `dispatcher`,
 * Р° РіР»РѕР±Р°Р»СЊРЅС‹Р№ `NODE_TLS_REJECT_UNAUTHORIZED` РѕС‚РєР»СЋС‡Р°С‚СЊ РЅРµР»СЊР·СЏ вЂ” Р·Р°С‚СЂР°РіРёРІР°РµС‚ РІРµСЃСЊ РїСЂРѕС†РµСЃСЃ.
 */
export const withTlsFetch = async <T>(
  server: Pick<McpServerConfig, 'tlsMode' | 'caFile'>,
  fn: () => Promise<T>,
): Promise<T> => {
  const options = tlsAgentOptions(server);
  if (!options) {
    return fn();
  }

  const originalFetch = globalThis.fetch;
  const agent = new Agent(options);
  globalThis.fetch = ((input: string | URL | Request, init: RequestInit = {}) =>
    originalFetch(input as never, { ...init, dispatcher: agent } as never)) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    agent.destroy();
  }
};

/** Р РµР°Р»СЊРЅС‹Рµ РїРѕРґРєР»СЋС‡РµРЅРёСЏ Рє MCP: РѕРґРёРЅ РєР»РёРµРЅС‚ РЅР° СЃРµСЂРІРµСЂ, tool discovery С‡РµСЂРµР· Р°РґР°РїС‚РµСЂ. */
export class MultiServerMcpFactory {
  private readonly clients = new Map<string, MultiServerMCPClient>();

  create: McpClientFactory = async (server) => {
    const client = this.clientFor(server);
    return withTlsFetch(server, () => client.getTools(server.name));
  };

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }

  private clientFor(server: McpServerConfig): MultiServerMCPClient {
    const existing = this.clients.get(server.name);
    if (existing) {
      return existing;
    }
    const client = new MultiServerMCPClient({
      // РќРµР№РјСЃРїРµР№СЃРёРЅРі РґРµР»Р°РµРј СЃР°РјРё (`<server>__<tool>`), РїСЂРµС„РёРєСЃ Р°РґР°РїС‚РµСЂР° РѕС‚РєР»СЋС‡Р°РµРј.
      prefixToolNameWithServerName: false,
      mcpServers: {
        [server.name]: {
          transport: server.transport === 'sse' ? 'sse' : 'http',
          url: server.url,
          ...(server.token ? { headers: { Authorization: `Bearer ${server.token}` } } : {}),
        },
      },
    } as unknown as ConstructorParameters<typeof MultiServerMCPClient>[0]);
    this.clients.set(server.name, client);
    return client;
  }
}

