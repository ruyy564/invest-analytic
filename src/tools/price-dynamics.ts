import type { DynamicStructuredTool } from '@langchain/core/tools';
import { formatNumber } from '../agent/report/portfolio-report.js';
import { asJson } from './portfolio-snapshot.js';
import { withTimeout } from './mcp-tool.adapter.js';

/** Локальный инструмент: динамика цены бумаги за период по дневным свечам. */
export const PRICE_DYNAMICS_TOOL = 'price_dynamics';

type Raw = Record<string, unknown>;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asRecord = (value: unknown): Raw | undefined =>
  typeof value === 'object' && value !== null ? (value as Raw) : undefined;

export interface PricePoint {
  date: string;
  close: number;
}

export interface PriceDynamics {
  ticker: string;
  classCode?: string;
  name?: string;
  currency: string;
  days: number;
  points: number;
  first?: PricePoint;
  last?: PricePoint;
  min?: PricePoint;
  max?: PricePoint;
}

/** Свечи из `invest_get_candles` → точки «дата / цена закрытия». */
export const mapCandles = (raw: unknown): { points: PricePoint[]; currency: string } => {
  const root = asRecord(asJson(raw));
  const list = Array.isArray(root?.candles) ? root.candles : [];
  const points: PricePoint[] = [];

  for (const item of list) {
    const candle = asRecord(item);
    const date = asString(candle?.time);
    const close = asRecord(candle?.close);
    const value = asString(close?.value);
    if (!date || !value) {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      points.push({ date, close: parsed });
    }
  }

  points.sort((left, right) => left.date.localeCompare(right.date));
  return { points, currency: (asString(root?.priceCurrency) ?? 'rub').toUpperCase() };
};

/** Сводка по ряду цен: первая/последняя точка, минимум и максимум. */
export const summarize = (
  points: PricePoint[],
  meta: { ticker: string; classCode?: string; name?: string; currency: string; days: number },
): PriceDynamics => {
  const min = points.reduce<PricePoint | undefined>(
    (best, point) => (!best || point.close < best.close ? point : best),
    undefined,
  );
  const max = points.reduce<PricePoint | undefined>(
    (best, point) => (!best || point.close > best.close ? point : best),
    undefined,
  );

  return { ...meta, points: points.length, first: points[0], last: points.at(-1), min, max };
};

/** Текст ответа: цифры считает код, модель их не придумывает. */
export const formatDynamics = (dynamics: PriceDynamics): string => {
  const { ticker, name, currency, days, points, first, last, min, max } = dynamics;
  if (!first || !last) {
    return `Нет данных о ценах ${ticker} за ${days} дней: брокер не вернул свечи.`;
  }

  const change = last.close - first.close;
  const changePct = first.close === 0 ? 0 : (change / first.close) * 100;
  const sign = change > 0 ? '+' : '';
  const arrow = change > 0 ? 'рост' : change < 0 ? 'падение' : 'без изменений';

  return [
    `Динамика ${ticker}${name ? ` (${name})` : ''} за ${days} дней:`,
    `• начало периода: ${first.date} — ${formatNumber(first.close)} ${currency}`,
    `• конец периода: ${last.date} — ${formatNumber(last.close)} ${currency}`,
    `• изменение: ${sign}${formatNumber(change)} ${currency} (${sign}${formatNumber(changePct)}%), ${arrow}`,
    `• минимум: ${min?.date} — ${formatNumber(min?.close ?? 0)} ${currency}`,
    `• максимум: ${max?.date} — ${formatNumber(max?.close ?? 0)} ${currency}`,
    `• торговых дней в расчёте: ${points}`,
    'Причин движения цены в данных брокера нет: инструмент отдаёт только цены и объёмы.',
  ].join('\n');
};

export interface DynamicsDeps {
  tool: (name: string) => DynamicStructuredTool | undefined;
  timeoutMs: number;
}

const toolByName = (tool: DynamicsDeps['tool'], name: string): DynamicStructuredTool | undefined =>
  tool(name) ?? tool(`tinkoff__${name}`);

/**
 * «Почему упал Полюс за полгода»: находит бумагу, тянет дневные свечи за период
 * и считает изменение. Модель получает готовые цифры и не додумывает их.
 */
export const collectDynamics = async (
  deps: DynamicsDeps,
  query: string,
  days: number,
): Promise<string> => {
  const findTool = toolByName(deps.tool, 'invest_find_instrument');
  const candlesTool = toolByName(deps.tool, 'invest_get_candles');
  if (!candlesTool) {
    return 'Инструмент истории цен недоступен: проверьте allowlist MCP_TINKOFF_ALLOWED_TOOLS.';
  }

  const candidates: { ticker: string; classCode?: string; name?: string }[] = [];
  if (findTool) {
    try {
      candidates.push(
        ...pickInstruments(
          await withTimeout(findTool.invoke({ query } as never), deps.timeoutMs, () => new Error('таймаут')),
          query,
        ),
      );
    } catch {
      // Карточка не нашлась — пробуем по самому запросу (например, готовый тикер).
    }
  }
  candidates.push({ ticker: query.trim().toUpperCase() });

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  // По одному классу свечей может быть почти нет (фьючерс, внебиржевой режим):
  // перебираем кандидатов, пока не наберём достаточно точек. Больше двух не пробуем —
  // каждый перебор стоит вызова из бюджета прогона.
  let best: { instrument: (typeof candidates)[number]; points: PricePoint[]; currency: string } | undefined;
  let lastError: string | undefined;

  for (const instrument of candidates.slice(0, 2)) {
    const instrumentId = instrument.classCode
      ? `${instrument.ticker}_${instrument.classCode}`
      : instrument.ticker;
    try {
      const raw = await withTimeout(
        candlesTool.invoke({
          instrumentId,
          interval: 'CANDLE_INTERVAL_DAY',
          from: from.toISOString(),
          to: to.toISOString(),
        } as never),
        deps.timeoutMs,
        () => new Error('таймаут'),
      );
      const { points, currency } = mapCandles(raw);
      if (!best || points.length > best.points.length) {
        best = { instrument, points, currency };
      }
      if (points.length >= 5) {
        break;
      }
    } catch (error) {
      lastError = (error as Error)?.message;
    }
  }

  if (!best) {
    return `Не удалось получить свечи ${query}: ${lastError ?? 'брокер не вернул данные'}`;
  }

  return formatDynamics(
    summarize(best.points, {
      ticker: best.instrument.ticker,
      classCode: best.instrument.classCode,
      name: best.instrument.name,
      currency: best.currency,
      days,
    }),
  );
};

/** Биржевые классы в порядке предпочтения: акции → фонды → облигации. */
const CLASS_PRIORITY = [/^TQBR$/, /^TQTF$/, /^TQIF$/, /^TQCB$/, /^TQOB$/, /^TQ/];

/** Насколько класс годится для истории цен: меньше — лучше, `undefined` — не биржевой. */
const classRank = (classCode?: string): number | undefined => {
  if (!classCode) {
    return undefined;
  }
  const index = CLASS_PRIORITY.findIndex((pattern) => pattern.test(classCode));
  return index === -1 ? undefined : index;
};

/**
 * Кандидаты из `invest_find_instrument` в порядке приоритета: сначала биржевые
 * классы (акция PLZL_TQBR), затем остальные. По запросу «Полюс» первым приходит
 * фьючерс PZZ1, и свечей по нему почти нет — поэтому класс важнее названия.
 */
export const pickInstruments = (
  raw: unknown,
  query: string,
): { ticker: string; classCode?: string; name?: string }[] => {
  const root = asRecord(asJson(raw));
  const list = Array.isArray(root?.instruments) ? root.instruments : [];
  const found = list
    .map((item) => asRecord(item))
    .filter((item): item is Raw => item !== undefined)
    .map((item) => ({
      ticker: asString(item.ticker) ?? '',
      classCode: asString(item.classCode),
      name: asString(item.name),
    }))
    .filter((item) => item.ticker.length > 0);

  const wanted = query.trim().toUpperCase();
  const score = (item: { ticker: string; classCode?: string; name?: string }): number => {
    const rank = classRank(item.classCode) ?? 9;
    const tickerMatch = item.ticker.toUpperCase() === wanted ? 0 : 1;
    const nameMatch = (item.name ?? '').toUpperCase().includes(wanted) ? 0 : 1;
    return rank * 10 + tickerMatch * 2 + nameMatch;
  };

  return found.sort((left, right) => score(left) - score(right));
};

/** Самый подходящий кандидат (удобно для проверок и простых случаев). */
export const pickInstrument = (
  raw: unknown,
  query: string,
): { ticker: string; classCode?: string; name?: string } | undefined =>
  pickInstruments(raw, query)[0];
