import { DynamicStructuredTool } from '@langchain/core/tools';
import { toZodV3 } from '../../../transports/mcp/tool-schema.js';
import { mapMarketValues } from '../../../shared/parsing/mappers/market-values.mapper.js';
import { invokeTool, pickBestInstrument, resolveInstrumentId, summarizeFields, type ToolLookup } from './facade.js';
import { asJson } from '../../../shared/json.js';

/** Фасады инструментов: шесть доменных операций вместо десятков вызовов брокера. */
export const INSTRUMENT_TOOLS = {
  find: 'instruments__find',
  prices: 'instruments__prices',
  candles: 'instruments__candles',
  forecast: 'instruments__forecast',
  dividends: 'instruments__dividends',
  meta: 'instruments__meta',
} as const;

export interface InstrumentToolsOptions {
  lookup: ToolLookup;
  timeoutMs: number;
  /** Сколько миллисекунд держать последнюю цену: защита от лимита частоты брокера. */
  priceCacheTtlMs?: number;
  /** Время в тестах: иначе кэш нельзя проверить детерминированно. */
  now?: () => number;
}

const DEFAULT_PRICE_CACHE_TTL_MS = 30_000;

const schemaOf = (properties: Record<string, unknown>, required: string[]): never =>
  toZodV3({ type: 'object', properties, required }) as never;

const tickerSchema = {
  ticker: { type: 'string', description: 'Тикер или название: SBER, PLZL, Полюс' },
};

/** Коды рекомендаций MCP → слова, понятные пользователю и модели. */
const RECOMMENDATIONS: Record<string, string> = {
  RECOMMENDATION_BUY: 'покупать',
  RECOMMENDATION_SELL: 'продавать',
  RECOMMENDATION_HOLD: 'держать',
};

/** Поле MCP: строка, число или вложенный объект `{ value }`. */
const valueAt = (record: Record<string, unknown>, field: string): string | undefined => {
  const value = record[field];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const inner = (value as { value?: unknown } | undefined)?.value;
  if (typeof inner === 'string' && inner.trim().length > 0) {
    return inner;
  }
  return typeof inner === 'number' ? String(inner) : undefined;
};

/**
 * Прогноз аналитиков в компактном виде.
 *
 * `invest_get_forecast` отдаёт вложенные объекты (`consensus: { value: "383.8" }`),
 * а не плоские `targetPrice`/`priceChange`. Из-за этого общий `summarizeFields`
 * показывал модели только рекомендацию, и она отвечала «прогноз недоступен»,
 * хотя цель и потенциал в ответе были.
 */
export const formatForecast = (raw: unknown): string => {
  const root = asJson(raw) as { consensus?: Record<string, unknown> } | undefined;
  const consensus = root?.consensus;
  if (!consensus) {
    return 'прогноза аналитиков нет';
  }

  const currency = valueAt(consensus, 'currency');
  const suffix = currency ? ` ${currency}` : '';
  const parts: string[] = [];

  const recommendation = valueAt(consensus, 'recommendation');
  if (recommendation) {
    parts.push(`рекомендация: ${RECOMMENDATIONS[recommendation] ?? recommendation}`);
  }
  const target = valueAt(consensus, 'consensus');
  if (target) {
    parts.push(`цель аналитиков: ${target}${suffix}`);
  }
  const min = valueAt(consensus, 'minTarget');
  const max = valueAt(consensus, 'maxTarget');
  if (min && max) {
    parts.push(`диапазон целей: ${min}–${max}${suffix}`);
  }
  const current = valueAt(consensus, 'currentPrice');
  if (current) {
    parts.push(`текущая цена: ${current}${suffix}`);
  }
  const relative = valueAt(consensus, 'priceChangeRel');
  if (relative) {
    parts.push(`потенциал: ${relative}%`);
  } else {
    const absolute = valueAt(consensus, 'priceChange');
    if (absolute) {
      parts.push(`изменение цели: ${absolute}${suffix}`);
    }
  }

  return parts.length > 0 ? parts.join(', ') : 'прогноза аналитиков нет';
};

/** Создаёт шесть фасадов: они вызывают MCP и возвращают компактный текст. */
export const createInstrumentTools = (options: InstrumentToolsOptions): DynamicStructuredTool[] => {
  const { lookup, timeoutMs } = options;
  const priceCacheTtlMs = options.priceCacheTtlMs ?? DEFAULT_PRICE_CACHE_TTL_MS;
  const now = options.now ?? (() => Date.now());
  /**
   * Последняя цена по тикеру. Нужна не для экономии, а для деградации:
   * брокер ограничивает частоту, и вместо «не удалось» лучше отдать
   * предыдущее значение с временем и пометкой.
   */
  const priceCache = new Map<string, { text: string; at: number }>();
  const timeOf = (at: number): string =>
    new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const find = new DynamicStructuredTool({
    name: INSTRUMENT_TOOLS.find,
    description:
      'Найти бумагу по тикеру или названию: тикер, класс торгов, название, тип. ' +
      'Используй первым, если бумага названа словами.',
    schema: schemaOf({ query: { type: 'string', description: 'Тикер или название' } }, ['query']),
    func: async (input: unknown) => {
      const args = (input ?? {}) as { query?: string };
      // `STATIC_DATA` обязателен: без него в ответе нет вида инструмента,
      // и поиск «Сегежа» возвращал облигацию вместо акции SGZH.
      const raw = await invokeTool(
        lookup,
        'invest_find_instrument',
        { query: args.query ?? '', responseView: ['BASE', 'IDENTIFIERS', 'STATIC_DATA'] },
        timeoutMs,
      );
      // Первым идёт лучший инструмент: акция важнее облигации с тем же названием.
      const best = pickBestInstrument(raw, args.query ?? '') ?? raw;
      return summarizeFields(best, ['ticker', 'classCode', 'name', 'instrumentType', 'currency'], 600);
    },
  } as never);

  const prices = new DynamicStructuredTool({
    name: INSTRUMENT_TOOLS.prices,
    description: 'Текущая цена бумаги и валюта. Для «сколько стоит» и точечных вопросов по цене.',
    schema: schemaOf(tickerSchema, ['ticker']),
    func: async (input: unknown) => {
      const { ticker } = (input ?? {}) as { ticker?: string };
      const key = (ticker ?? '').trim().toUpperCase();
      const cached = key.length > 0 ? priceCache.get(key) : undefined;
      // Свежая цена из кэша: повторный вопрос не должен упираться в лимит брокера.
      if (cached && now() - cached.at < priceCacheTtlMs) {
        return cached.text;
      }
      try {
        const { instrumentId } = await resolveInstrumentId(lookup, ticker ?? '', timeoutMs);
        const raw = await invokeTool(
          lookup,
          'invest_get_market_values',
          // MCP ждёт массив идентификаторов в поле `instrumentId` (не `instrumentIds`).
          { instrumentId: [instrumentId] },
          timeoutMs,
        );
        const found = mapMarketValues(raw);
        const money = found.get(instrumentId) ?? [...found.values()][0];
        if (!money) {
          return 'цена не найдена';
        }
        const text = `цена за 1 шт.: ${money.amount.toFixed(2)} ${money.currency}`;
        if (key.length > 0) {
          priceCache.set(key, { text, at: now() });
        }
        return text;
      } catch (error) {
        // 429 от брокера: последняя известная цена полезнее отказа модели.
        // Текст без слова «Error» — иначе модель принимает его за сбой и отказывается отвечать.
        if ((error as { code?: string }).code === 'mcp_rate_limited') {
          return cached
            ? `${cached.text} (по данным на ${timeOf(cached.at)}; сервис брокера временно ограничил частоту запросов, значение может быть неактуальным)`
            : 'цена временно недоступна: сервис брокера ограничил частоту запросов. Повторите вопрос через минуту.';
        }
        throw error;
      }
    },
  } as never);

  const candles = new DynamicStructuredTool({
    name: INSTRUMENT_TOOLS.candles,
    description:
      'История цен за период: изменение, минимум и максимум. Для «почему упал», «что с ценой».',
    schema: schemaOf(
      {
        ...tickerSchema,
        days: { type: 'number', description: 'Период в днях, по умолчанию 180' },
      },
      ['ticker'],
    ),
    func: async (input: unknown) => {
      const { ticker, days } = (input ?? {}) as { ticker?: string; days?: number };
      const period = Number.isFinite(days) && Number(days) > 0 ? Number(days) : 180;
      const { instrumentId } = await resolveInstrumentId(lookup, ticker ?? '', timeoutMs);
      const to = new Date();
      const from = new Date(to.getTime() - period * 24 * 60 * 60 * 1000);
      const raw = await invokeTool(
        lookup,
        'invest_get_candles',
        { instrumentId, from: from.toISOString(), to: to.toISOString(), interval: 'CANDLE_INTERVAL_DAY' },
        timeoutMs,
      );
      return summarizeFields(raw, ['open', 'close', 'high', 'low', 'volume'], 400);
    },
  } as never);

  const forecast = new DynamicStructuredTool({
    name: INSTRUMENT_TOOLS.forecast,
    description: 'Прогноз аналитиков: целевая цена, потенциал, мнение. Для «стоит ли», «перспективы».',
    schema: schemaOf(tickerSchema, ['ticker']),
    func: async (input: unknown) => {
      const { ticker } = (input ?? {}) as { ticker?: string };
      const { instrumentId } = await resolveInstrumentId(lookup, ticker ?? '', timeoutMs);
      const raw = await invokeTool(lookup, 'invest_get_forecast', { instrumentId }, timeoutMs);
      return formatForecast(raw);
    },
  } as never);

  const dividends = new DynamicStructuredTool({
    name: INSTRUMENT_TOOLS.dividends,
    description: 'Дивиденды: размер, доходность, даты отсечки и выплаты.',
    schema: schemaOf(tickerSchema, ['ticker']),
    func: async (input: unknown) => {
      const { ticker } = (input ?? {}) as { ticker?: string };
      const { instrumentId } = await resolveInstrumentId(lookup, ticker ?? '', timeoutMs);
      const raw = await invokeTool(lookup, 'invest_get_share_dividends', { instrumentId }, timeoutMs);
      return summarizeFields(
        raw,
        ['dividendNet', 'yield', 'declaredDate', 'lastBuyDate', 'paymentDate', 'regularity'],
        500,
      );
    },
  } as never);

  const meta = new DynamicStructuredTool({
    name: INSTRUMENT_TOOLS.meta,
    description: 'Справочник бумаги: сектор, тип, валюта; для облигации — купон, погашение, НКД.',
    schema: schemaOf(tickerSchema, ['ticker']),
    func: async (input: unknown) => {
      const { ticker } = (input ?? {}) as { ticker?: string };
      const { instrumentId } = await resolveInstrumentId(lookup, ticker ?? '', timeoutMs);
      // `idType` обязателен; `INSTRUMENT_ID_TYPE_ID` принимает `TICKER_CLASSCODE`.
      // Без `responseView` брокер отдаёт только имя и uid — полей карточки не будет.
      const args = {
        instrumentId,
        idType: 'INSTRUMENT_ID_TYPE_ID',
        responseView: ['BASE', 'IDENTIFIERS', 'STATIC_DATA'],
      };
      const raw = await invokeTool(lookup, 'invest_get_share', args, timeoutMs).catch(() =>
        invokeTool(
          lookup,
          'invest_get_bond',
          { ...args, responseView: ['BASE', 'ADDITIONAL_INFO', 'STATIC_DATA'] },
          timeoutMs,
        ),
      );
      return summarizeFields(
        raw,
        ['sector', 'name', 'instrumentType', 'currency', 'coupon', 'maturityDate', 'accruedInterest'],
        500,
      );
    },
  } as never);

  return [find, prices, candles, forecast, dividends, meta];
};
