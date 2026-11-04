import { formatMoney, formatNumber, UNAVAILABLE } from '../../agent/report/portfolio-report.js';
import { resultsInGroup } from '../../collection/executor.js';
import { mapMarketValues, priceOf } from '../../tools/mappers/market-values.mapper.js';
import type { Money } from '../../tools/mappers/money.js';
import { mapPositions } from '../../tools/mappers/positions.mapper.js';
import type { FactContext, FactProvider, SectionFacts } from '../engine.js';
import { formatChangePct, periodChanges, seriesByTicker } from '../market-facts.js';
import { formatPercent, renderDistribution, renderKpi, renderTable } from '../renderers.js';
import { sectorByTicker, UNKNOWN_SECTOR } from '../sector.js';
import { parseForecast, RECOMMENDATIONS } from './market.js';

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

/** Сектор по тикерам из собранного справочника активов. */
export const sectorMapOf = (ctx: FactContext): Map<string, string> =>
  sectorByTicker(
    resultsInGroup(ctx.plan, ctx.collected, 'reference').map(({ entry, text }) => ({
      target: entry.target,
      text,
    })),
  );

/** Позиции, которые участвуют в расчётах: свёрнутые по тикеру и с известной стоимостью. */
export const valuedHoldings = (ctx: FactContext): Holding[] =>
  aggregateHoldings(holdingsOf(ctx))
    .filter((holding) => (holding.value?.amount ?? 0) > 0)
    .sort((left, right) => (right.value?.amount ?? 0) - (left.value?.amount ?? 0));

/**
 * Главная таблица отчёта: бумага, сектор, доля в портфеле, стоимость,
 * изменение за 180 дней и мнение аналитиков. Сектор и рост — то, с чего
 * начинается разбор каждой бумаги.
 */
export const tableProvider: FactProvider = {
  id: 'portfolio.table',
  section(ctx: FactContext): SectionFacts | undefined {
    const holdings = valuedHoldings(ctx);
    if (holdings.length === 0) {
      return { missing: 'в портфеле нет позиций или состав недоступен' };
    }

    const total = totalValue(holdings);
    const sectors = sectorMapOf(ctx);
    const series = seriesByTicker(
      resultsInGroup(ctx.plan, ctx.collected, 'candles').map(({ entry, text }) => ({
        target: entry.target,
        text,
      })),
    );
    const forecasts = new Map(
      resultsInGroup(ctx.plan, ctx.collected, 'analytics').flatMap(({ entry, text }) => {
        const facts = parseForecast(text);
        return entry.target && facts ? [[entry.target, facts] as const] : [];
      }),
    );

    const rows = holdings.map((holding) => {
      const share = total > 0 ? (holding.value?.amount ?? 0) / total : 0;
      const priceSeries = series.get(holding.ticker);
      const change = priceSeries ? periodChanges(priceSeries, ['180d'], ctx.now)[0] : undefined;
      const forecast = forecasts.get(holding.ticker);
      return [
        holding.ticker,
        sectors.get(holding.ticker) ?? UNKNOWN_SECTOR,
        formatPercent(share),
        holding.value ? formatMoney(holding.value) : UNAVAILABLE,
        change ? formatChangePct(change.changePct) : UNAVAILABLE,
        forecast?.upside === undefined
          ? (RECOMMENDATIONS[forecast?.recommendation ?? ''] ?? UNAVAILABLE)
          : `${RECOMMENDATIONS[forecast.recommendation ?? ''] ?? 'мнение'} ${formatChangePct(forecast.upside)}`,
      ];
    });

    return {
      markdown: [
        renderTable(
          ['Тикер', 'Сектор', 'Доля', 'Стоимость', '180 дней', 'Аналитики'],
          rows,
        ),
        `Итого по текущим ценам: ${formatNumber(total)} ${holdings[0]?.currency ?? 'RUB'}`,
      ].join('\n'),
      structured: {
        total,
        currency: holdings[0]?.currency,
        rows: holdings.map((holding, index) => ({ ticker: holding.ticker, cells: rows[index] })),
      },
      brief: holdings
        .slice(0, 10)
        .map(
          (holding) =>
            `${holding.ticker} (${sectors.get(holding.ticker) ?? UNKNOWN_SECTOR}, ` +
            `${formatPercent(total > 0 ? (holding.value?.amount ?? 0) / total : 0)})`,
        )
        .join(', '),
    };
  },
};

export interface DistributionRow {
  name: string;
  amount: number;
  share: number;
}

export interface StructureFacts {
  byClass: DistributionRow[];
  bySector: DistributionRow[];
  byCurrency: DistributionRow[];
  byIssuer: DistributionRow[];
}

/** Разрезы портфеля: класс, сектор, валюта, эмитент. */
export const structureOf = (ctx: FactContext): StructureFacts | undefined => {
  const holdings = valuedHoldings(ctx);
  if (holdings.length === 0) {
    return undefined;
  }
  const sectors = sectorMapOf(ctx);
  const amount = (holding: Holding): number => holding.value?.amount ?? 0;

  return {
    byClass: distribute(holdings, (holding) => holding.className, amount),
    bySector: distribute(
      holdings,
      (holding) => sectors.get(holding.ticker) ?? UNKNOWN_SECTOR,
      amount,
    ),
    byCurrency: distribute(holdings, (holding) => holding.currency, amount),
    byIssuer: distribute(holdings, (holding) => holding.ticker, amount),
  };
};

export const structureProvider: FactProvider = {
  id: 'portfolio.structure',
  section(ctx: FactContext): SectionFacts | undefined {
    const structure = structureOf(ctx);
    if (!structure) {
      return { missing: 'нет данных о стоимости позиций' };
    }
    const { byClass, bySector, byCurrency, byIssuer } = structure;

    const block = (title: string, rows: DistributionRow[]): string =>
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
      structured: structure,
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

export interface ConcentrationFacts {
  total: number;
  top?: string;
  topShare: number;
  topThree: number;
  issuers: number;
  level: string;
}

/** Концентрация портфеля по порогам шаблона. */
export const concentrationOf = (ctx: FactContext): ConcentrationFacts | undefined => {
  const holdings = valuedHoldings(ctx);
  const total = totalValue(holdings);
  if (total <= 0) {
    return undefined;
  }

  const topShare = (holdings[0]?.value?.amount ?? 0) / total;
  const topThree =
    holdings.slice(0, 3).reduce((sum, holding) => sum + (holding.value?.amount ?? 0), 0) / total;
  const { concentrationHigh, concentrationMedium } = ctx.template.thresholds;
  const level =
    topShare >= concentrationHigh
      ? 'высокая'
      : topShare >= concentrationMedium
        ? 'умеренная'
        : 'низкая';

  return {
    total,
    top: holdings[0]?.ticker,
    topShare,
    topThree,
    issuers: holdings.length,
    level,
  };
};

export const concentrationProvider: FactProvider = {
  id: 'portfolio.concentration',
  section(ctx: FactContext): SectionFacts | undefined {
    const facts = concentrationOf(ctx);
    if (!facts) {
      return { missing: 'нет данных о стоимости позиций' };
    }

    return {
      markdown: renderKpi([
        {
          label: 'Крупнейшая позиция',
          value: `${facts.top ?? UNAVAILABLE} — ${formatPercent(facts.topShare)}`,
        },
        { label: 'Топ-3 позиции', value: formatPercent(facts.topThree) },
        { label: 'Бумаг в портфеле', value: String(facts.issuers) },
        { label: 'Концентрация', value: facts.level },
      ]),
      structured: facts,
      brief: `Крупнейшая позиция ${formatPercent(facts.topShare)}, топ-3 ${formatPercent(facts.topThree)}, концентрация ${facts.level}`,
    };
  },
};

export interface GapsFacts {
  minShare: number;
  classGaps: { name: string; share: number }[];
  sectorGaps: DistributionRow[];
  unknownSectorShare?: number;
  structure: StructureFacts;
}

/** Пробелы структуры: классы и секторы ниже минимальной доли. */
export const gapsOf = (ctx: FactContext): GapsFacts | undefined => {
  const structure = structureOf(ctx);
  if (!structure) {
    return undefined;
  }

  const minShare = ctx.template.thresholds.minClassShare;
  const classGaps = ['акции', 'фонды', 'облигации']
    .map((name) => ({
      name,
      share: structure.byClass.find((row) => row.name === name)?.share ?? 0,
    }))
    .filter((row) => row.share < minShare);
  // Секторы ниже порога: только те, что реально есть в портфеле и известны.
  const sectorGaps = structure.bySector.filter(
    (row) => row.name !== UNKNOWN_SECTOR && row.share < minShare,
  );
  const unknownSector = structure.bySector.find((row) => row.name === UNKNOWN_SECTOR);

  return {
    minShare,
    classGaps,
    sectorGaps,
    unknownSectorShare: unknownSector?.share,
    structure,
  };
};

export const gapsProvider: FactProvider = {
  id: 'portfolio.gaps',
  section(ctx: FactContext): SectionFacts | undefined {
    const facts = gapsOf(ctx);
    if (!facts) {
      return { missing: 'нет данных о составе портфеля' };
    }

    const lines: string[] = [`Порог минимальной доли: ${formatPercent(facts.minShare)}`];
    lines.push(
      facts.classGaps.length > 0
        ? `• классы ниже порога: ${facts.classGaps.map((row) => `${row.name} ${formatPercent(row.share)}`).join(', ')}`
        : '• классы активов: явных пробелов нет',
    );
    lines.push(
      facts.sectorGaps.length > 0
        ? `• секторы ниже порога: ${facts.sectorGaps
            .map((row) => `${row.name} ${formatPercent(row.share)}`)
            .join(', ')}`
        : '• секторы: недопредставленных нет',
    );
    // Нулевая доля — не пробел: строка «не определён у 0,00 %» только шумит.
    if (facts.unknownSectorShare !== undefined && facts.unknownSectorShare >= 0.001) {
      lines.push(
        `• сектор не определён у ${formatPercent(facts.unknownSectorShare)} портфеля: справочник активов не дал сектор`,
      );
    }

    return {
      markdown: lines.join('\n'),
      structured: {
        classGaps: facts.classGaps,
        sectorGaps: facts.sectorGaps,
        minShare: facts.minShare,
        unknownSectorShare: facts.unknownSectorShare,
      },
      brief: [
        facts.classGaps.length > 0
          ? `классы ниже порога: ${facts.classGaps.map((row) => `${row.name} ${formatPercent(row.share)}`).join(', ')}`
          : 'классы в норме',
        facts.sectorGaps.length > 0
          ? `секторы ниже порога: ${facts.sectorGaps.map((row) => row.name).join(', ')}`
          : 'секторы в норме',
      ].join('; '),
    };
  },
};
