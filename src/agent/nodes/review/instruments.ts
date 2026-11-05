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

