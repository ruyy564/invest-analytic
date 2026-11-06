import type { CanonicalItem } from '../domain/canonical-item.js';
import { summarizeStage, type StageReport } from './stage-report.js';

/** Ключ дубликата: ссылка, иначе нормализованный заголовок. */
export const duplicateKey = (item: CanonicalItem): string =>
  (item.url ?? item.title).toLowerCase().replace(/\s+/g, ' ').trim();

/** Устранение дублей: остаётся первый элемент, остальные считаются отброшенными. */
export const dedupeItems = (
  items: readonly CanonicalItem[],
): { items: CanonicalItem[]; report: StageReport } => {
  const seen = new Set<string>();
  const decisions = items.map((item) => {
    const key = duplicateKey(item);
    if (seen.has(key)) {
      return { keep: false, reason: 'duplicate' };
    }
    seen.add(key);
    return { keep: true, reason: 'unique' };
  });

  return {
    items: items.filter((_item, index) => decisions[index].keep),
    report: summarizeStage('dedupe', decisions),
  };
};
