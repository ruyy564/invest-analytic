import { resultsInGroup } from '../../../collection/executor.js';
import type { FactContext } from '../../engine.js';
import {
  formatChangePct,
  periodChanges,
  seriesByTicker,
  type PeriodChange,
} from '../../market-facts.js';
import { UNKNOWN_SECTOR } from '../../sector.js';
import { parseForecast, type ForecastFacts } from '../market.js';
import { portfolioTotalOf, sectorMapOf, totalValue, valuedHoldings } from '../portfolio/index.js';

/**
 * Факты по бумагам: позиции, секторы, динамика, прогнозы, дивиденды и новости.
 * Общая часть для секций «Разбор по бумагам» и «Оценка бумаг и секторов».
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
  /** Почему новостей нет: источник не ответил или публикаций не было. */
  newsNote?: string;
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

/**
 * Пояснение из текста сводки: почему новостей нет — источник не ответил или
 * публикаций по бумаге действительно не было.
 */
const noteOf = (text: string): string | undefined =>
  text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^Недоступные источники|^Новостей по портфелю/.test(line));

/** Причина «нет бумаг» зависит от области: счёт, бумага или портфель. */
export const noHoldingsReason = (ctx: FactContext): string => {
  if (ctx.scope === 'instrument' && ctx.scopeTarget) {
    return `бумаги ${ctx.scopeTarget.toUpperCase()} нет в портфеле`;
  }
  if (ctx.scope === 'account') {
    return 'на счёте нет бумаг или состав счёта недоступен';
  }
  return 'нет данных о составе портфеля';
};

/** Факты по бумагам: позиции, секторы, динамика, прогнозы, дивиденды, новости. */
export const securitiesOf = (ctx: FactContext): SecurityFacts[] => {
  const all = valuedHoldings(ctx);
  // В разборе бумаги показываем только её, но долю считаем от всего портфеля.
  const target = ctx.scope === 'instrument' ? ctx.scopeTarget?.toUpperCase() : undefined;
  const holdings = target ? all.filter((holding) => holding.ticker.toUpperCase() === target) : all;
  const total = portfolioTotalOf(ctx) ?? totalValue(all);
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
  const news = byTicker('news', (text) => ({
    items: headlinesOf(text, 3),
    note: noteOf(text),
  }));

  return holdings.map((holding) => {
    const priceSeries = series.get(holding.ticker);
    const headlines = news.get(holding.ticker);
    return {
      ticker: holding.ticker,
      sector: sectors.get(holding.ticker) ?? UNKNOWN_SECTOR,
      share: total > 0 ? (holding.value?.amount ?? 0) / total : 0,
      value: holding.value?.amount,
      periods: priceSeries ? periodChanges(priceSeries, ctx.template.periods, ctx.now) : [],
      forecast: forecasts.get(holding.ticker),
      dividends: dividends.get(holding.ticker),
      news: headlines?.items ?? [],
      newsNote: headlines?.note,
    };
  });
};

/** Строка динамики: «1 день -1,06 %, 7 дней +0,82 %, 180 дней +12,34 %». */
export const periodsLine = (periods: PeriodChange[]): string =>
  periods.map((change) => `${change.label} ${formatChangePct(change.changePct)}`).join(', ');
