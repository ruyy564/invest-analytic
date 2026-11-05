import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import type { NewsRegistry } from '../news/news.registry.js';
import type { KeyRateSource } from '../key-rate/key-rate.types.js';
import {
  ALL_ACCOUNTS_TOOL,
  collectAllAccounts,
  openAccounts,
} from '../tools/portfolio-snapshot/portfolio-snapshot.tool.js';
import {
  collectDynamics,
  PRICE_DYNAMICS_TOOL,
} from '../tools/price-dynamics/price-dynamics.tool.js';
import {
  collectKeyRate,
  formatKeyRate,
  KEY_RATE_TOOL,
  loadTaxKeywords,
} from '../tools/key-rate/key-rate.tool.js';
import {
  collectNewsDigest,
  formatNewsDigest,
  NEWS_DIGEST_TOOL,
} from '../tools/news-digest/news-digest.tool.js';
import {
  collectTaxFacts,
  formatTaxFacts,
  TAX_WATCH_TOOL,
} from '../tools/tax-watch/tax-watch.tool.js';
import { withTimeout } from './mcp-tool.adapter.js';
import { toZodV3 } from './tool-schema.js';

/** Настройки, которые нужны локальным тулам: таймауты и лимиты выборки. */
export interface LocalToolsConfig {
  timeoutMs: number;
  scanPages: number;
  maxItems: number;
  taxKeywordsFile: string;
}

/**
 * Сводка по всем открытым счетам одним инструментом: модель вызывает его сразу,
 * не перебирая счета вручную. Схема — zod 3 (требование GigaChat).
 */
export const createAllAccountsTool = (
  tools: DynamicStructuredTool[],
  name: string,
  timeoutMs: number,
): DynamicStructuredTool => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return new DynamicTool({
    name,
    description:
      'Состав и стоимость портфеля по ВСЕМ открытым счетам брокера: ' +
      'по каждому счёту — бумаги и количество, итоговая стоимость, доходность.',
    schema: toZodV3({ type: 'object', properties: {} }) as never,
    func: async () => collectAllAccounts({ tool: (tool) => byName.get(tool), timeoutMs }),
  } as never);
};

/**
 * Динамика цены бумаги за период: свечи считает код, модель получает готовые
 * цифры (иначе она «вспоминает» чужие значения вместо данных брокера).
 */
export const createDynamicsTool = (
  tools: DynamicStructuredTool[],
  name: string,
  timeoutMs: number,
): DynamicStructuredTool => {
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
        { tool: (tool) => byName.get(tool), timeoutMs },
        args.ticker ?? '',
        days,
      );
    },
  } as never);
};

/** Открытые счета для налогового наблюдения: служебное чтение без подтверждения. */
export const openAccountIds = async (
  byName: Map<string, DynamicStructuredTool>,
  timeoutMs: number,
): Promise<string[]> => {
  const tool = byName.get('invest_list_accounts');
  if (!tool) {
    return [];
  }
  try {
    const raw = await withTimeout(
      tool.invoke({} as never),
      timeoutMs,
      () => new Error('таймаут списка счетов'),
    );
    return openAccounts(raw).map((account) => account.accountId);
  } catch {
    return [];
  }
};

/**
 * Тематические инструменты: тонкие обёртки над новостным реестром и источником
 * ставки. Логика — в тулах и источниках, здесь только схема и вызов.
 */
export const createThematicTools = (options: {
  newsRegistry?: NewsRegistry;
  keyRate?: KeyRateSource;
  byName: Map<string, DynamicStructuredTool>;
  config: LocalToolsConfig;
}): DynamicStructuredTool[] => {
  const { newsRegistry, keyRate, byName, config } = options;
  if (!newsRegistry) {
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
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Названия компаний бумаг: по ним фильтруются общие ленты',
        },
        days: { type: 'number', description: 'Глубина выборки в днях, по умолчанию 180' },
      },
    }) as never,
    func: async (input: unknown) => {
      const args = (input ?? {}) as { tickers?: string[]; names?: string[]; days?: number };
      const result = await collectNewsDigest(newsRegistry, {
        tickers: Array.isArray(args.tickers) ? args.tickers : [],
        names: Array.isArray(args.names) ? args.names : [],
        pages: config.scanPages,
        maxItems: config.maxItems,
      });
      const total = result.periods.reduce((sum, period) => sum + period.items.length, 0);
      if (total === 0) {
        // В отчёте видно только «новостей нет», причина — в логе.
        console.warn(
          '[news] пусто:',
          JSON.stringify(args.tickers ?? []),
          JSON.stringify(result.coverage.filter((entry) => entry.status !== 'ok' || !entry.items)),
        );
      }
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
      const accounts = await openAccountIds(byName, config.timeoutMs);
      const facts = await collectTaxFacts({
        registry: newsRegistry,
        tool: (tool) => byName.get(tool),
        timeoutMs: config.timeoutMs,
        accounts,
        keywords: loadTaxKeywords(config.taxKeywordsFile),
        pages: config.scanPages,
        maxItems: config.maxItems,
      });
      return formatTaxFacts(facts);
    },
  } as never);

  const keyRateTool = new DynamicTool({
    name: KEY_RATE_TOOL,
    description:
      'Ключевая ставка ЦБ: текущее значение, дата решения и история изменений с указанием источника.',
    schema: toZodV3({ type: 'object', properties: {} }) as never,
    func: async () => formatKeyRate(await collectKeyRate(keyRate)),
  } as never);

  return [newsTool, taxTool, ...(keyRate ? [keyRateTool] : [])];
};

export { ALL_ACCOUNTS_TOOL, PRICE_DYNAMICS_TOOL };

