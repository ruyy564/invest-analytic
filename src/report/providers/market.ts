import { formatNumber } from '../../agent/report/portfolio-report.js';
import { resultsInGroup } from '../../collection/executor.js';
import type { FactContext, FactProvider, SectionFacts } from '../engine.js';
import { renderKpi, renderList, renderTable } from '../renderers.js';

const asJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const money = (value: unknown): number | undefined => {
  const record = asRecord(value);
  const raw = record.value;
  const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
  return Number.isFinite(parsed) ? parsed : undefined;
};

export interface ForecastFacts {
  ticker?: string;
  recommendation?: string;
  consensus?: number;
  min?: number;
  max?: number;
  current?: number;
  upside?: number;
}

/** Консенсус аналитиков из ответа `invest_get_forecast`. */
export const parseForecast = (text: string): ForecastFacts | undefined => {
  const root = asRecord(asJson(text));
  const consensus = asRecord(root.consensus ?? root);
  if (Object.keys(consensus).length === 0) {
    return undefined;
  }
  const recommendation =
    typeof consensus.recommendation === 'string' ? consensus.recommendation : undefined;
  const facts: ForecastFacts = {
    ticker: typeof consensus.ticker === 'string' ? consensus.ticker : undefined,
    recommendation: recommendation?.replace('RECOMMENDATION_', ''),
    consensus: money(consensus.consensus),
    min: money(consensus.minTarget),
    max: money(consensus.maxTarget),
    current: money(consensus.currentPrice),
    upside: money(consensus.priceChangeRel),
  };
  return Object.values(facts).some((value) => value !== undefined) ? facts : undefined;
};

const RECOMMENDATIONS: Record<string, string> = {
  BUY: 'покупать',
  SELL: 'продавать',
  HOLD: 'держать',
};

export const dynamicsProvider: FactProvider = {
  id: 'market.dynamics',
  section(ctx: FactContext): SectionFacts | undefined {
    const rows = resultsInGroup(ctx.plan, ctx.collected, 'candles');
    if (rows.length === 0) {
      return { missing: 'свечи за период не собраны' };
    }

    // Каждый результат — готовый текст динамики от `market__price_dynamics`.
    return {
      markdown: rows.map(({ text }) => text).join('\n\n'),
      structured: rows.map(({ entry, text }) => ({ ticker: entry.target, text })),
      brief: rows
        .map(({ entry, text }) => `${entry.target}: ${text.split('\n')[2] ?? ''}`.trim())
        .join('; '),
    };
  },
};

export const analyticsProvider: FactProvider = {
  id: 'market.analytics',
  section(ctx: FactContext): SectionFacts | undefined {
    const forecasts = resultsInGroup(ctx.plan, ctx.collected, 'analytics')
      .map(({ entry, text }) => ({ ticker: entry.target ?? '', facts: parseForecast(text) }))
      .filter((row): row is { ticker: string; facts: ForecastFacts } => row.facts !== undefined);

    const dividends = resultsInGroup(ctx.plan, ctx.collected, 'dividends');
    const signals = resultsInGroup(ctx.plan, ctx.collected, 'signals');

    if (forecasts.length === 0 && dividends.length === 0 && signals.length === 0) {
      return { missing: 'прогнозы, дивиденды и сигналы не собраны' };
    }

    const lines: string[] = [];
    if (forecasts.length > 0) {
      lines.push(
        'Консенсус аналитиков:',
        renderTable(
          ['Тикер', 'Рекомендация', 'Средняя цель', 'Мин/Макс', 'Потенциал'],
          forecasts.map(({ ticker, facts }) => [
            ticker || facts.ticker || '—',
            facts.recommendation
              ? (RECOMMENDATIONS[facts.recommendation] ?? facts.recommendation)
              : '—',
            facts.consensus ? formatNumber(facts.consensus) : '—',
            facts.min && facts.max ? `${formatNumber(facts.min)} / ${formatNumber(facts.max)}` : '—',
            facts.upside !== undefined
              ? `${facts.upside > 0 ? '+' : ''}${formatNumber(facts.upside)} %`
              : '—',
          ]),
        ),
      );
    } else {
      lines.push('Консенсус аналитиков: данных нет.');
    }

    lines.push(
      dividends.length > 0
        ? `Дивиденды и события: получены по ${dividends.length} бумагам.`
        : 'Дивиденды: данных нет.',
    );
    lines.push(signals.length > 0 ? 'Сигналы и мнения сообщества собраны.' : 'Сигналы: данных нет.');

    return {
      markdown: lines.join('\n'),
      structured: { forecasts, dividends: dividends.length, signals: signals.length },
      brief: forecasts
        .slice(0, 8)
        .map(
          ({ ticker, facts }) =>
            `${ticker}: ${RECOMMENDATIONS[facts.recommendation ?? ''] ?? facts.recommendation ?? 'нет рекомендации'}` +
            (facts.upside !== undefined ? `, потенциал ${formatNumber(facts.upside)} %` : ''),
        )
        .join('; '),
    };
  },
};


export const newsProvider: FactProvider = {
  id: 'news.digest',
  section(ctx: FactContext): SectionFacts | undefined {
    const rows = resultsInGroup(ctx.plan, ctx.collected, 'news');
    if (rows.length === 0) {
      return { missing: 'новости не собраны' };
    }
    const text = rows.map((row) => row.text).join('\n\n');
    const brief = text
      .split('\n')
      .filter((line) => line.startsWith('•'))
      .slice(0, 8)
      .join('; ');
    return { markdown: text, structured: { text }, brief };
  },
};

export const taxProvider: FactProvider = {
  id: 'tax.context',
  section(ctx: FactContext): SectionFacts | undefined {
    const rows = resultsInGroup(ctx.plan, ctx.collected, 'tax');
    if (rows.length === 0) {
      return { missing: 'налоговые данные не собраны' };
    }
    const text = rows.map((row) => row.text).join('\n\n');
    return { markdown: text, structured: { text }, brief: text.slice(0, 600) };
  },
};

export const macroProvider: FactProvider = {
  id: 'macro.context',
  section(ctx: FactContext): SectionFacts | undefined {
    const rates = resultsInGroup(ctx.plan, ctx.collected, 'macro');
    const indices = resultsInGroup(ctx.plan, ctx.collected, 'indices');

    if (rates.length === 0 && indices.length === 0) {
      return { missing: 'ставка ЦБ и индексы не собраны' };
    }

    const blocks: string[] = [];
    blocks.push(
      rates.length > 0
        ? renderKpi([{ label: 'Ставка ЦБ', value: rates.map((row) => row.text).join(' ') }])
        : 'Ставка ЦБ: данных нет.',
    );
    blocks.push(
      indices.length > 0
        ? `Индексы и ориентиры: получено ${indices.length} набор(ов) данных.`
        : 'Индексы: данных нет.',
    );

    return {
      markdown: blocks.join('\n'),
      structured: { rates: rates.length, indices: indices.length },
      brief: [
        rates.length > 0
          ? rates[0].text.split('\n').slice(0, 2).join(' — ')
          : 'ставка ЦБ недоступна',
        indices.length > 0 ? 'индексы собраны' : 'индексы недоступны',
      ].join('; '),
    };
  },
};

export const briefProvider: FactProvider = {
  id: 'facts.brief',
  section(ctx: FactContext): SectionFacts | undefined {
    const parts: string[] = [];
    for (const group of ['macro', 'news', 'analytics'] as const) {
      const rows = resultsInGroup(ctx.plan, ctx.collected, group);
      if (rows.length > 0) {
        parts.push(`${group}: ${rows[0].text.slice(0, 300)}`);
      }
    }
    if (parts.length === 0) {
      return { missing: 'недостаточно данных для итогового вывода' };
    }
    return {
      markdown: renderList(parts),
      structured: { parts },
      brief: parts.join(' | ').slice(0, 1_500),
    };
  },
};
