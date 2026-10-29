import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { AppConfigService } from '../config/app-config.service.js';
import type { McpServerConfig } from '../config/env.schema.js';
import { missingAllowedTools, selectAllowedTools, wrapTool } from './mcp-tool.adapter.js';
import { ToolBudget } from './tool-budget.js';

export const MCP_CLIENT_FACTORY = Symbol('MCP_CLIENT_FACTORY');

/** Возвращает инструменты сервера в исходных (ненаймспейсенных) именах. */
export type McpClientFactory = (server: McpServerConfig) => Promise<DynamicStructuredTool[]>;

export interface McpServerStatus {
  name: string;
  status: 'up' | 'down';
  tools: string[];
  missingTools: string[];
  error?: string;
}

export const MCP_TOOL_TIMEOUT_MS = 10_000;
export const RUN_TOOL_BUDGET = { maxCalls: 8, deadlineMs: 30_000 } as const;

/**
 * Реестр MCP-серверов: discovery при первом обращении, allowlist,
 * неймспейсинг и обёртка вызовов. Недоступный сервер не ломает старт.
 */
@Injectable()
export class McpRegistryService {
  private readonly logger = new Logger(McpRegistryService.name);
  private readonly statuses = new Map<string, McpServerStatus>();
  private toolsCache: DynamicStructuredTool[] = [];
  private initPromise?: Promise<void>;

  constructor(
    private readonly config: AppConfigService,
    @Inject(MCP_CLIENT_FACTORY) private readonly factory: McpClientFactory,
  ) {}

  /** Ленивая инициализация: удерживает `AppModule` от сетевых вызовов при старте. */
  async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.refresh();
    }
    return this.initPromise;
  }

  async refresh(): Promise<void> {
    const servers = this.config.value.mcp.servers;
    const tools: DynamicStructuredTool[] = [];
    this.statuses.clear();

    for (const server of servers) {
      try {
        const discovered = await this.factory(server);
        const allowed = selectAllowedTools(discovered, server.allowedTools);
        const missing = missingAllowedTools(discovered, server.allowedTools);
        if (missing.length > 0) {
          this.logger.warn(
            `MCP ${server.name}: в каталоге нет инструментов из allowlist: ${missing.join(', ')}`,
          );
        }
        tools.push(
          ...allowed.map((tool) =>
            wrapTool(tool, { server: server.name, timeoutMs: MCP_TOOL_TIMEOUT_MS }),
          ),
        );
        this.statuses.set(server.name, {
          name: server.name,
          status: 'up',
          tools: allowed.map((tool) => tool.name),
          missingTools: missing,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`MCP ${server.name} недоступен: ${message}`);
        this.statuses.set(server.name, {
          name: server.name,
          status: 'down',
          tools: [],
          missingTools: [...server.allowedTools],
          error: message,
        });
      }
    }

    this.toolsCache = tools;
  }

  get tools(): DynamicStructuredTool[] {
    return this.toolsCache;
  }

  get serverStatuses(): McpServerStatus[] {
    return [...this.statuses.values()];
  }

  isHealthy(): boolean {
    const statuses = this.serverStatuses;
    return statuses.length > 0 && statuses.every((status) => status.status === 'up');
  }

  /** Бюджет на один прогон: 8 вызовов и 30 секунд. */
  createBudget(): ToolBudget {
    return new ToolBudget({ ...RUN_TOOL_BUDGET });
  }
}
