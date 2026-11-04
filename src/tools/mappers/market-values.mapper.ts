import { McpInvalidResponseError } from '../errors.js';
import { normalizeCurrency, parseMoney, type Money, type MoneySource } from './money.js';

type Raw = Record<string, unknown>;

const asRecord = (value: unknown): Raw | undefined =>
  typeof value === 'object' && value !== null ? (value as Raw) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Порядок предпочтения цен: последняя сделка, затем вечерняя сессия, затем закрытие. */
const PREFERRED = [
  'INSTRUMENT_VALUE_LAST_PRICE',
  'INSTRUMENT_VALUE_LAST_PRICE_DEALER',
  'INSTRUMENT_VALUE_EVENING_SESSION_PRICE',
  'INSTRUMENT_VALUE_CLOSE_PRICE',
];

/**
 * Цены из `invest_get_market_values`: ключ — `TICKER_CLASSCODE` (`SBER_TQBR`).
 *
 * `invest_get_positions` отдаёт только количество бумаг, поэтому стоимость позиции
 * считается здесь: цена × количество. Валюта берётся из `priceCurrency` (у фьючерсов
 * это `pt` — пункты, они не пересчитываются в рубли).
 */
export const mapMarketValues = (raw: unknown): Map<string, Money> => {
  const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  const root = asRecord(parsed);
  if (!root) {
    throw new McpInvalidResponseError('Ответ инструмента цен не является объектом');
  }

  const prices = new Map<string, Money>();
  const instruments = Array.isArray(root.instruments) ? root.instruments : [];

  for (const item of instruments) {
    const instrument = asRecord(item);
    const ticker = asString(instrument?.ticker);
    if (!instrument || !ticker) {
      continue;
    }

    const currency = normalizeCurrency(asString(instrument.priceCurrency) ?? 'rub');
    const values = Array.isArray(instrument.values) ? instrument.values : [];
    const byType = new Map<string, Money>();
    for (const entry of values) {
      const value = asRecord(entry);
      const type = asString(value?.type);
      const money = parseMoney(asRecord(value?.value) as MoneySource | undefined, currency);
      if (type && money) {
        byType.set(type, money);
      }
    }

    const price = PREFERRED.map((type) => byType.get(type)).find((money) => money !== undefined);
    if (!price) {
      continue;
    }

    const classCode = asString(instrument.classCode);
    prices.set(`${ticker.toUpperCase()}_${classCode ?? ''}`, price);
    prices.set(`${ticker.toUpperCase()}_`, price);
  }

  return prices;
};

/** Цена позиции по ключу `TICKER_CLASSCODE`; без `classCode` — по тикеру. */
export const priceOf = (
  prices: Map<string, Money>,
  ticker: string,
  classCode?: string,
): Money | undefined => prices.get(`${ticker.toUpperCase()}_${classCode ?? ''}`) ?? prices.get(`${ticker.toUpperCase()}_`);
