/** Тикер без класса: `SBER_TQBR` → `SBER`. */
export const baseTicker = (instrumentId: string): string => instrumentId.split('_')[0];

/** Идентификатор инструмента для MCP: `TICKER_CLASSCODE`, если класс известен. */
export const instrumentKey = (ticker: string, classCode?: string): string =>
  classCode ? `${ticker}_${classCode}` : ticker;

/** Сколько бумаг получают расширенную аналитику (прогноз, дивиденды, новости). */
export const ANALYTICS_MAX_INSTRUMENTS = 5;

/** Сколько бумаг получают историю цен: разбор по бумагам нужен большинству. */
export const CANDLES_MAX_INSTRUMENTS = 10;

/** Глубина истории цен: хватает на периоды 1д / 7д / 30д / 180д и график 90 дней. */
export const CANDLES_DAYS = 365;

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
  | 'reports_calendar'
  | 'market_factors'
  | 'cb_meetings'
  | 'signals'
  | 'news'
  | 'tax'
  | 'macro'
  | 'commodities'
  | 'bonds'
  | 'bond_events'
  | 'bond_accrued'
  | 'insiders'
  | 'market_news'
  | 'indices';

/** Режимы торгов облигаций: по ним определяется категория бумаги и её купон. */
export const BOND_CLASS_CODES = [
  'TQCB',
  'TQOB',
  'TQIR',
  'TQMO',
  'TQTC',
  'TQBD',
  'TQOD',
  'PSAU',
  'PTOB',
] as const;

/** Бумага — облигация: по коду режима торгов. */
export const isBondClass = (classCode: string | undefined): boolean =>
  classCode !== undefined && (BOND_CLASS_CODES as readonly string[]).includes(classCode);

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
  /** Названия и алиасы компаний по тикерам: нужны лентам для фильтра новостей. */
  matchers?: Readonly<Record<string, readonly string[]>>;
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
      const values = ctx.matchers?.[ticker] ?? [];
      add({
        tool: 'market__news_digest',
        args: { tickers: [ticker], ...(values.length > 0 ? { names: [...values] } : {}) },
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
      // Облигация: категория, купон, погашение и НКД берутся из карточки,
      // календаря событий и накопленного дохода.
      if (isBondClass(id.split('_').slice(1).join('_'))) {
        const target = baseTicker(id);
        add({
          tool: 'invest_get_bond',
          args: {
            instrumentId: id,
            idType: 'INSTRUMENT_ID_TYPE_ID',
            responseView: ['FULL'],
          },
          group: 'bonds',
          priority: 'optional',
          target,
        });
        add({
          tool: 'invest_get_bond_events',
          args: { instrumentId: id },
          group: 'bond_events',
          priority: 'optional',
          target,
        });
        add({
          tool: 'invest_get_bond_accrued',
          args: {
            instrumentId: id,
            from: new Date(to.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString(),
            to: to.toISOString(),
          },
          group: 'bond_accrued',
          priority: 'optional',
          target,
        });
      }
    }
    // Сырьевой фактор: бумагам вроде PLZL важна цена металла, а не только свечи.
    if (ctx.tickers.length > 0) {
      add({ tool: 'macro__commodities', args: {}, group: 'commodities', priority: 'optional' });
    }
  }
  // Фон рынка: одна общая сводка на прогон — её дополняют новости по бумагам.
  if (wants('securities.detail') || wants('securities.opinions')) {
    add({ tool: 'market__news_digest', args: { days: 7 }, group: 'market_news', priority: 'optional' });
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
      // Сделки инсайдеров: ещё один фактический сигнал по бумаге (кто и когда покупал/продавал).
      add({
        tool: 'invest_get_insider_deals',
        args: { instrumentId: id },
        group: 'insiders',
        priority: 'optional',
        target,
      });
      // Календарь отчётности: даты публикаций — катализатор, а не догадка модели.
      add({
        tool: 'invest_get_instrument_reports',
        args: { instrumentId: id },
        group: 'reports_calendar',
        priority: 'optional',
        target,
      });
    }
    // Рыночные факторы числами: без них «что влияет» превращается в общие слова.
    add({ tool: 'market__factors', args: { days: 30 }, group: 'market_factors', priority: 'optional' });
    // План заседаний ЦБ: один запрос на прогон, даты — из файла регулятора.
    add({ tool: 'macro__cb_meetings', args: {}, group: 'cb_meetings', priority: 'optional' });
  }

  return { entries, maxInstruments: ctx.maxInstruments };
};

/**
 * Записи справочника для определения секторов вынесены в `reference.ts`:
 * сектор отдаёт бренд, поэтому путь — `share → asset → brand`.
 */
