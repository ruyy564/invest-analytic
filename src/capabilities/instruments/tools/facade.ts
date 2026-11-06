import type { DynamicStructuredTool } from '@langchain/core/tools';
import { withTimeout } from '../../../transports/mcp/mcp-tool.adapter.js';
import { asJson } from '../../../shared/json.js';

/** Инструмент MCP по короткому имени: фасады не знают про реестр. */
export type ToolLookup = (name: string) => DynamicStructuredTool | undefined;

/** Вызов MCP-инструмента с таймаутом и понятной ошибкой. */
export const invokeTool = async (
  lookup: ToolLookup,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> => {
  const tool = lookup(name);
  if (!tool) {
    throw new Error(`инструмент ${name} недоступен`);
  }
  return withTimeout(
    tool.invoke(args as never),
    timeoutMs,
    () => new Error(`инструмент ${name} не ответил за ${timeoutMs} мс`),
  );
};

/** Рекурсивно находит первое значение по имени поля (регистр не важен). */
export const pickField = (value: unknown, field: string, depth = 0): unknown => {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return undefined;
  }
  const wanted = field.toLowerCase();
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);

  for (const [key, item] of entries) {
    if (key.toLowerCase() === wanted && (typeof item !== 'object' || item === null)) {
      return item;
    }
  }
  for (const [, item] of entries) {
    const found = pickField(item, field, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

/** Компактная строка «поле: значение» — модель не получает сырой JSON целиком. */
export const summarizeFields = (
  raw: unknown,
  fields: readonly string[],
  limit = 400,
): string => {
  const lines: string[] = [];
  for (const field of fields) {
    const value = pickField(raw, field);
    if (value === undefined || value === null || value === '') {
      continue;
    }
    lines.push(`${field}: ${String(value)}`);
  }
  const text = lines.join('\n');
  return text.length > limit ? `${text.slice(0, limit)}…` : text || 'данных нет';
};

/**
 * Порядок выбора при совпадении тикера: акция важнее фьючерса с тем же тикером,
 * а основной режим торгов MOEX — важнее внебиржевых (`SBER_37M`, `SBER_SMAL`).
 */
const KIND_RANK: Record<string, number> = {
  INSTRUMENT_TYPE_SHARE: 0,
  INSTRUMENT_TYPE_ETF: 1,
  INSTRUMENT_TYPE_BOND: 2,
  other: 3,
};

/** Режимы торгов, где обращаются те же акции, что видит пользователь на бирже. */
const PREFERRED_CLASSES = new Set(['TQBR', 'TQTF', 'TQCB', 'TQOB', 'TQIF', 'TQTD', 'TQPI']);

const rankOf = (record: Record<string, unknown>): number => {
  const kind = KIND_RANK[String(record.instrumentKind)] ?? KIND_RANK.other;
  const classRank = PREFERRED_CLASSES.has(String(record.classCode)) ? 0 : 1;
  return kind * 10 + classRank;
};

/**
 * Идентификатор инструмента для MCP: `TICKER_CLASSCODE`. По одному тикеру брокер
 * отвечает «Instrument not found» (SBER есть в разных режимах торгов), поэтому
 * класс уточняется через `invest_find_instrument`.
 *
 * Один тикер носят разные инструменты (акция `SBER_TQBR`, фьючерс `SBER_37M`),
 * поэтому кандидаты сортируются по виду: акция, фонд, облигация, остальное.
 */
export const resolveInstrumentId = async (
  lookup: ToolLookup,
  ticker: string,
  timeoutMs: number,
): Promise<{ instrumentId: string; title?: string }> => {
  const normalized = ticker.trim().toUpperCase();
  if (normalized.length === 0) {
    throw new Error('не указан тикер');
  }
  if (normalized.includes('_')) {
    return { instrumentId: normalized };
  }

  const raw = await invokeTool(
    lookup,
    'invest_find_instrument',
    // Без `STATIC_DATA` в ответе нет вида инструмента и его не выбрать правильно.
    { query: normalized, responseView: ['BASE', 'IDENTIFIERS', 'STATIC_DATA'] },
    timeoutMs,
  );
  const root = asJson(raw) as { instruments?: unknown[] } | undefined;
  const list = Array.isArray(root?.instruments) ? root.instruments : [];

  const candidates = list
    .map((item) => item as Record<string, unknown>)
    .filter(
      (record) =>
        typeof record.ticker === 'string' &&
        record.ticker.toUpperCase() === normalized &&
        typeof record.classCode === 'string' &&
        record.classCode.length > 0,
    )
    .map((record) => ({
      instrumentId: `${normalized}_${String(record.classCode)}`,
      title: typeof record.name === 'string' ? record.name : undefined,
      rank: rankOf(record),
    }))
    .sort((left, right) => left.rank - right.rank);

  const best = candidates[0];
  if (best) {
    return { instrumentId: best.instrumentId, ...(best.title ? { title: best.title } : {}) };
  }
  throw new Error(`бумага ${normalized} не найдена`);
};
