import { formatNumber, UNAVAILABLE } from '../../agent/report/portfolio-report.js';
import { resultsInGroup } from '../../collection/executor.js';
import type { FactContext, FactProvider, SectionFacts } from '../engine.js';
import {
  formatChangePct,
  periodChanges,
  seriesByTicker,
  trendWord,
  type PeriodChange,
} from '../market-facts.js';
import { formatPercent } from '../renderers.js';
import { UNKNOWN_SECTOR } from '../sector.js';
import { parseForecast, RECOMMENDATIONS, type ForecastFacts } from './market.js';
import { sectorMapOf, totalValue, valuedHoldings } from './portfolio.js';

/**
 * Разбор по бумагам: у каждой бумаги сектор, доля, движение цены за периоды,
 * мнение аналитиков, дивиденды и её собственные новости. Новости общей ленты
 * сюда не попадают — они не влияют на бумагу.
 */

export interface SecurityFacts {
  ticker: string;
  sector: string;
  share: number;
  value?: number;
  periods: PeriodChange[];
  forecast?: ForecastFacts;
  dividends?: number;
  news: string[];
}

const asJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** Сколько записей в первом массиве ответа: дивиденды, сделки, сигналы. */
const countItems = (text: string): number | undefined => {
  const parsed = asJson(text);
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      return value.length;
    }
  }
  return undefined;
};

/** Заголовки новостей из текста сводки: строки списка без служебных примечаний. */
const headlinesOf = (text: string, limit: number): string[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('•'))
    .map((line) => line.replace(/^•\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, limit);

/** Факты по бумагам: позиции, секторы, динамика, прогнозы, дивиденды, новости. */
export const securitiesOf = (ctx: FactContext): SecurityFacts[] => {
  const holdings = valuedHoldings(ctx);
  const total = totalValue(holdings);
  const sectors = sectorMapOf(ctx);
  const series = seriesByTicker(
    resultsInGroup(ctx.plan, ctx.collected, 'candles').map(({ entry, text }) => ({
      target: entry.target,
      text,
    })),
  );

  const byTicker = <T>(group: string, parse: (text: string) => T | undefined): Map<string, T> =>
    new Map(
      resultsInGroup(ctx.plan, ctx.collected, group).flatMap(({ entry, text }) => {
        const value = parse(text);
        return entry.target && value !== undefined ? [[entry.target, value] as const] : [];
      }),
    );

  const forecasts = byTicker('analytics', parseForecast);
  const dividends = byTicker('dividends', countItems);
  const news = byTicker('news', (text) => headlinesOf(text, 3));

  return holdings.map((holding) => {
    const priceSeries = series.get(holding.ticker);
    return {
      ticker: holding.ticker,
      sector: sectors.get(holding.ticker) ?? UNKNOWN_SECTOR,
      share: total > 0 ? (holding.value?.amount ?? 0) / total : 0,
      value: holding.value?.amount,
      periods: priceSeries ? periodChanges(priceSeries, ctx.template.periods, ctx.now) : [],
      forecast: forecasts.get(holding.ticker),
      dividends: dividends.get(holding.ticker),
      news: news.get(holding.ticker) ?? [],
    };
  });
};

/** Строка динамики: «1 день -1,06 %, 7 дней +0,82 %, 180 дней +12,34 %». */
const periodsLine = (periods: PeriodChange[]): string =>
  periods.map((change) => `${change.label} ${formatChangePct(change.changePct)}`).join(', ');

export const securitiesProvider: FactProvider = {
  id: 'securities.detail',
  section(ctx: FactContext): SectionFacts | undefined {
    const securities = securitiesOf(ctx);
    if (securities.length === 0) {
      return { missing: 'нет данных о составе портфеля' };
    }

    const blocks = securities.map((security) => {
      const lines = [
        `**${security.ticker} — ${security.sector}, ${formatPercent(security.share)} портфеля**`,
        `• стоимость: ${security.value === undefined ? UNAVAILABLE : formatNumber(security.value)} RUB`,
      ];

      if (security.periods.length > 0) {
        const longest = security.periods.at(-1) as PeriodChange;
        lines.push(
          `• цена: ${periodsLine(security.periods)} — ${trendWord(longest.change)} за ${longest.label}`,
        );
      } else {
        lines.push('• цена: истории меньше периода, движение посчитать нельзя');
      }

      const forecast = security.forecast;
      if (forecast) {
        const parts = [
          RECOMMENDATIONS[forecast.recommendation ?? ''] ?? 'мнение без рекомендации',
          forecast.consensus !== undefined ? `цель ${formatNumber(forecast.consensus)}` : undefined,
          forecast.upside !== undefined
            ? `потенциал ${formatChangePct(forecast.upside)}`
            : undefined,
        ].filter((part): part is string => part !== undefined);
        lines.push(`• аналитики: ${parts.join(', ')}`);
      } else {
        lines.push('• аналитики: прогноза нет');
      }

      if (security.dividends !== undefined) {
        lines.push(`• дивиденды: ${security.dividends} выплат в истории`);
      }
      lines.push(
        security.news.length > 0
          ? `• новости бумаги: ${security.news.join('; ')}`
          : '• новости бумаги: публикаций по тикеру нет',
      );

      return lines.join('\n');
    });

    return {
      markdown: blocks.join('\n\n'),
      structured: securities,
      brief: securities
        .slice(0, 8)
        .map((security) => `${security.ticker}: ${security.sector}, ${formatPercent(security.share)}`)
        .join('; '),
    };
  },
};

/**
 * Выжимка для модели: по каждой бумаге — сектор, доля, динамика и потенциал,
 * по секторам — доля и средневзвешенное движение за 180 дней. Модель оценивает
 * бумаги и секторы, не выдумывая числа.
 */
export const opinionsProvider: FactProvider = {
  id: 'securities.opinions',
  section(ctx: FactContext): SectionFacts | undefined {
    const securities = securitiesOf(ctx);
    if (securities.length === 0) {
      return { missing: 'нет данных о составе портфеля' };
    }

    const longest = (security: SecurityFacts): PeriodChange | undefined =>
      security.periods.find((change) => change.period === '180d') ?? security.periods.at(-1);

    const sectors = new Map<string, { share: number; weighted: number; weight: number }>();
    for (const security of securities) {
      const change = longest(security);
      const bucket = sectors.get(security.sector) ?? { share: 0, weighted: 0, weight: 0 };
      bucket.share += security.share;
      if (change && security.value !== undefined) {
        bucket.weighted += change.changePct * security.value;
        bucket.weight += security.value;
      }
      sectors.set(security.sector, bucket);
    }

    const perSecurity = securities.map((security) => {
      const change = longest(security);
      return [
        `${security.ticker} (${security.sector}, ${formatPercent(security.share)}`,
        change ? `, ${change.label} ${formatChangePct(change.changePct)}` : ', динамики нет',
        security.forecast?.upside !== undefined
          ? `, потенциал ${formatChangePct(security.forecast.upside)}`
          : ', потенциала нет',
        `, новостей ${security.news.length})`,
      ].join('');
    });

    const perSector = [...sectors.entries()].map(([name, bucket]) =>
      bucket.weight > 0
        ? `${name} ${formatPercent(bucket.share)} (180 дней ${formatChangePct(
            bucket.weighted / bucket.weight,
          )})`
        : `${name} ${formatPercent(bucket.share)} (динамики нет)`,
    );

    return {
      markdown: [
        `Бумаги: ${perSecurity.join('; ')}`,
        `Секторы: ${perSector.join('; ')}`,
      ].join('\n'),
      structured: { perSecurity, perSector },
      brief: [`бумаги: ${perSecurity.join('; ')}`, `секторы: ${perSector.join('; ')}`]
        .join(' | ')
        .slice(0, 2_000),
    };
  },
};

