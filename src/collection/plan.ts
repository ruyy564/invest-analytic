/** Тикер без класса: `SBER_TQBR` → `SBER`. */
export const baseTicker = (instrumentId: string): string => instrumentId.split('_')[0];

/** Идентификатор инструмента для MCP: `TICKER_CLASSCODE`, если класс известен. */
export const instrumentKey = (ticker: string, classCode?: string): string =>
  classCode ? `${ticker}_${classCode}` : ticker;

/** Сколько бумаг получают расширенную аналитику (прогноз, дивиденды, новости). */
export const ANALYTICS_MAX_INSTRUMENTS = 5;

/** Сколько бумаг получают историю цен: разбор по бумагам нужен большинству. */
export const CANDLES_MAX_INSTRUMENTS = 10;

/** Глубина истории цен для периодов 1д / 7д / 30д / 180д. */
export const CANDLES_DAYS = 180;

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
  /** Названия компаний по тикерам: нужны лентам для фильтра новостей. */
  names?: Readonly<Record<string, string>>;
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

  // Ценовая история дешевле аналитики: один вызов на бумагу без поиска инструмента.
  const priced = topTickers(ctx.tickers, Math.min(ctx.maxInstruments, CANDLES_MAX_INSTRUMENTS));
  const analysable = topTickers(ctx.tickers, ANALYTICS_MAX_INSTRUMENTS);
  const wants = (provider: string): boolean => ctx.providers.includes(provider);

  if (wants('securities.opinions')) {
    // Новости — только по конкретной бумаге: общая лента не влияет на решения.
    for (const id of analysable) {
      const ticker = baseTicker(id);
      const name = ctx.names?.[ticker];
      add({
        tool: 'market__news_digest',
        args: { tickers: [ticker], ...(name ? { names: [name] } : {}) },
        group: 'news',
        priority: 'mandatory',
        target: ticker,
      });
    }
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
  if (wants('securities.detail')) {
    // Свечи — одна запись на бумагу: `TICKER_CLASSCODE` уже известен из позиций,
    // поиск инструмента не нужен, а период считает код, а не модель.
    const to = new Date();
    const from = new Date(to.getTime() - CANDLES_DAYS * 24 * 60 * 60 * 1000);
    for (const id of priced) {
      add({
        tool: 'invest_get_candles',
        args: {
          instrumentId: id,
          interval: 'CANDLE_INTERVAL_DAY',
          from: from.toISOString(),
          to: to.toISOString(),
        },
        group: 'candles',
        priority: 'optional',
        target: baseTicker(id),
      });
    }
  }
  if (wants('securities.opinions')) {
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
    }
  }

  return { entries, maxInstruments: ctx.maxInstruments };
};

/**
 * Записи справочника для определения секторов вынесены в `reference.ts`:
 * сектор отдаёт бренд, поэтому путь — `share → asset → brand`.
 */
