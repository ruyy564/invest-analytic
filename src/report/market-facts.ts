import { formatNumber } from '../agent/report/portfolio-report.js';
import { mapCandles, type PricePoint } from '../tools/price-dynamics/price-dynamics.tool.js';
import type { ReportPeriod } from './template.js';

/**
 * Рыночные факты отчёта: ряды цен из свечей и изменения за периоды.
 * Все числа считает код — модель их только комментирует.
 */

export interface PriceSeries {
  ticker: string;
  currency: string;
  points: PricePoint[];
}

/** Дни периода шаблона: `1d` → 1 календарный день. */
export const PERIOD_DAYS: Record<ReportPeriod, number> = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '180d': 180,
};

export const PERIOD_LABELS: Record<ReportPeriod, string> = {
  '1d': '1 день',
  '7d': '7 дней',
  '30d': '30 дней',
  '180d': '180 дней',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ряды цен по тикерам: группа `candles`, по одной записи на бумагу. */
export const seriesByTicker = (
  entries: { target?: string; text: string }[],
): Map<string, PriceSeries> => {
  const series = new Map<string, PriceSeries>();
  for (const { target, text } of entries) {
    if (!target) {
      continue;
    }
    try {
      const { points, currency } = mapCandles(text);
      if (points.length >= 2) {
        series.set(target, { ticker: target, currency, points });
      }
    } catch {
      // Брокер вернул нечитаемые свечи: бумага останется без динамики.
    }
  }
  return series;
};

export interface PeriodChange {
  period: ReportPeriod;
  label: string;
  from: string;
  to: string;
  change: number;
  changePct: number;
}

/**
 * Изменение цены за период: последняя цена против ближайшей точки не позже
 * начала периода. Если истории короче периода — периода просто нет.
 */
export const periodChanges = (
  series: PriceSeries,
  periods: readonly ReportPeriod[],
  now: Date,
): PeriodChange[] => {
  const last = series.points.at(-1);
  if (!last) {
    return [];
  }

  const changes: PeriodChange[] = [];
  for (const period of periods) {
    const boundary = now.getTime() - PERIOD_DAYS[period] * DAY_MS;
    const reference = series.points.filter((point) => Date.parse(point.date) <= boundary).at(-1);
    if (!reference || reference.close === 0) {
      continue;
    }
    const change = last.close - reference.close;
    changes.push({
      period,
      label: PERIOD_LABELS[period],
      from: reference.date,
      to: last.date,
      change,
      changePct: (change / reference.close) * 100,
    });
  }
  return changes;
};

/** Слово направления движения: рост, падение или без изменений. */
export const trendWord = (change: number): string =>
  change > 0 ? 'рост' : change < 0 ? 'падение' : 'без изменений';

/** Процент со знаком: «+12,30 %». */
export const formatChangePct = (value: number): string =>
  `${value > 0 ? '+' : ''}${formatNumber(value)} %`;
