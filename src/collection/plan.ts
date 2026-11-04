import type { CoverageEntry } from '../sources/registry.js';

/** Приоритет записи плана: обязательные источники выполняются первыми. */
export type PlanPriority = 'mandatory' | 'optional';

/** Вид данных: по нему отчёт понимает, что именно получено. */
export type PlanGroup =
  | 'accounts'
  | 'portfolio'
  | 'prices'
  | 'candles'
  | 'reference'
  | 'analytics'
  | 'dividends'
  | 'fundamentals'
  | 'signals'
  | 'news'
  | 'tax'
  | 'macro'
  | 'indices';

export interface PlanEntry {
  /** Имя инструмента: MCP (`invest_get_candles`) или локальное (`macro__key_rate`). */
  tool: string;
  args: Record<string, unknown>;
  group: PlanGroup;
  priority: PlanPriority;
  /** Тикер или счёт, к которому относится запись. */
  target?: string;
}

export interface CollectionPlan {
  entries: PlanEntry[];
  /** Сколько бумаг берём в расширенную аналитику. */
  maxInstruments: number;
}

export interface PlanContext {
  accounts: readonly string[];
  tickers: readonly string[];
  maxInstruments: number;
  /** Какие поставщики фактов нужны шаблону отчёта. */
  providers: readonly string[];
}

/** Стабильный ключ записи: одинаковые запросы не выполняются дважды. */
export const planKey = (entry: PlanEntry): string =>
  `${entry.tool}|${JSON.stringify(entry.args, Object.keys(entry.args).sort())}`;

/** Бумаги для расширенной аналитики: крупнейшие по доле, не больше лимита. */
export const topTickers = (tickers: readonly string[], limit: number): string[] =>
  [...tickers].slice(0, Math.max(1, limit));

/**
 * План сбора под сценарий: обязательные источники (счета, портфель, цены,
 * новости) и дополнительная аналитика по крупнейшим бумагам.
 */
export const buildCollectionPlan = (ctx: PlanContext): CollectionPlan => {
  const entries: PlanEntry[] = [];
  const add = (entry: PlanEntry): void => {
    if (!entries.some((existing) => planKey(existing) === planKey(entry))) {
      entries.push(entry);
    }
  };

  add({ tool: 'invest_list_accounts', args: {}, group: 'accounts', priority: 'mandatory' });

  for (const accountId of ctx.accounts) {
    add({
      tool: 'invest_get_portfolio',
      args: { accountId },
      group: 'portfolio',
      priority: 'mandatory',
      target: accountId,
    });
    add({
      tool: 'invest_get_positions',
      args: { accountId },
      group: 'portfolio',
      priority: 'mandatory',
      target: accountId,
    });
  }

  if (ctx.tickers.length > 0) {
    add({
      tool: 'invest_get_market_values',
      args: { instrumentId: [...ctx.tickers] },
      group: 'prices',
      priority: 'mandatory',
    });
  }

  const detailed = topTickers(ctx.tickers, ctx.maxInstruments);
  const wants = (provider: string): boolean => ctx.providers.includes(provider);

  if (wants('news.digest')) {
    add({
      tool: 'market__news_digest',
      args: { tickers: [...detailed] },
      group: 'news',
      priority: 'mandatory',
    });
  }
  if (wants('tax.context')) {
    add({ tool: 'market__tax_watch', args: {}, group: 'tax', priority: 'optional' });
  }
  if (wants('macro.context')) {
    add({ tool: 'macro__key_rate', args: {}, group: 'macro', priority: 'mandatory' });
    add({
      tool: 'invest_list_indicatives',
      args: {},
      group: 'indices',
      priority: 'optional',
    });
  }
  if (wants('market.dynamics')) {
    for (const ticker of detailed) {
      add({
        tool: 'market__price_dynamics',
        args: { ticker, days: 180 },
        group: 'candles',
        priority: 'optional',
        target: ticker,
      });
    }
  }
  if (wants('market.analytics')) {
    for (const ticker of detailed) {
      add({
        tool: 'invest_get_forecast',
        args: { instrumentId: ticker },
        group: 'analytics',
        priority: 'optional',
        target: ticker,
      });
      add({
        tool: 'invest_get_share_dividends',
        args: { instrumentId: ticker },
        group: 'dividends',
        priority: 'optional',
        target: ticker,
      });
      add({
        tool: 'invest_get_insider_deals',
        args: { instrumentId: ticker },
        group: 'signals',
        priority: 'optional',
        target: ticker,
      });
    }
    add({ tool: 'invest_list_signals', args: {}, group: 'signals', priority: 'optional' });
  }

  return { entries, maxInstruments: ctx.maxInstruments };
};

/** Сколько записей в плане (для запроса подтверждения). */
export const planSize = (plan: CollectionPlan): number => plan.entries.length;

/**
 * Записи справочника для определения секторов: по одной на инструмент.
 * Тикер попадает в `target`, идентификатор актива — в аргумент.
 */
export const sectorEntries = (
  instruments: readonly { ticker: string; uid?: string }[],
): PlanEntry[] =>
  instruments
    .filter((instrument) => instrument.uid !== undefined && instrument.uid !== '')
    .map((instrument) => ({
      tool: 'invest_get_asset',
      args: { instrumentId: instrument.uid },
      group: 'reference' as PlanGroup,
      priority: 'optional' as PlanPriority,
      target: instrument.ticker,
    }));

/** Виды данных, которые затронет прогон: их видит пользователь в подтверждении. */
export const planGroups = (plan: CollectionPlan): PlanGroup[] =>
  [...new Set(plan.entries.map((entry) => entry.group))].sort();

export type { CoverageEntry };
