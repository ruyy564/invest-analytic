import { Optional } from '@nestjs/common';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { McpServerConfig } from '../../platform/config/env.schema.js';
import type { McpClientFactory } from './mcp-registry.service.js';
import type { McpProxyService } from './mcp-proxy.service.js';

/**
 * Реальные подключения к MCP: адаптер LangChain подключается к серверу
 * напрямую, если у сервера обычный JSON-транспорт, и через локальный прокси,
 * если сервер отвечает SSE-стримом (адаптер такой ответ не дожидается).
 */
export class MultiServerMcpFactory {
  private readonly clients = new Map<string, MultiServerMCPClient>();
  private readonly resolvedUrls = new Map<string, string>();

  constructor(
    @Optional() private readonly proxy?: McpProxyService,
    @Optional() private readonly proxyEnabled: (server: McpServerConfig) => boolean = () => false,
  ) {}

  create: McpClientFactory = async (server) => {
    const client = await this.clientFor(server);
    return client.getTools(server.name);
  };

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }

  private async clientFor(server: McpServerConfig): Promise<MultiServerMCPClient> {
    const existing = this.clients.get(server.name);
    if (existing) {
      return existing;
    }

    const useProxy = this.proxy !== undefined && this.proxyEnabled(server);
    const url = useProxy ? await this.proxy!.start(server) : server.url;
    this.resolvedUrls.set(server.name, url);

    const client = new MultiServerMCPClient({
      // Неймспейсинг делаем сами (`<server>__<tool>`), префикс адаптера отключаем.
      prefixToolNameWithServerName: false,
      mcpServers: {
        [server.name]: {
          transport: server.transport === 'sse' ? 'sse' : 'http',
          url,
          ...(server.token && !useProxy
            ? { headers: { Authorization: `Bearer ${server.token}` } }
            : {}),
        },
      },
    } as unknown as ConstructorParameters<typeof MultiServerMCPClient>[0]);
    this.clients.set(server.name, client);
    return client;
  }

  urlFor(serverName: string): string | undefined {
    return this.resolvedUrls.get(serverName);
  }
}
