import { DynamicStructuredTool } from '@langchain/core/tools';
import { toZodV3 } from '../../../mcp/tool-schema.js';
import { mapMarketValues } from '../../../parsing/mappers/market-values.mapper.js';
import { invokeTool, resolveInstrumentId, summarizeFields, type ToolLookup } from './facade.js';

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
}

const schemaOf = (properties: Record<string, unknown>, required: string[]): never =>
  toZodV3({ type: 'object', properties, required }) as never;

const tickerSchema = {
  ticker: { type: 'string', description: 'Тикер или название: SBER, PLZL, Полюс' },
};

/** Создаёт шесть фасадов: они вызывают MCP и возвращают компактный текст. */
export const createInstrumentTools = (options: InstrumentToolsOptions): DynamicStructuredTool[] => {
  const { lookup, timeoutMs } = options;

  const find = new DynamicStructuredTool({
    name: INSTRUMENT_TOOLS.find,
    description:
      'Найти бумагу по тикеру или названию: тикер, класс торгов, название, тип. ' +
      'Используй первым, если бумага названа словами.',
    schema: schemaOf({ query: { type: 'string', description: 'Тикер или название' } }, ['query']),
    func: async (input: unknown) => {
      const args = (input ?? {}) as { query?: string };
      const raw = await invokeTool(lookup, 'invest_find_instrument', { query: args.query ?? '' }, timeoutMs);
      return summarizeFields(raw, ['ticker', 'classCode', 'name', 'instrumentType', 'currency'], 600);
    },
  } as never);

  const prices = new DynamicStructuredTool({
    name: INSTRUMENT_TOOLS.prices,
    description: 'Текущая цена бумаги и валюта. Для «сколько стоит» и точечных вопросов по цене.',
    schema: schemaOf(tickerSchema, ['ticker']),
    func: async (input: unknown) => {
      const { ticker } = (input ?? {}) as { ticker?: string };
      const { instrumentId } = await resolveInstrumentId(lookup, ticker ?? '', timeoutMs);
      const raw = await invokeTool(
        lookup,
        'invest_get_market_values',
        { instrumentIds: [instrumentId] },
        timeoutMs,
      );
      const found = mapMarketValues(raw);
      const money = found.get(instrumentId) ?? [...found.values()][0];
      return money ? `цена за 1 шт.: ${money.amount.toFixed(2)} ${money.currency}` : 'цена не найдена';
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
        { instrumentId, from: from.toISOString(), to: to.toISOString(), interval: '1d' },
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
      return summarizeFields(
        raw,
        ['targetPrice', 'priceChange', 'recommendation', 'consensus', 'currency'],
        400,
      );
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
      const raw = await invokeTool(lookup, 'invest_get_share', { instrumentId }, timeoutMs).catch(
        () => invokeTool(lookup, 'invest_get_bond', { instrumentId }, timeoutMs),
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
