import { resultsInGroup } from '../../../collection/executor.js';
import { formatNumber } from '../../portfolio-report.js';
import type { FactContext } from '../../engine.js';
import {
  formatChangePct,
  periodChanges,
  seriesByTicker,
  type PeriodChange,
} from '../../market-facts.js';
import { UNKNOWN_SECTOR } from '../../sector.js';
import { seriesRange, sparklineOf } from '../../sparkline.js';
import { bondFactsOf, type BondFacts } from './bond-facts.js';
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
  /** Цена за одну бумагу и её валюта: нужна в разборе бумаги. */
  price?: number;
  currency: string;
  periods: PeriodChange[];
  /** Спарклайн цены за доступную историю: форма движения прямо в тексте. */
  chart?: string;
  /** Минимум и максимум закрытия за историю: подпись к спарклайну. */
  range?: { min: number; max: number };
  forecast?: ForecastFacts;
  /** Сколько дивидендных выплат в истории. */
  dividends?: number;
  /** Ближайшая и последняя выплата: размер, даты отсечки и выплаты. */
  dividend?: DividendFacts;
  /** Облигация: категория, купон, погашение, НКД. */
  bond?: BondFacts;
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

/** Одна дивидендная выплата из ответа `invest_get_share_dividends`. */
export interface DividendPayment {
  amount?: number;
  currency: string;
  /** Дата отсечки реестра: после неё покупка не даёт права на выплату. */
  recordDate?: string;
  /** Последний день покупки с дивидендом. */
  lastBuyDate?: string;
  paymentDate?: string;
  declaredDate?: string;
  /** `Annual`, `Quarter`, … как отдаёт брокер. */
  regularity?: string;
  /** Дивидендная доходность к цене закрытия, %. */
  yieldPct?: number;
}

export interface DividendFacts {
  count: number;
  /** Ближайшая будущая выплата (по дате отсечки или выплаты). */
  next?: DividendPayment;
  /** Последняя прошедшая выплата. */
  last?: DividendPayment;
}

const REGULARITY_LABELS: Record<string, string> = {
  annual: 'раз в год',
  quarter: 'раз в квартал',
  semiannual: 'раз в полгода',
  monthly: 'раз в месяц',
};

const moneyOf = (value: unknown): { amount?: number; currency: string } => {
  const record = value as { value?: string; units?: string; nano?: number; currency?: string } | undefined;
  const currency = (record?.currency ?? 'rub').toUpperCase();
  if (typeof record?.value === 'string' && record.value.trim() !== '') {
    const amount = Number(record.value);
    return { amount: Number.isFinite(amount) ? amount : undefined, currency };
  }
  if (record && (record.units !== undefined || record.nano !== undefined)) {
    const amount = Number(record.units ?? 0) + Number(record.nano ?? 0) / 1_000_000_000;
    return { amount: Number.isFinite(amount) ? amount : undefined, currency };
  }
  return { currency };
};

/**
 * Дивиденды бумаги: сколько выплат в истории, ближайшая и последняя выплата.
 * Даты у брокера — `YYYY-MM-DD`, сравнение строковое.
 */
export const dividendsOf = (text: string, now: Date = new Date()): DividendFacts | undefined => {
  const parsed = asJson(text) as { dividends?: unknown[] } | undefined;
  const list = Array.isArray(parsed?.dividends) ? parsed.dividends : undefined;
  if (!list) {
    return undefined;
  }
  const today = now.toISOString().slice(0, 10);
  const payments: DividendPayment[] = list.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const net = moneyOf(item.dividendNet);
    const yieldValue = Number((item.yieldValue as { value?: string } | undefined)?.value);
    return [
      {
        amount: net.amount,
        currency: net.currency,
        recordDate: typeof item.recordDate === 'string' ? item.recordDate : undefined,
        lastBuyDate: typeof item.lastBuyDate === 'string' ? item.lastBuyDate : undefined,
        paymentDate: typeof item.paymentDate === 'string' ? item.paymentDate : undefined,
        declaredDate: typeof item.declaredDate === 'string' ? item.declaredDate : undefined,
        regularity: typeof item.regularity === 'string' ? item.regularity : undefined,
        yieldPct: Number.isFinite(yieldValue) ? yieldValue : undefined,
      },
    ];
  });
  if (payments.length === 0) {
    return { count: 0 };
  }
  const dateOf = (payment: DividendPayment): string => payment.recordDate ?? payment.paymentDate ?? '';
  const sorted = [...payments].sort((left, right) => dateOf(left).localeCompare(dateOf(right)));
  const next = sorted.find((payment) => dateOf(payment) >= today);
  const passed = sorted.filter((payment) => dateOf(payment) < today);
  return { count: payments.length, next, last: passed.at(-1) ?? sorted.at(-1) };
};

/** Строка дивидендов для карточки бумаги: размер, доходность, даты, регулярность. */
export const dividendLine = (facts: DividendFacts | undefined): string => {
  if (!facts) {
    return '• дивиденды: данных нет';
  }
  if (facts.count === 0) {
    return '• дивиденды: выплат в истории нет';
  }
  const payment = facts.next ?? facts.last;
  if (!payment) {
    return `• дивиденды: выплат в истории ${facts.count}`;
  }
  const parts = [
    payment.amount !== undefined ? `${formatNumber(payment.amount)} ${payment.currency}` : undefined,
    payment.yieldPct !== undefined ? `доходность ${formatNumber(payment.yieldPct)} %` : undefined,
    payment.recordDate ? `отсечка ${payment.recordDate}` : undefined,
    payment.paymentDate ? `выплата ${payment.paymentDate}` : undefined,
    payment.regularity
      ? (REGULARITY_LABELS[payment.regularity.toLowerCase()] ?? payment.regularity)
      : undefined,
  ].filter((part): part is string => part !== undefined);
  const prefix = facts.next ? 'ближайшая выплата' : 'последняя выплата';
  return `• дивиденды: ${prefix} — ${parts.join(', ')}; всего выплат ${facts.count}`;
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
  const dividends = byTicker('dividends', (text) => dividendsOf(text, ctx.now));
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
      price: holding.price?.amount,
      currency: holding.currency,
      periods: priceSeries ? periodChanges(priceSeries, ctx.template.periods, ctx.now) : [],
      chart: sparklineOf(priceSeries, 20),
      range: seriesRange(priceSeries),
      forecast: forecasts.get(holding.ticker),
      dividend: dividends.get(holding.ticker),
      dividends: dividends.get(holding.ticker)?.count,
      bond: bondFactsOf(ctx, holding.ticker, holding.classCode),
      news: headlines?.items ?? [],
      newsNote: headlines?.note,
    };
  });
};

/** Строка динамики: «1 день -1,06 %, 7 дней +0,82 %, 180 дней +12,34 %». */
export const periodsLine = (periods: PeriodChange[]): string =>
  periods.map((change) => `${change.label} ${formatChangePct(change.changePct)}`).join(', ');
