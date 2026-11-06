import { resultsInGroup } from '../../collection/executor.js';
import { mapMarketValues, priceOf } from '../../../../shared/parsing/mappers/market-values.mapper.js';
import type { Money } from '../../../../shared/parsing/mappers/money.js';
import { mapPositions } from '../../../../shared/parsing/mappers/positions.mapper.js';
import type { FactContext } from '../../engine.js';

/** Позиция портфеля с ценой и стоимостью: база для всех расчётов отчёта. */
export interface Holding {
  ticker: string;
  name: string;
  className: string;
  /** Код режима торгов: по нему определяется категория облигации. */
  classCode?: string;
  currency: string;
  quantity: number;
  price?: Money;
  value?: Money;
}

const CLASS_KINDS: [RegExp, string][] = [
  [/^TQBR$/, 'акции'],
  [/^TQTF$|^TQIF$|^TQTD$|^TQTE$/, 'фонды'],
  [/^TQCB$|^TQOB$|^TQIR$|^TQMO$|^TQTC$|^TQBD$|^TQOD$|^PSAU$|^PTOB$/, 'облигации'],
  [/^SPBFUT$/, 'фьючерсы'],
];

/** Класс бумаги по режиму торгов: акции, фонды, облигации, фьючерсы, прочее. */
export const instrumentKind = (classCode?: string): string => {
  if (!classCode) {
    return 'прочее';
  }
  return CLASS_KINDS.find(([pattern]) => pattern.test(classCode))?.[1] ?? 'прочее';
};

const asJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const portfolioCurrency = (ctx: FactContext): string => {
  for (const { text } of resultsInGroup(ctx.plan, ctx.collected, 'portfolio')) {
    const root = asJson(text) as { totalAmountCurrencies?: { currency?: string }[] };
    const currency = root?.totalAmountCurrencies?.[0]?.currency;
    if (typeof currency === 'string' && currency.length > 0) {
      return currency.toUpperCase();
    }
  }
  return 'RUB';
};

/**
 * Стоимость портфеля по данным брокера: `totalAmountCurrencies` из портфеля.
 * Нужна, чтобы доля бумаги считалась от всего портфеля даже в разборе по бумаге,
 * где в выборке остаётся одна позиция.
 */
export const portfolioTotalOf = (ctx: FactContext): number | undefined => {
  for (const { text } of resultsInGroup(ctx.plan, ctx.collected, 'portfolio')) {
    const root = asJson(text) as {
      totalAmountCurrencies?: { units?: string; nano?: number; value?: string }[];
    };
    const amount = root?.totalAmountCurrencies?.[0];
    if (!amount) {
      continue;
    }
    const fromParts = Number(amount.units ?? 0) + Number(amount.nano ?? 0) / 1_000_000_000;
    const parsed = Number.isFinite(fromParts) && fromParts > 0 ? fromParts : Number(amount.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
};

/** Цены из пакетного запроса: нужны и позициям, и разбору бумаги без портфеля. */
export const pricesOf = (ctx: FactContext): Map<string, Money> => {
  const prices = new Map<string, Money>();
  for (const { text } of resultsInGroup(ctx.plan, ctx.collected, 'prices')) {
    for (const [key, value] of mapMarketValues(asJson(text))) {
      prices.set(key, value);
    }
  }
  return prices;
};

/** Позиции всех счетов с ценами и стоимостью из пакетного запроса цен. */
export const holdingsOf = (ctx: FactContext): Holding[] => {
  const currency = portfolioCurrency(ctx);
  const prices = pricesOf(ctx);

  const holdings: Holding[] = [];
  for (const { text } of resultsInGroup(ctx.plan, ctx.collected, 'portfolio')) {
    let positions;
    try {
      positions = mapPositions(text, currency);
    } catch {
      continue;
    }
    for (const position of positions) {
      const price = priceOf(prices, position.instrument.ticker, position.instrument.classCode);
      const quantity = position.quantity.amount;
      holdings.push({
        ticker: position.instrument.ticker,
        name: position.instrument.name,
        className: instrumentKind(position.instrument.classCode),
        classCode: position.instrument.classCode,
        currency: price?.currency ?? currency,
        quantity,
        price,
        value:
          price && price.amount > 0
            ? {
                amount: Math.round(price.amount * quantity * 100) / 100,
                currency: price.currency,
                raw: String(price.amount),
                isPoints: price.isPoints,
              }
            : undefined,
      });
    }
  }
  return holdings;
};

export const totalValue = (holdings: Holding[]): number =>
  holdings.reduce((sum, holding) => sum + (holding.value?.amount ?? 0), 0);

/** Деньги в ответе брокера: `{value}` или `{units, nano}`. */
const moneyAmount = (raw: unknown): number | undefined => {
  const record = raw as { value?: string; units?: string; nano?: number } | undefined;
  if (!record) {
    return undefined;
  }
  if (typeof record.value === 'string' && record.value.trim() !== '') {
    const parsed = Number(record.value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const fromParts = Number(record.units ?? 0) + Number(record.nano ?? 0) / 1_000_000_000;
  return Number.isFinite(fromParts) ? fromParts : undefined;
};

/** Доходность портфеля: абсолютная прибыль, проценты за всё время и за день. */
export interface PortfolioYield {
  amount?: number;
  /** Доходность к вложенному: прибыль / (стоимость − прибыль). */
  pct?: number;
  dailyPct?: number;
  currency: string;
}

export const portfolioYieldOf = (ctx: FactContext): PortfolioYield | undefined => {
  for (const { text } of resultsInGroup(ctx.plan, ctx.collected, 'portfolio')) {
    const root = asJson(text) as {
      expectedYield?: unknown;
      dailyYieldRelative?: { value?: string };
      totalAmountPortfolio?: { currency?: string };
      totalValue?: { currency?: string };
    };
    const amount = moneyAmount(root?.expectedYield);
    const total = moneyAmount(root?.totalAmountPortfolio ?? root?.totalValue);
    const dailyPct = Number(root?.dailyYieldRelative?.value);
    if (amount === undefined && !Number.isFinite(dailyPct)) {
      continue;
    }
    const invested = total !== undefined && amount !== undefined ? total - amount : undefined;
    return {
      amount,
      pct: amount !== undefined && invested !== undefined && invested > 0 ? (amount / invested) * 100 : undefined,
      dailyPct: Number.isFinite(dailyPct) ? dailyPct : undefined,
      currency: (root?.totalAmountPortfolio?.currency ?? root?.totalValue?.currency ?? 'rub').toUpperCase(),
    };
  }
  return undefined;
};

/** Доли по разрезу: значение → сумма и доля. */
export const distribute = <T>(
  items: T[],
  key: (item: T) => string,
  amount: (item: T) => number,
): { name: string; amount: number; share: number }[] => {
  const total = items.reduce((sum, item) => sum + amount(item), 0);
  const sums = new Map<string, number>();
  for (const item of items) {
    const name = key(item);
    sums.set(name, (sums.get(name) ?? 0) + amount(item));
  }
  return [...sums.entries()]
    .map(([name, sum]) => ({ name, amount: sum, share: total > 0 ? sum / total : 0 }))
    .sort((left, right) => right.amount - left.amount);
};

/**
 * Свёртка позиций по тикеру: одна бумага на нескольких счетах показывается
 * одной строкой, иначе таблица дублирует её и завышает число позиций.
 */
export const aggregateHoldings = (holdings: Holding[]): Holding[] => {
  const aggregated = new Map<string, Holding>();
  for (const holding of holdings) {
    const key = `${holding.ticker}|${holding.currency}`;
    const existing = aggregated.get(key);
    if (!existing) {
      aggregated.set(key, { ...holding });
      continue;
    }
    existing.quantity += holding.quantity;
    if (holding.value) {
      existing.value = {
        ...holding.value,
        amount: Math.round(((existing.value?.amount ?? 0) + holding.value.amount) * 100) / 100,
      };
    }
  }
  return [...aggregated.values()];
};

/** Позиции, которые участвуют в расчётах: свёрнутые по тикеру и с известной стоимостью. */
export const valuedHoldings = (ctx: FactContext): Holding[] =>
  aggregateHoldings(holdingsOf(ctx))
    .filter((holding) => (holding.value?.amount ?? 0) > 0)
    .sort((left, right) => (right.value?.amount ?? 0) - (left.value?.amount ?? 0));
