import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import { AppConfigService } from '../config/app-config.service.js';
import type { McpServerConfig } from '../config/env.schema.js';
import { isForbiddenTool } from '../config/env.schema.js';
import { missingAllowedTools, selectAllowedTools, wrapTool } from './mcp-tool.adapter.js';
import { ALL_ACCOUNTS_TOOL, collectAllAccounts } from './portfolio-snapshot.js';
import { collectDynamics, PRICE_DYNAMICS_TOOL } from './price-dynamics.js';
import { toZodV3 } from './tool-schema.js';
import { ToolBudget } from './tool-budget.js';

export const MCP_CLIENT_FACTORY = Symbol('MCP_CLIENT_FACTORY');
/** Возвращает инструменты сервера в исходных (ненаймспейсенных) именах. */
export type McpClientFactory = (server: McpServerConfig) => Promise<DynamicStructuredTool[]>;

export interface McpServerStatus {
  name: string;
  status: 'up' | 'down';
  tools: string[];
  /** Инструменты из allowlist, которых нет в каталоге сервера. */
  missingTools: string[];
  /** Read-only инструменты каталога, не попавшие в allowlist. */
  unlistedTools: string[];
  error?: string;
}

/**
 * Read-only инструменты каталога, которые не попали в allowlist: сигнал, что
 * allowlist отстал от каталога сервера. Торговые не учитываются — они запрещены всегда.
 */
export const unlistedReadOnlyTools = (
  catalog: readonly { name: string }[],
  allowedTools: readonly string[],
): string[] => {
  const allowed = new Set(allowedTools);
  return catalog
    .map((tool) => tool.name)
    .filter((name) => !allowed.has(name) && !isForbiddenTool(name));
};

/**
 * Реестр MCP-серверов: discovery при первом обращении, allowlist,
 * неймспейсинг и обёртка вызовов. Недоступный сервер не ломает старт.
 * Лимиты прогона (вызовы, время, таймаут инструмента) берутся из конфигурации.
 */
@Injectable()
export class McpRegistryService {
  private readonly logger = new Logger(McpRegistryService.name);
  private readonly statuses = new Map<string, McpServerStatus>();
  private readonly budgets = new Map<string, ToolBudget>();
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
        const unlisted = unlistedReadOnlyTools(discovered, server.allowedTools);
        if (missing.length > 0) {
          this.logger.warn(
            `MCP ${server.name}: в каталоге нет инструментов из allowlist: ${missing.join(', ')}`,
          );
        }
        if (unlisted.length > 0) {
          this.logger.warn(
            `MCP ${server.name}: read-only инструменты каталога вне allowlist: ${unlisted.join(', ')}`,
          );
        }
        tools.push(
          ...allowed.map((tool) =>
            wrapTool(tool, {
              server: server.name,
              timeoutMs: this.config.value.run.mcpToolTimeoutMs,
              budgetFor: (sessionId) =>
                sessionId ? this.budgets.get(sessionId) : undefined,
            }),
          ),
        );
        this.statuses.set(server.name, {
          name: server.name,
          status: 'up',
          tools: allowed.map((tool) => tool.name),
          missingTools: missing,
          unlistedTools: unlisted,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`MCP ${server.name} недоступен: ${message}`);
        this.statuses.set(server.name, {
          name: server.name,
          status: 'down',
          tools: [],
          missingTools: [...server.allowedTools],
          unlistedTools: [],
          error: message,
        });
      }
    }

    this.toolsCache = [...tools, this.createAllAccountsTool(tools), this.createDynamicsTool(tools)];
  }

  /**
   * Динамика цены бумаги за период: свечи считает код, модель получает готовые
   * цифры (иначе она «вспоминает» чужие значения вместо данных брокера).
   */
  private createDynamicsTool(tools: DynamicStructuredTool[]): DynamicStructuredTool {
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    return new DynamicTool({
      name: PRICE_DYNAMICS_TOOL,
      description:
        'Динамика цены бумаги за период: изменение в валюте и процентах, минимум и максимум ' +
        'с датами. Используй для вопросов «почему упал/вырос X», «что с ценой за полгода».',
      schema: toZodV3({
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Тикер или название: PLZL, Полюс, SBER' },
          days: { type: 'number', description: 'Период в днях, по умолчанию 180' },
        },
        required: ['ticker'],
      }) as never,
      func: async (input: unknown) => {
        const args = (input ?? {}) as { ticker?: string; days?: number };
        const days = Number.isFinite(args.days) && Number(args.days) > 0 ? Number(args.days) : 180;
        return collectDynamics(
          { tool: (name) => byName.get(name), timeoutMs: this.config.value.run.mcpToolTimeoutMs },
          args.ticker ?? '',
          days,
        );
      },
    } as never);
  }

  /**
   * Сводка по всем открытым счетам одним инструментом: модель вызывает его сразу,
   * не перебирая счета вручную (иначе она смотрит только первый счёт из списка).
   * Схема — zod 3, как и у остальных инструментов (требование GigaChat).
   */
  private createAllAccountsTool(tools: DynamicStructuredTool[]): DynamicStructuredTool {
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    return new DynamicTool({
      name: ALL_ACCOUNTS_TOOL,
      description:
        'Состав и стоимость портфеля по ВСЕМ открытым счетам брокера: ' +
        'по каждому счёту — бумаги и количество, итоговая стоимость, доходность.',
      schema: toZodV3({ type: 'object', properties: {} }) as never,
      func: async () =>
        collectAllAccounts({
          tool: (name) => byName.get(name),
          timeoutMs: this.config.value.run.mcpToolTimeoutMs,
        }),
    } as never);
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

  /** Бюджет на один прогон: значения из конфигурации (`RUN_TOOL_MAX_CALLS`, `RUN_DEADLINE_MS`). */
  createBudget(): ToolBudget {
    return new ToolBudget({
      maxCalls: this.config.value.run.toolMaxCalls,
      deadlineMs: this.config.value.run.deadlineMs,
    });
  }

  /** Начало прогона: создаёт бюджет для сессии. */
  beginRun(sessionId: string): void {
    if (sessionId) {
      this.budgets.set(sessionId, this.createBudget());
    }
  }

  /** Завершение прогона: бюджет сессии больше не нужен. */
  endRun(sessionId: string): void {
    this.budgets.delete(sessionId);
  }
}
