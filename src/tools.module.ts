import { Module } from '@nestjs/common';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { KnowledgeModule, KnowledgeService } from './capabilities/knowledge/index.js';
import { McpModule, type McpToolsLoader } from './transports/mcp/mcp.module.js';
import { KNOWLEDGE_TOOL } from './transports/mcp/mcp-registry.service.js';
import { createKnowledgeTool } from './capabilities/knowledge/tools/knowledge/knowledge.tool.js';

/**
 * Тулы приложения и их подключение. Каждый тул — провайдер с понятным токеном;
 * MCP-транспорт и реестр живут в `McpModule` и реэкспортируются отсюда.
 */
@Module({
  imports: [McpModule, KnowledgeModule],
  providers: [
    {
      provide: KNOWLEDGE_TOOL,
      useFactory: (knowledge: KnowledgeService): DynamicStructuredTool =>
        createKnowledgeTool(knowledge),
      inject: [KnowledgeService],
    },
  ],
  exports: [McpModule, KNOWLEDGE_TOOL],
})
export class ToolsModule {}

export type { McpToolsLoader };
