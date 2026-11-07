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

/** Строка-цитата публикации: «• 2026-11-05 [интерфакс] Заголовок». */
const CITATION_LINE = /^[•*-]\s*\d{4}-\d{2}-\d{2}\s*\[[^\]]+\]\s*\S+/gm;

/** Числа в ответе: целые от 2 знаков или с дробной частью (цены, проценты, суммы). */
const NUMBER = /-?\d+[.,]\d+|\d{2,}/g;

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

  // Структура: аналитика проверяется по разделам, а не по общему впечатлению.
  for (const section of answer?.sections ?? []) {
    results.push({
      grader: `section:${section}`,
      passed: transcript.includes(section),
      detail: transcript.includes(section) ? undefined : `нет раздела «${section}»`,
    });
  }

  // Цитаты: причина без даты и источника — домысел, грейдер это ловит.
  if (answer?.minCitations) {
    const found = (transcript.match(CITATION_LINE) ?? []).length;
    results.push({
      grader: `citations:>=${answer.minCitations}`,
      passed: found >= answer.minCitations,
      detail: found >= answer.minCitations ? undefined : `цитат ${found}, нужно ${answer.minCitations}`,
    });
  }

  // Числа: «бумага выросла» без цифр проверяемо только наличием чисел.
  if (answer?.minNumbers) {
    const found = (transcript.match(NUMBER) ?? []).length;
    results.push({
      grader: `numbers:>=${answer.minNumbers}`,
      passed: found >= answer.minNumbers,
      detail: found >= answer.minNumbers ? undefined : `чисел ${found}, нужно ${answer.minNumbers}`,
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
  // Инструменты проверяем только по записанному прогону: в офлайн-транскрипте
  // вызовов нет, и «ноль вызовов» — отсутствие данных, а не провал.
  ...(run.toolsUsed ? gradeTools(testCase, run.toolsUsed) : []),
];
