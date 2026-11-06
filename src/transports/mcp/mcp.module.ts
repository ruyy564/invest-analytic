import { Module } from '@nestjs/common';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { MultiServerMcpFactory } from './mcp-client.factory.js';
import { McpProxyService } from './mcp-proxy.service.js';
import { MCP_CLIENT_FACTORY, McpRegistryService } from './mcp-registry.service.js';

/** Набор инструментов агента: `() => Promise<DynamicStructuredTool[]>`, ленивая инициализация. */
export const MCP_TOOLS = Symbol('MCP_TOOLS');
/** Реестр MCP-серверов: статусы, discovery, повторное подключение. */
export const MCP_REGISTRY = Symbol('MCP_REGISTRY');

export type McpToolsLoader = () => Promise<DynamicStructuredTool[]>;

/** Прокси нужен серверам с внешним URL: адаптер не дочитывает их стриминговый ответ. */
const needsProxy = (server: { url: string }): boolean => !server.url.includes('127.0.0.1');

/**
 * MCP-инфраструктура: подключения, discovery, allowlist, прокси и реестр.
 * Здесь нет тулов приложения — только транспорт и каталог инструментов.
 */
@Module({
  providers: [
    McpProxyService,
    {
      provide: MultiServerMcpFactory,
      useFactory: (proxy: McpProxyService) => new MultiServerMcpFactory(proxy, needsProxy),
      inject: [McpProxyService],
    },
    {
      provide: MCP_CLIENT_FACTORY,
      useFactory: (factory: MultiServerMcpFactory) => factory.create,
      inject: [MultiServerMcpFactory],
    },
    McpRegistryService,
    { provide: MCP_REGISTRY, useExisting: McpRegistryService },
    {
      provide: MCP_TOOLS,
      useFactory:
        (registry: McpRegistryService): McpToolsLoader =>
        async () => {
          await registry.ensureInitialized();
          return registry.tools;
        },
      inject: [McpRegistryService],
    },
  ],
  exports: [
    McpRegistryService,
    MCP_TOOLS,
    MCP_REGISTRY,
    MCP_CLIENT_FACTORY,
    MultiServerMcpFactory,
    McpProxyService,
  ],
})
export class McpModule {}
