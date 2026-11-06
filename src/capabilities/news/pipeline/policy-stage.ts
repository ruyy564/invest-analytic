import type { CanonicalItem } from '../domain/canonical-item.js';
import { evaluateItem, type NewsPolicy, type PolicyContext } from '../domain/news-policy.js';
import { summarizeStage, type StageReport } from './stage-report.js';

/** Стадия политики: единое решение по каждому элементу и отчёт причин. */
export const applyPolicy = (
  items: readonly CanonicalItem[],
  ctx: PolicyContext,
  policy: NewsPolicy,
): { items: CanonicalItem[]; report: StageReport } => {
  const decisions = items.map((item) => evaluateItem(item, ctx, policy));
  return {
    items: items.filter((_item, index) => decisions[index].keep),
    report: summarizeStage('policy', decisions),
  };
};
