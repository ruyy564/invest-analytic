import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import { AppConfigService } from '../config/app-config.service.js';
import type { McpServerConfig } from '../config/env.schema.js';
import { isForbiddenTool } from '../config/env.schema.js';
import { missingAllowedTools, selectAllowedTools, withTimeout, wrapTool } from './mcp-tool.adapter.js';
import { buildSourceRegistry } from '../sources/factory.js';
import type { SourceRegistry } from '../sources/registry.js';
import { ALL_ACCOUNTS_TOOL, collectAllAccounts, openAccounts } from './portfolio-snapshot.js';
import { collectDynamics, PRICE_DYNAMICS_TOOL } from './price-dynamics.js';
import { collectKeyRate, formatKeyRate, KEY_RATE_TOOL, loadTaxKeywords } from './thematic/key-rate.js';
import {
  collectNewsDigest,
  formatNewsDigest,
  NEWS_DIGEST_TOOL,
} from './thematic/news-digest.js';
import { collectTaxFacts, formatTaxFacts, TAX_WATCH_TOOL } from './thematic/tax-watch.js';
import { toZodV3 } from './tool-schema.js';
import { ToolBudget } from './tool-budget.js';

export const MCP_CLIENT_FACTORY = Symbol('MCP_CLIENT_FACTORY');

/** Тематические имена локальных инструментов (см. спецификацию data-sources). */
export const PORTFOLIO_SNAPSHOT_TOOL = 'portfolio__snapshot';
export const PORTFOLIO_REVIEW_TOOL = 'portfolio__review';
export const SECURITY_BRIEF_TOOL = 'security__brief';
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

    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    this.sources = buildSourceRegistry({
      config: this.config.value,
      tool: (name) => byName.get(name),
    });

    this.toolsCache = [
      ...tools,
      // Тематические имена (см. data-sources) и алиасы старых имён на время миграции.
      this.createAllAccountsTool(tools, PORTFOLIO_SNAPSHOT_TOOL),
      this.createAllAccountsTool(tools, ALL_ACCOUNTS_TOOL),
      this.createDynamicsTool(tools, MARKET_DYNAMICS_TOOL),
      this.createDynamicsTool(tools, PRICE_DYNAMICS_TOOL),
      ...this.createThematicTools(byName),
    ];
  }

  /** Источники данных прогона: новости, налоги, ключевая ставка. */
  private sources?: SourceRegistry;

  get sourceRegistry(): SourceRegistry | undefined {
    return this.sources;
  }

  /**
   * Тематические инструменты: тонкие обёртки над реестром источников.
   * Логика источников живёт в адаптерах, здесь только текст и схема аргументов.
   */
  private createThematicTools(
    byName: Map<string, DynamicStructuredTool>,
  ): DynamicStructuredTool[] {
    const registry = this.sources;
    if (!registry) {
      return [];
    }

    const newsTool = new DynamicTool({
      name: NEWS_DIGEST_TOOL,
      description:
        'Сводка новостей по бумагам портфеля и по общей ленте: свежие, за неделю, за месяц, ' +
        'за полгода. Источник и дата указаны у каждой новости.',
      schema: toZodV3({
        type: 'object',
        properties: {
          tickers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Тикеры портфеля, по которым нужны новости',
          },
          days: { type: 'number', description: 'Глубина выборки в днях, по умолчанию 180' },
        },
      }) as never,
      func: async (input: unknown) => {
        const args = (input ?? {}) as { tickers?: string[]; days?: number };
        const result = await collectNewsDigest(registry, {
          tickers: Array.isArray(args.tickers) ? args.tickers : [],
          pages: this.config.value.sources.news.scanPages,
          maxItems: this.config.value.sources.news.maxItems,
        });
        return formatNewsDigest(result);
      },
    } as never);

    const taxTool = new DynamicTool({
      name: TAX_WATCH_TOOL,
      description:
        'Налоги: фактически удержанные суммы из истории операций и публикации об изменениях ' +
        'налогообложения по словарю терминов.',
      schema: toZodV3({ type: 'object', properties: {} }) as never,
      func: async () => {
        const accounts = await this.openAccountIds(byName);
        const facts = await collectTaxFacts({
          registry,
          tool: (name) => byName.get(name),
          timeoutMs: this.config.value.run.mcpToolTimeoutMs,
          accounts,
          keywords: loadTaxKeywords(this.config.value.sources.taxKeywordsFile),
          pages: this.config.value.sources.news.scanPages,
          maxItems: this.config.value.sources.news.maxItems,
        });
        return formatTaxFacts(facts);
      },
    } as never);

    const keyRateTool = new DynamicTool({
      name: KEY_RATE_TOOL,
      description:
        'Ключевая ставка ЦБ: текущее значение, дата решения и история изменений с указанием источника.',
      schema: toZodV3({ type: 'object', properties: {} }) as never,
      func: async () => formatKeyRate(await collectKeyRate(registry)),
    } as never);

    return [
      newsTool,
      taxTool,
      ...(registry.hasKeyRate() ? [keyRateTool] : []),
    ];
  }

  /** Открытые счета для налогового наблюдения: служебное чтение без подтверждения. */
  private async openAccountIds(byName: Map<string, DynamicStructuredTool>): Promise<string[]> {
    const tool = byName.get('invest_list_accounts');
    if (!tool) {
      return [];
    }
    try {
      const raw = await withTimeout(
        tool.invoke({} as never),
        this.config.value.run.mcpToolTimeoutMs,
        () => new Error('таймаут списка счетов'),
      );
      return openAccounts(raw).map((account) => account.accountId);
    } catch {
      return [];
    }
  }

  /**
   * Динамика цены бумаги за период: свечи считает код, модель получает готовые
   * цифры (иначе она «вспоминает» чужие значения вместо данных брокера).
   */
  private createDynamicsTool(
    tools: DynamicStructuredTool[],
    name: string = PRICE_DYNAMICS_TOOL,
  ): DynamicStructuredTool {
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    return new DynamicTool({
      name,
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
  private createAllAccountsTool(
    tools: DynamicStructuredTool[],
    name: string = ALL_ACCOUNTS_TOOL,
  ): DynamicStructuredTool {
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    return new DynamicTool({
      name,
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
