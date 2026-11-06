import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { AppConfigService } from '../../config/app-config.service.js';
import type { McpServerConfig } from '../../config/env.schema.js';
import { isForbiddenTool } from '../../config/env.schema.js';
import { missingAllowedTools, selectAllowedTools, wrapTool } from './mcp-tool.adapter.js';
import { buildNewsRegistry } from '../../news/news.factory.js';
import type { NewsRegistry } from '../../news/news.registry.js';
import { buildKeyRateSource } from '../../key-rate/key-rate.factory.js';
import type { KeyRateSource } from '../../key-rate/key-rate.types.js';
import { buildCommoditySource } from '../../commodities/commodity.factory.js';
import type { CommoditySource } from '../../commodities/commodity.types.js';
import { ToolBudget } from './tool-budget.js';
import { createThematicTools } from './local-tools.js';
import {
  createAllAccountsTool,
} from '../../tools/portfolio-snapshot/portfolio-snapshot.tool.js';
import {
  createPriceDynamicsTool,
} from '../../tools/price-dynamics/price-dynamics.tool.js';

export const MCP_CLIENT_FACTORY = Symbol('MCP_CLIENT_FACTORY');
/** Локальный инструмент знаний: тонкая обёртка над `KnowledgeService`. */
export const KNOWLEDGE_TOOL = Symbol('KNOWLEDGE_TOOL');

/** Тематические имена локальных инструментов (см. спецификацию data-sources). */
export const PORTFOLIO_SNAPSHOT_TOOL = 'portfolio__snapshot';
export const MARKET_DYNAMICS_TOOL = 'market__price_dynamics';
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
    @Optional() @Inject(KNOWLEDGE_TOOL) private readonly knowledgeTool?: DynamicStructuredTool,
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

    const byName = new Map<string, (typeof tools)[number]>();
    for (const tool of tools) {
      byName.set(tool.name, tool);
      // Источники ищут инструмент по короткому имени (`invest_get_news`),
      // а в наборе он лежит с префиксом сервера (`tinkoff__invest_get_news`).
      const separator = tool.name.indexOf('__');
      if (separator > 0) {
        byName.set(tool.name.slice(separator + 2), tool);
      }
    }
    this.newsRegistry = buildNewsRegistry({
      config: this.config.value,
      tool: (name) => byName.get(name),
    });
    this.keyRate = buildKeyRateSource({ config: this.config.value });
    this.commodity = buildCommoditySource({ config: this.config.value });

    this.toolsCache = [
      ...tools,
      // Тематические имена (см. data-sources) и алиасы старых имён на время миграции.
      createAllAccountsTool(tools, PORTFOLIO_SNAPSHOT_TOOL, this.config.value.run.mcpToolTimeoutMs),
      createPriceDynamicsTool(tools, MARKET_DYNAMICS_TOOL, this.config.value.run.mcpToolTimeoutMs),
      ...createThematicTools({ newsRegistry: this.newsRegistry, keyRate: this.keyRate, commodity: this.commodity, byName, config: { timeoutMs: this.config.value.run.mcpToolTimeoutMs, scanPages: this.config.value.sources.news.scanPages, maxItems: this.config.value.sources.news.maxItems, taxKeywordsFile: this.config.value.sources.taxKeywordsFile } }),
      ...(this.knowledgeTool ? [this.knowledgeTool] : []),
    ];
  }

  /** Новостные источники прогона: новости и налоги. */
  private newsRegistry?: NewsRegistry;
  /** Источник ключевой ставки: отдельная фича, не новости. */
  private keyRate?: KeyRateSource;
  /** Учётные цены металлов ЦБ: сырьевой фактор для бумаг вроде PLZL. */
  private commodity?: CommoditySource;

  get news(): NewsRegistry | undefined {
    return this.newsRegistry;
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

  /** Инструмент по имени: сначала локальные, затем с префиксом сервера. */
  toolByName(name: string): DynamicStructuredTool | undefined {
    return (
      this.toolsCache.find((tool) => tool.name === name) ??
      this.toolsCache.find((tool) => tool.name === `tinkoff__${name}`)
    );
  }

  /** Бюджет активного прогона сессии. */
  budgetOf(sessionId: string): ToolBudget | undefined {
    return this.budgets.get(sessionId);
  }

  /** Бюджет исчерпан (вызовы или время): нужен для честной пометки частичности. */
  isBudgetExhausted(sessionId: string): boolean {
    const budget = this.budgets.get(sessionId);
    return budget ? !budget.hasCallsLeft() || budget.isExpired() : false;
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
