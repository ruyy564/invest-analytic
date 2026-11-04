import type { CoverageEntry } from '../sources/registry.js';

/** Тикер без класса: `SBER_TQBR` → `SBER`. */
export const baseTicker = (instrumentId: string): string => instrumentId.split('_')[0];

/** Идентификатор инструмента для MCP: `TICKER_CLASSCODE`, если класс известен. */
export const instrumentKey = (ticker: string, classCode?: string): string =>
  classCode ? `${ticker}_${classCode}` : ticker;

/** Сколько бумаг получают расширенную аналитику (прогноз, дивиденды, инсайдеры). */
export const ANALYTICS_MAX_INSTRUMENTS = 5;

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
  // Пери-тикерная аналитика — самая дорогая часть плана (3 запроса на бумагу):
  // берём только крупнейшие позиции, остальным хватает цен и структуры.
  const analysable = topTickers(ctx.tickers, ANALYTICS_MAX_INSTRUMENTS);
  const wants = (provider: string): boolean => ctx.providers.includes(provider);

  if (wants('news.digest')) {
    add({
      tool: 'market__news_digest',
      args: { tickers: [...new Set(detailed.map(baseTicker))] },
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
    for (const id of analysable) {
      // Свечи дорогие: инструмент ищет бумагу и может перебрать два класса.
      add({
        tool: 'market__price_dynamics',
        // Инструмент сам подбирает класс бумаги, поэтому передаём базовый тикер.
        args: { ticker: baseTicker(id), days: 180 },
        group: 'candles',
        priority: 'optional',
        target: baseTicker(id),
      });
    }
  }
  if (wants('market.analytics')) {
    for (const id of analysable) {
      const target = baseTicker(id);
      add({
        tool: 'invest_get_forecast',
        args: { instrumentId: id },
        group: 'analytics',
        priority: 'optional',
        target,
      });
      add({
        tool: 'invest_get_share_dividends',
        args: { instrumentId: id },
        group: 'dividends',
        priority: 'optional',
        target,
      });
      add({
        tool: 'invest_get_insider_deals',
        args: { instrumentId: id },
        group: 'signals',
        priority: 'optional',
        target,
      });
    }
    add({ tool: 'invest_list_signals', args: {}, group: 'signals', priority: 'optional' });
  }

  return { entries, maxInstruments: ctx.maxInstruments };
};

/** Сколько записей в плане (для запроса подтверждения). */
export const planSize = (plan: CollectionPlan): number => plan.entries.length;

/**
 * Записи справочника для определения секторов: `invest_get_asset` по uid актива.
 * Проверено на живом MCP: `invest_get_share` отдаёт только `instrument` без бренда,
 * а полный актив (`AssetFull`) содержит `brand.sector`.
 */
export const sectorEntries = (
  instruments: readonly { ticker: string; uid?: string }[],
): PlanEntry[] =>
  instruments.flatMap((instrument) => {
    if (!instrument.uid) {
      return [];
    }
    return [
      {
        tool: 'invest_get_asset',
        args: {
          instrumentId: instrument.uid,
          idType: 'INSTRUMENT_ID_TYPE_UID',
        },
        group: 'reference' as PlanGroup,
        priority: 'optional' as PlanPriority,
        target: instrument.ticker,
      },
    ];
  });

/** Виды данных, которые затронет прогон: их видит пользователь в подтверждении. */
export const planGroups = (plan: CollectionPlan): PlanGroup[] =>
  [...new Set(plan.entries.map((entry) => entry.group))].sort();

export type { CoverageEntry };
