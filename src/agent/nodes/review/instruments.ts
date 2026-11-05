import { resultsInGroup, type CollectionResult } from '../../../collection/executor.js';
import type { CollectionPlan } from '../../../collection/plan.js';
import { mapPositions } from '../../../parsing/mappers/positions.mapper.js';

export const instrumentsOf = (
  plan: CollectionPlan,
  collected: CollectionResult,
): { ticker: string; classCode?: string; uid?: string; name?: string }[] => {
  const found = new Map<string, { ticker: string; classCode?: string; uid?: string; name?: string }>();
  for (const { text } of resultsInGroup(plan, collected, 'portfolio')) {
    try {
      for (const position of mapPositions(text, 'rub')) {
        found.set(position.instrument.ticker, {
          ticker: position.instrument.ticker,
          classCode: position.instrument.classCode,
          uid: position.instrument.uid,
          name: position.instrument.name,
        });
      }
    } catch {
      // Счёт без позиций или нечитаемый ответ: остальные всё равно разберём.
    }
  }
  return [...found.values()];
};

/**
 * Приоритет режимов торгов: сначала основной режим акций, затем фонды, затем
 * облигационные режимы. В выдаче поиска одна бумага часто есть в нескольких.
 */
const LIQUID_CLASSES = [
  'TQBR',
  'TQTF',
  'TQIF',
  'TQTE',
  'TQOB',
  'TQCB',
  'TQIR',
  'TQMO',
  'TQTC',
  'TQBD',
  'TQOD',
  'PSAU',
  'PTOB',
  'TQTD',
];

/**
 * Бумага из ответа `invest_find_instrument`: поиск по тикеру нужен разбору бумаги,
 * который не читает портфель и поэтому не знает класс инструмента (TQBR/TQOB).
 */
export const instrumentFromSearch = (
  plan: CollectionPlan,
  collected: CollectionResult,
  ticker: string,
): { ticker: string; classCode?: string; name?: string } | undefined => {
  const wanted = ticker.trim().toUpperCase();
  for (const { entry, text } of resultsInGroup(plan, collected, 'reference')) {
    if (entry.tool !== 'invest_find_instrument') {
      continue;
    }
    let parsed: { instruments?: { ticker?: string; classCode?: string; name?: string }[] };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      continue;
    }
    const list = Array.isArray(parsed?.instruments) ? parsed.instruments : [];
    if (list.length === 0) {
      continue;
    }
    const matched = list.filter(
      (item) => String(item.ticker ?? '').toUpperCase() === wanted,
    );
    const candidates = matched.length > 0 ? matched : list;
    // Класс выбираем по приоритету режимов, а не по порядку в ответе поиска.
    const best =
      LIQUID_CLASSES.map((code) =>
        candidates.find((item) => String(item.classCode ?? '') === code),
      ).find((item) => item !== undefined) ?? candidates[0];
    return {
      ticker: String(best.ticker ?? wanted),
      classCode: best.classCode,
      name: best.name,
    };
  }
  return undefined;
};

/** Открытые счета с названиями: нужны для разбора конкретного счёта. */



export const matchAccount = <T extends { accountId: string; title?: string }>(
  accounts: readonly T[],
  target: string,
): T | undefined => {
  const wanted = target.trim().toLowerCase();
  if (wanted.length === 0) {
    return undefined;
  }
  return (
    accounts.find((account) => account.accountId === target) ??
    accounts.find((account) => account.accountId.includes(wanted)) ??
    accounts.find((account) => (account.title ?? '').toLowerCase().includes(wanted))
  );
};

