import { Module } from '@nestjs/common';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { MultiServerMcpFactory } from './mcp-client.factory.js';
import { MCP_CLIENT_FACTORY, McpRegistryService } from './mcp-registry.service.js';

/** Набор инструментов агента: `() => Promise<DynamicStructuredTool[]>`, с ленивой инициализацией. */
export const MCP_TOOLS = Symbol('MCP_TOOLS');
/** Реестр MCP-серверов: статусы, discovery, повторное подключение. */
export const MCP_REGISTRY = Symbol('MCP_REGISTRY');

export type McpToolsLoader = () => Promise<DynamicStructuredTool[]>;

@Module({
  providers: [
    MultiServerMcpFactory,
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
  exports: [McpRegistryService, MCP_TOOLS, MCP_REGISTRY, MCP_CLIENT_FACTORY, MultiServerMcpFactory],
})
export class ToolsModule {}

