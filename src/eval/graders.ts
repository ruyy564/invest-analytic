import type { EvalCase } from './case-schema.js';

/** Результат одного грейдера: имя, вердикт и объяснение. */
export interface GraderResult {
  grader: string;
  passed: boolean;
  detail?: string;
}

/** Отказ модели, который не должен попадать в ответ пользователю. */
const REFUSAL =
  /не обладает собственным мнением|как и любая языковая модель|разговоры на некоторые темы временно ограничены|не могу (дать|предоставить|комментировать)/i;

/** Проверка фрагментов ответа: наличие обязательных и отсутствие запрещённых. */
export const gradeAnswer = (testCase: EvalCase, transcript: string): GraderResult[] => {
  const results: GraderResult[] = [];
  const answer = testCase.answer;

  for (const fragment of answer?.mustContain ?? []) {
    results.push({
      grader: `contains:${fragment}`,
      passed: transcript.includes(fragment),
      detail: transcript.includes(fragment) ? undefined : `нет фрагмента «${fragment}»`,
    });
  }

  for (const fragment of answer?.mustNotContain ?? []) {
    results.push({
      grader: `notContains:${fragment}`,
      passed: !transcript.includes(fragment),
      detail: transcript.includes(fragment) ? `лишний фрагмент «${fragment}»` : undefined,
    });
  }

  results.push({
    grader: 'no-refusal',
    passed: !REFUSAL.test(transcript),
    detail: REFUSAL.test(transcript) ? 'в ответе отказ модели' : undefined,
  });

  if (transcript.trim().length === 0) {
    results.push({ grader: 'not-empty', passed: false, detail: 'пустой ответ' });
  }

  return results;
};

/** Проверка выбранных инструментов: обязательные вызваны, запрещённые — нет. */
export const gradeTools = (testCase: EvalCase, toolsUsed: readonly string[]): GraderResult[] => {
  const results: GraderResult[] = [];
  const used = new Set(toolsUsed);

  for (const tool of testCase.expectedTools) {
    const passed = [...used].some((name) => name === tool || name.endsWith(`__${tool}`));
    results.push({
      grader: `tool:${tool}`,
      passed,
      detail: passed ? undefined : `инструмент ${tool} не вызван`,
    });
  }

  for (const tool of testCase.forbiddenTools) {
    const passed = ![...used].some((name) => name === tool || name.endsWith(`__${tool}`));
    results.push({
      grader: `forbiddenTool:${tool}`,
      passed,
      detail: passed ? undefined : `запрещённый инструмент ${tool} вызван`,
    });
  }

  return results;
};

/** Итог по кейсу: пройден, если все грейдеры зелёные. */
export const gradeCase = (
  testCase: EvalCase,
  run: { transcript: string; toolsUsed?: readonly string[] },
): GraderResult[] => [
  ...gradeAnswer(testCase, run.transcript),
  ...gradeTools(testCase, run.toolsUsed ?? []),
];
