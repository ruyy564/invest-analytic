import type { GraderResult } from './graders.js';

/** Один прогон кейса: вердикт и объяснения грейдеров. */
export interface CaseRun {
  passed: boolean;
  graders: GraderResult[];
  durationMs?: number;
  costUsd?: number;
}

/** Все прогоны одного кейса (trials). */
export interface CaseResult {
  id: string;
  tags: string[];
  runs: CaseRun[];
}

export interface TagMetrics {
  cases: number;
  passAtK: number;
  passPowerK: number;
}

export interface EvalSummary {
  cases: number;
  trials: number;
  passedCases: number;
  /** Доля кейсов, где успешен хотя бы один прогон. */
  passAtK: number;
  /** Доля кейсов, где успешны все прогоны: мера стабильности. */
  passPowerK: number;
  failed: { id: string; detail: string }[];
  byTag: Record<string, TagMetrics>;
}

const share = (part: number, total: number): number => (total === 0 ? 0 : part / total);

/** Первый проваленный грейдер — для читаемого отчёта. */
const failureDetail = (runs: CaseRun[]): string => {
  for (const run of runs) {
    const failed = run.graders.find((grader) => !grader.passed);
    if (failed) {
      return `${failed.grader}${failed.detail ? `: ${failed.detail}` : ''}`;
    }
  }
  return 'нет прогонов';
};

/** Агрегация по кейсам и тегам: `pass@k` и `pass^k` различают удачу и стабильность. */
export const summarizeEval = (results: readonly CaseResult[]): EvalSummary => {
  const passAtK = results.filter((result) => result.runs.some((run) => run.passed)).length;
  const passPowerK = results.filter(
    (result) => result.runs.length > 0 && result.runs.every((run) => run.passed),
  ).length;

  const byTag: Record<string, TagMetrics> = {};
  for (const result of results) {
    for (const tag of result.tags) {
      const current = byTag[tag] ?? { cases: 0, passAtK: 0, passPowerK: 0 };
      byTag[tag] = {
        cases: current.cases + 1,
        passAtK: current.passAtK + (result.runs.some((run) => run.passed) ? 1 : 0),
        passPowerK:
          current.passPowerK + (result.runs.every((run) => run.passed) && result.runs.length > 0 ? 1 : 0),
      };
    }
  }
  for (const [tag, metrics] of Object.entries(byTag)) {
    byTag[tag] = {
      cases: metrics.cases,
      passAtK: share(metrics.passAtK, metrics.cases),
      passPowerK: share(metrics.passPowerK, metrics.cases),
    };
  }

  return {
    cases: results.length,
    trials: results.reduce((sum, result) => sum + result.runs.length, 0),
    passedCases: passAtK,
    passAtK: share(passAtK, results.length),
    passPowerK: share(passPowerK, results.length),
    failed: results
      .filter((result) => !result.runs.every((run) => run.passed))
      .map((result) => ({ id: result.id, detail: failureDetail(result.runs) })),
    byTag: Object.fromEntries(Object.entries(byTag).sort(([left], [right]) => left.localeCompare(right))),
  };
};

/** Отчёт одной строкой: удобно для CI-лога. */
export const formatEvalReport = (summary: EvalSummary): string => {
  const lines = [
    `Кейсов: ${summary.cases}, прогонов: ${summary.trials}`,
    `pass@k: ${(summary.passAtK * 100).toFixed(1)}%, pass^k: ${(summary.passPowerK * 100).toFixed(1)}%`,
  ];
  for (const [tag, metrics] of Object.entries(summary.byTag)) {
    lines.push(`  ${tag}: ${metrics.cases} кейсов, pass@k ${(metrics.passAtK * 100).toFixed(1)}%`);
  }
  for (const failure of summary.failed) {
    lines.push(`  ✕ ${failure.id}: ${failure.detail}`);
  }
  return lines.join('\n');
};
