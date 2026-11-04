import { formatMoney, formatNumber, UNAVAILABLE } from '../../agent/report/portfolio-report.js';
import { resultsInGroup } from '../../collection/executor.js';
import { mapMarketValues, priceOf } from '../../tools/mappers/market-values.mapper.js';
import type { Money } from '../../tools/mappers/money.js';
import { mapPositions } from '../../tools/mappers/positions.mapper.js';
import type { FactContext, FactProvider, SectionFacts } from '../engine.js';
import { formatPercent, renderDistribution, renderKpi, renderTable } from '../renderers.js';
import { sectorByTicker, UNKNOWN_SECTOR } from '../sector.js';

export interface Holding {
  ticker: string;
  name: string;
  className: string;
  currency: string;
  quantity: number;
  price?: Money;
  value?: Money;
}

const CLASS_KINDS: [RegExp, string][] = [
  [/^TQBR$/, 'акции'],
  [/^TQTF$|^TQIF$|^TQTD$|^TQTE$/, 'фонды'],
  [/^TQCB$|^TQOB$/, 'облигации'],
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

/** Позиции всех счетов с ценами и стоимостью из пакетного запроса цен. */
export const holdingsOf = (ctx: FactContext): Holding[] => {
  const currency = portfolioCurrency(ctx);
  const prices = new Map<string, Money>();

  for (const { text } of resultsInGroup(ctx.plan, ctx.collected, 'prices')) {
    for (const [key, value] of mapMarketValues(asJson(text))) {
      prices.set(key, value);
    }
  }

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

export const snapshotProvider: FactProvider = {
  id: 'portfolio.snapshot',
  section(ctx: FactContext): SectionFacts | undefined {
    const holdings = aggregateHoldings(holdingsOf(ctx)).filter((holding) => holding.quantity !== 0);
    if (holdings.length === 0) {
      return { missing: 'в портфеле нет позиций или состав недоступен' };
    }
    const total = totalValue(holdings);
    const currency = holdings[0]?.currency ?? 'RUB';

    const rows = holdings.slice(0, 20).map((holding) => [
      holding.ticker,
      holding.name,
      formatNumber(holding.quantity),
      holding.price ? formatMoney(holding.price) : UNAVAILABLE,
      holding.value ? formatMoney(holding.value) : UNAVAILABLE,
    ]);

    return {
      markdown: [
        renderTable(['Тикер', 'Название', 'Кол-во', 'Цена', 'Стоимость'], rows),
        `Итого по текущим ценам: ${formatNumber(total)} ${currency}`,
      ].join('\n'),
      structured: { holdings, total, currency },
      brief: `Позиций: ${holdings.length}, стоимость по текущим ценам ${formatNumber(total)} ${currency}`,
    };
  },
};

export const structureProvider: FactProvider = {
  id: 'portfolio.structure',
  section(ctx: FactContext): SectionFacts | undefined {
    const holdings = holdingsOf(ctx).filter((holding) => (holding.value?.amount ?? 0) > 0);
    if (holdings.length === 0) {
      return { missing: 'нет данных о стоимости позиций' };
    }

    // Секторы — из справочника активов: собран в группе `reference`.
    const sectors = sectorByTicker(
      resultsInGroup(ctx.plan, ctx.collected, 'reference').map(({ entry, text }) => ({
        target: entry.target,
        text,
      })),
    );

    const byClass = distribute(holdings, (holding) => holding.className, (holding) => holding.value?.amount ?? 0);
    const bySector = distribute(
      holdings,
      (holding) => sectors.get(holding.ticker) ?? UNKNOWN_SECTOR,
      (holding) => holding.value?.amount ?? 0,
    );
    const byCurrency = distribute(holdings, (holding) => holding.currency, (holding) => holding.value?.amount ?? 0);
    const byIssuer = distribute(holdings, (holding) => holding.ticker, (holding) => holding.value?.amount ?? 0);

    const block = (title: string, rows: { name: string; amount: number; share: number }[]): string =>
      [
        `${title}:`,
        renderDistribution(
          rows.slice(0, 8).map((row) => ({ ...row, amount: formatNumber(row.amount) })),
        ),
      ].join('\n');

    return {
      markdown: [
        block('Класс актива', byClass),
        block('Сектор', bySector),
        block('Валюта', byCurrency),
        block('Эмитент', byIssuer),
      ].join('\n\n'),
      structured: { byClass, bySector, byCurrency, byIssuer },
      brief: [
        byClass.map((row) => `${row.name} ${formatPercent(row.share)}`).join(', '),
        `секторы: ${bySector
          .slice(0, 5)
          .map((row) => `${row.name} ${formatPercent(row.share)}`)
          .join(', ')}`,
      ].join('; '),
    };
  },
};

export const concentrationProvider: FactProvider = {
  id: 'portfolio.concentration',
  section(ctx: FactContext): SectionFacts | undefined {
    const holdings = holdingsOf(ctx).filter((holding) => (holding.value?.amount ?? 0) > 0);
    const total = totalValue(holdings);
    if (total <= 0) {
      return { missing: 'нет данных о стоимости позиций' };
    }

    const sorted = [...holdings].sort(
      (left, right) => (right.value?.amount ?? 0) - (left.value?.amount ?? 0),
    );
    const topShare = (sorted[0]?.value?.amount ?? 0) / total;
    const topThree =
      sorted.slice(0, 3).reduce((sum, holding) => sum + (holding.value?.amount ?? 0), 0) / total;
    const issuers = new Set(holdings.map((holding) => holding.ticker)).size;

    const { concentrationHigh, concentrationMedium } = ctx.template.thresholds;
    const level =
      topShare >= concentrationHigh
        ? 'высокая'
        : topShare >= concentrationMedium
          ? 'умеренная'
          : 'низкая';

    return {
      markdown: renderKpi([
        {
          label: 'Крупнейшая позиция',
          value: `${sorted[0]?.ticker ?? UNAVAILABLE} — ${formatPercent(topShare)}`,
        },
        { label: 'Топ-3 позиции', value: formatPercent(topThree) },
        { label: 'Эмитентов в портфеле', value: String(issuers) },
        { label: 'Концентрация', value: level },
      ]),
      structured: { topShare, topThree, issuers, level },
      brief: `Крупнейшая позиция ${formatPercent(topShare)}, топ-3 ${formatPercent(topThree)}, концентрация ${level}`,
    };
  },
};

export const gapsProvider: FactProvider = {
  id: 'portfolio.gaps',
  section(ctx: FactContext): SectionFacts | undefined {
    const holdings = holdingsOf(ctx).filter((holding) => (holding.value?.amount ?? 0) > 0);
    if (holdings.length === 0) {
      return { missing: 'нет данных о составе портфеля' };
    }

    const sectors = sectorByTicker(
      resultsInGroup(ctx.plan, ctx.collected, 'reference').map(({ entry, text }) => ({
        target: entry.target,
        text,
      })),
    );

    const minShare = ctx.template.thresholds.minClassShare;
    const byClass = distribute(holdings, (holding) => holding.className, (holding) => holding.value?.amount ?? 0);
    const bySector = distribute(
      holdings,
      (holding) => sectors.get(holding.ticker) ?? UNKNOWN_SECTOR,
      (holding) => holding.value?.amount ?? 0,
    );

    const classGaps = ['акции', 'фонды', 'облигации']
      .map((name) => ({ name, share: byClass.find((row) => row.name === name)?.share ?? 0 }))
      .filter((row) => row.share < minShare);
    // Секторы ниже порога: только те, что реально есть в портфеле и известны.
    const sectorGaps = bySector.filter(
      (row) => row.name !== UNKNOWN_SECTOR && row.share < minShare,
    );
    const unknownSector = bySector.find((row) => row.name === UNKNOWN_SECTOR);

    const lines: string[] = [`Порог минимальной доли: ${formatPercent(minShare)}`];
    lines.push(
      classGaps.length > 0
        ? `• классы ниже порога: ${classGaps.map((row) => `${row.name} ${formatPercent(row.share)}`).join(', ')}`
        : '• классы активов: явных пробелов нет',
    );
    lines.push(
      sectorGaps.length > 0
        ? `• секторы ниже порога: ${sectorGaps
            .map((row) => `${row.name} ${formatPercent(row.share)}`)
            .join(', ')}`
        : '• секторы: недопредставленных нет',
    );
    if (unknownSector) {
      lines.push(
        `• сектор не определён у ${formatPercent(unknownSector.share)} портфеля: справочник активов не дал сектор`,
      );
    }

    return {
      markdown: lines.join('\n'),
      structured: { classGaps, sectorGaps, minShare, unknownSectorShare: unknownSector?.share },
      brief: [
        classGaps.length > 0
          ? `классы ниже порога: ${classGaps.map((row) => `${row.name} ${formatPercent(row.share)}`).join(', ')}`
          : 'классы в норме',
        sectorGaps.length > 0
          ? `секторы ниже порога: ${sectorGaps.map((row) => row.name).join(', ')}`
          : 'секторы в норме',
      ].join('; '),
    };
  },
};
