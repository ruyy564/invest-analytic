import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalCase } from './case-schema.js';
import { gradeCase } from './graders.js';
import type { CaseResult } from './summarize.js';

/** Записанный прогон кейса: текст ответа и вызванные инструменты. */
export interface RecordedRun {
  transcript: string;
  toolsUsed?: string[];
}

/**
 * Офлайн-прогон: берёт записанный ответ из кейса (`transcript`) или из файла
 * `<id>.txt` в каталоге транскриптов. Сеть не используется.
 */
export const recordedRunOf = (
  testCase: EvalCase,
  transcriptsDir: string,
): RecordedRun | undefined => {
  if (testCase.transcript) {
    return { transcript: testCase.transcript };
  }
  const path = join(transcriptsDir, `${testCase.id}.txt`);
  if (!existsSync(path)) {
    return undefined;
  }
  return { transcript: readFileSync(path, 'utf8') };
};

/**
 * Оценка кейса по записанным прогонам: несколько trials нужны, чтобы различить
 * удачный прогон (`pass@k`) и стабильность (`pass^k`).
 */
export const runCase = (testCase: EvalCase, runs: readonly RecordedRun[]): CaseResult => ({
  id: testCase.id,
  tags: testCase.tags,
  runs: runs.map((run) => {
    const graders = gradeCase(testCase, run);
    return { passed: graders.every((grader) => grader.passed), graders };
  }),
});

/** Все кейсы, для которых есть записанный прогон. */
export const collectCaseResults = (
  cases: readonly EvalCase[],
  transcriptsDir: string,
): { results: CaseResult[]; skipped: string[] } => {
  const results: CaseResult[] = [];
  const skipped: string[] = [];

  for (const testCase of cases) {
    const recorded = recordedRunOf(testCase, transcriptsDir);
    if (!recorded) {
      skipped.push(testCase.id);
      continue;
    }
    const trials = Math.max(1, testCase.trials);
    results.push(runCase(testCase, Array.from({ length: trials }, () => recorded)));
  }

  return { results, skipped };
};
