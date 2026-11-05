import { Module } from '@nestjs/common';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { AppConfigService } from '../config/app-config.service.js';
import { KnowledgeModule, KnowledgeService } from '../knowledge/index.js';
import { MultiServerMcpFactory } from './mcp-client.factory.js';
import { McpProxyService } from './mcp-proxy.service.js';
import { KNOWLEDGE_TOOL, MCP_CLIENT_FACTORY, McpRegistryService } from './mcp-registry.service.js';
import { createKnowledgeTool } from './knowledge/knowledge.tool.js';
import { withTimeout } from './mcp-tool.adapter.js';

/** Набор инструментов агента: `() => Promise<DynamicStructuredTool[]>`, с ленивой инициализацией. */
export const MCP_TOOLS = Symbol('MCP_TOOLS');
/** Реестр MCP-серверов: статусы, discovery, повторное подключение. */
export const MCP_REGISTRY = Symbol('MCP_REGISTRY');
/** Текущий счёт по умолчанию (определяется один раз и переиспользуется). */
export const DEFAULT_ACCOUNT = Symbol('DEFAULT_ACCOUNT');

export type McpToolsLoader = () => Promise<DynamicStructuredTool[]>;

/**
 * Прокси включается для серверов с внешним URL: их стриминговый ответ
 * адаптер LangChain не дочитывает, а локальный прокси отдаёт обычный JSON.
 */
const needsProxy = (server: { url: string }): boolean => !server.url.includes('127.0.0.1');

/**
 * Счёт по умолчанию: берём из конфигурации, а если он не задан — спрашиваем
 * у MCP один раз (с таймаутом). Иначе модель вынуждена угадывать accountId
 * и подтверждение приходит с пустыми аргументами.
 */
const ACCOUNT_LOOKUP_TIMEOUT_MS = 10_000;

export const resolveDefaultAccount = async (
  config: AppConfigService,
  registry: McpRegistryService,
): Promise<string | undefined> => {
  const fromEnv = config.value.mcp.accountId;
  if (fromEnv) {
    return fromEnv;
  }
  try {
    return await withTimeout(
      (async () => {
        await registry.ensureInitialized();
        const tool = registry.tools.find((item) => item.name === 'tinkoff__invest_list_accounts');
        if (!tool) {
          return undefined;
        }
        const raw = await tool.invoke({} as never);
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        return /"id"\s*:\s*"([^"]+)"/.exec(text)?.[1];
      })(),
      ACCOUNT_LOOKUP_TIMEOUT_MS,
      () => new Error('account lookup timeout'),
    );
  } catch {
    return undefined;
  }
};

@Module({
  imports: [KnowledgeModule],
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
    // Тонкий инструмент знаний: бизнес-логика — в KnowledgeService, здесь только схема.
    {
      provide: KNOWLEDGE_TOOL,
      useFactory: (knowledge: KnowledgeService): DynamicStructuredTool =>
        createKnowledgeTool(knowledge),
      inject: [KnowledgeService],
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
    KNOWLEDGE_TOOL,
    MultiServerMcpFactory,
    McpProxyService,
  ],
})
export class ToolsModule {}



