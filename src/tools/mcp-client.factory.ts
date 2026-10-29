import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { McpServerConfig } from '../config/env.schema.js';
import type { McpClientFactory } from './mcp-registry.service.js';

/** Реальные подключения к MCP: один клиент на сервер, tool discovery через адаптер. */
export class MultiServerMcpFactory {
  private readonly clients = new Map<string, MultiServerMCPClient>();

  create: McpClientFactory = async (server) => {
    const client = this.clientFor(server);
    return client.getTools(server.name);
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
      // Неймспейсинг делаем сами (`<server>__<tool>`), префикс адаптера отключаем.
      prefixToolNameWithServerName: false,
      mcpServers: {
        [server.name]: {
          transport: server.transport === 'sse' ? 'sse' : 'http',
          url: server.url,
          ...(server.token ? { headers: { Authorization: `Bearer ${server.token}` } } : {}),
          // Тип адаптера требует поле, но валидация запрещает его вне mode: "legacy",
          // поэтому оставляем поведение по умолчанию и приводим тип намеренно.
        },
      },
    } as unknown as ConstructorParameters<typeof MultiServerMCPClient>[0]);
    this.clients.set(server.name, client);
    return client;
  }
}
