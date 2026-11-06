import { resultsInGroup } from '../collection/executor.js';
import type { FactContext, FactProvider, SectionFacts } from '../engine.js';
import { renderKpi } from '../renderers.js';

/**
 * Рыночные и налоговые факты: мнение аналитиков, ставка ЦБ, налоговый контекст.
 * Динамика цен и новости по бумагам живут в провайдере `securities.*`.
 */

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

export const RECOMMENDATIONS: Record<string, string> = {
  BUY: 'покупать',
  SELL: 'продавать',
  HOLD: 'держать',
};

/** Ставка ЦБ и ориентиры рынка — основа раздела про экономический цикл. */
export const macroProvider: FactProvider = {
  id: 'macro.context',
  section(ctx: FactContext): SectionFacts | undefined {
    const rates = resultsInGroup(ctx.plan, ctx.collected, 'macro');
    const indices = resultsInGroup(ctx.plan, ctx.collected, 'indices');

    if (rates.length === 0 && indices.length === 0) {
      return { missing: 'ставка ЦБ и индексы не собраны' };
    }

    const rateText = rates.map((row) => row.text).join(' ');
    const rateLines = rateText.split('\n').filter((line) => line.trim().length > 0);
    const current = /Ключевая ставка ЦБ:\s*([\d,.\s]+)\s*%/.exec(rateText)?.[1];
    const since = /Действует с ([\d-]+)/.exec(rateText)?.[1];
    const decisions = rateLines.filter((line) => line.startsWith('•')).slice(0, 4);

    const blocks: string[] = [
      rates.length > 0
        ? `Ключевая ставка ЦБ: ${current?.trim() ?? 'данных нет'} %${since ? ` (действует с ${since})` : ''}`
        : 'Ключевая ставка ЦБ: данных нет.',
    ];
    if (decisions.length > 0) {
      blocks.push(`Последние решения: ${decisions.join('; ')}`);
    }
    blocks.push(
      indices.length > 0
        ? `Индексы и ориентиры: получено ${indices.length} набор(ов) данных.`
        : 'Индексы: данных нет.',
    );

    return {
      markdown: renderKpi(
        blocks.map((block) => {
          const [label, ...rest] = block.split(':');
          return { label: label.trim(), value: rest.join(':').trim() };
        }),
      ),
      structured: { current, since, decisions, indices: indices.length },
      brief: [
        current ? `ставка ЦБ ${current.trim()} %${since ? ` с ${since}` : ''}` : 'ставка ЦБ недоступна',
        decisions.length > 0 ? `решения: ${decisions.join('; ')}` : 'истории решений нет',
        indices.length > 0 ? `индексы: ${indices.length} набор(ов)` : 'индексы недоступны',
      ].join('; '),
    };
  },
};

/** Налоговый контекст: удержанные налоги и изменения законодательства. */
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
