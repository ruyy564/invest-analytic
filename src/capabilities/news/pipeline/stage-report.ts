/** Отчёт стадии: сколько пришло, сколько осталось и почему отброшено. */
export interface StageReport {
  stage: string;
  in: number;
  out: number;
  dropped: { reason: string; count: number }[];
}

/** Сводит решения по элементам в отчёт: причины важнее общего числа. */
export const summarizeStage = (
  stage: string,
  decisions: readonly { keep: boolean; reason: string }[],
): StageReport => {
  const counts = new Map<string, number>();
  let kept = 0;
  for (const decision of decisions) {
    if (decision.keep) {
      kept += 1;
      continue;
    }
    counts.set(decision.reason, (counts.get(decision.reason) ?? 0) + 1);
  }

  return {
    stage,
    in: decisions.length,
    out: kept,
    dropped: [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count),
  };
};
