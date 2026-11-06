import type { CollectionPlan, PlanEntry } from '../../collection/plan.js';
import { planKey } from '../../collection/plan.js';
import type { PlannedStep } from './planner.js';

/**
 * Объединение базового плана и шагов планировщика: обязательные источники
 * сценария сохраняются, модель добавляет только недостающее. Дубликаты
 * отбрасываются по ключу запроса.
 */
export const mergePlan = (
  base: CollectionPlan,
  steps: readonly PlannedStep[],
): CollectionPlan => {
  const seen = new Set(base.entries.map(planKey));
  const extra: PlanEntry[] = [];

  for (const step of steps) {
    const entry: PlanEntry = {
      tool: step.tool,
      args: step.args,
      group: step.group,
      priority: 'optional',
    };
    const key = planKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    extra.push(entry);
  }

  return { entries: [...base.entries, ...extra], maxInstruments: base.maxInstruments };
};
