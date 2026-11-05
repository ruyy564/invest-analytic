import { McpInvalidResponseError } from '../../mcp/errors.js';
import { mapInstrument, type InstrumentRef } from './instrument.mapper.js';
import { normalizeCurrency, parseMoney, type Money, type MoneySource } from './money.js';

export interface PortfolioPosition {
  instrument: InstrumentRef;
  quantity: Money;
  currentPrice?: Money;
  positionValue?: Money;
}

export interface Portfolio {
  accountId?: string;
  currency: string;
  totalValue?: Money;
  expectedYield?: Money;
  positions: PortfolioPosition[];
  /**
   * `true`, если у счёта есть стоимость, но массив позиций в ответе не пришёл:
   * пустым портфелем это называть нельзя (иначе теряются данные, как на реальных счетах).
   */
  positionsUnavailable?: boolean;
  /** Время данных: `time` из ответа, иначе момент разбора. */
  dataAsOf: string;
}

type Raw = Record<string, unknown>;

const asRecord = (value: unknown): Raw | undefined =>
  typeof value === 'object' && value !== null ? (value as Raw) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asMoney = (value: unknown, currency: string): Money | undefined =>
  parseMoney(asRecord(value) as MoneySource | undefined, currency);

/**
 * Приводит ответ инструмента портфеля к доменной модели.
 * Деньги остаются в валюте портфеля, пункты (`pt`) не пересчитываются.
 */
export const mapPortfolio = (raw: unknown, now: Date = new Date()): Portfolio => {
  const root = asRecord(raw);
  if (!root) {
    throw new McpInvalidResponseError('Ответ инструмента портфеля не является объектом');
  }

  const rawCurrency = asString(root.currency) ?? 'rub';
  const positionsRaw = Array.isArray(root.positions) ? root.positions : [];

  const positions = positionsRaw.map((item, index) => {
    const position = asRecord(item);
    if (!position) {
      throw new McpInvalidResponseError(`Позиция #${index} в ответе MCP не является объектом`);
    }

    const instrument = mapInstrument({
      uid: asString(position.instrumentUid),
      positionUid: asString(position.positionUid),
      ticker: asString(position.ticker),
      name: asString(position.name),
      classCode: asString(position.classCode),
      isin: asString(position.isin),
    });

    const quantitySource = asRecord(position.quantity) ?? {
      value: asString(position.quantity) ?? '',
    };
    const quantity = parseMoney(quantitySource as unknown as MoneySource, rawCurrency);
    if (!quantity) {
      throw new McpInvalidResponseError(`У позиции ${instrument.ticker} нет количества`);
    }

    return {
      instrument,
      quantity,
      currentPrice: asMoney(position.currentPrice, rawCurrency),
      positionValue: asMoney(position.positionValue, rawCurrency),
    };
  });

  // Текущий API отдаёт итог в `totalAmountPortfolio`; `totalValue` — старый формат.
  const totalValue = asMoney(root.totalAmountPortfolio ?? root.totalValue, rawCurrency);
  const expectedYield = asMoney(root.expectedYield, rawCurrency);

  return {
    accountId: asString(root.accountId),
    currency: normalizeCurrency(rawCurrency),
    totalValue,
    expectedYield,
    positions,
    // Инструмент `invest_get_portfolio` некоторых версий API отдаёт только итоги:
    // непустой счёт без массива позиций — это «данных нет», а не «позиций нет».
    positionsUnavailable:
      positionsRaw.length === 0 && (totalValue?.amount ?? 0) > 0 && root.positions === undefined,
    dataAsOf: asString(root.time) ?? now.toISOString(),
  };
};
