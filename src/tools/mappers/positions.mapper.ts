import { McpInvalidResponseError } from '../errors.js';
import { normalizeCurrency, parseDecimal } from './money.js';
import type { PortfolioPosition } from './portfolio.mapper.js';

type Raw = Record<string, unknown>;

const asRecord = (value: unknown): Raw | undefined =>
  typeof value === 'object' && value !== null ? (value as Raw) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const listOf = (value: unknown): Raw[] =>
  Array.isArray(value) ? value.map(asRecord).filter((item): item is Raw => item !== undefined) : [];

const quantityOf = (item: Raw, key: string): number | undefined => {
  const raw = item[key];
  if (typeof raw === 'string' && raw.trim() !== '') {
    return parseDecimal(raw);
  }
  if (typeof raw === 'number') {
    return raw;
  }
  return undefined;
};

/**
 * Позиции из `invest_get_positions`: `get_portfolio` в текущем API отдаёт только
 * итоги, а бумаги приходят здесь — `securities`, `futures`, `options` с полем
 * `balance` (у бумаг ещё `ticker`/`classCode`).
 *
 * Цены и стоимость позиции этот инструмент не отдаёт: они остаются `undefined`
 * и в отчёте помечаются как «недоступно», а не подставляются нулём.
 */
export const mapPositions = (raw: unknown, currency = 'rub'): PortfolioPosition[] => {
  // Адаптер MCP отдаёт текст ответа, а тесты и отладка — уже разобранный объект.
  const parsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return raw;
          }
        })()
      : raw;

  const root = asRecord(parsed);
  if (!root) {
    throw new McpInvalidResponseError('Ответ инструмента позиций не является объектом');
  }

  const code = normalizeCurrency(currency);
  const rows: PortfolioPosition[] = [];

  const push = (item: Raw, kind: 'security' | 'future' | 'option'): void => {
    const balance = quantityOf(item, 'balance');
    if (balance === undefined) {
      return;
    }

    const ticker = asString(item.ticker);
    const uid = asString(item.instrumentUid) ?? asString(item.positionUid) ?? ticker;
    if (!ticker || !uid) {
      return;
    }

    rows.push({
      instrument: {
        uid,
        positionUid: asString(item.positionUid),
        ticker: ticker.toUpperCase(),
        name: asString(item.name) ?? ticker.toUpperCase(),
        classCode: asString(item.classCode),
        isin: asString(item.isin),
      },
      quantity: { amount: balance, currency: code, raw: String(balance), isPoints: false },
      currentPrice: undefined,
      positionValue: undefined,
    });
    void kind;
  };

  for (const item of listOf(root.securities)) {
    push(item, 'security');
  }
  for (const item of listOf(root.futures)) {
    push(item, 'future');
  }
  for (const item of listOf(root.options)) {
    push(item, 'option');
  }

  return rows;
};
