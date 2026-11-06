// Оценка ответов моделью по рубрике (живой режим): нужны ключи LLM из окружения.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChatOpenAI } from '@langchain/openai';
import {
  CONCLUSION_RUBRIC,
  judgeAnswer,
  loadEvalCases,
  recordedRunOf,
} from '../dist/eval/index.js';

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error('LLM_API_KEY не задан: живой судья требует ключ провайдера.');
  process.exit(2);
}

const model = new ChatOpenAI({
  apiKey,
  model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
  temperature: 0,
  ...(process.env.LLM_BASE_URL ? { configuration: { baseURL: process.env.LLM_BASE_URL } } : {}),
});

const cases = loadEvalCases(process.env.EVAL_CASES ?? 'test/eval/cases/dialogues.json');
const transcriptsDir = process.env.EVAL_TRANSCRIPTS ?? 'test/eval/transcripts';
const minScore = Number(process.env.EVAL_MIN_SCORE ?? CONCLUSION_RUBRIC.minScore);

let failed = 0;
for (const testCase of cases) {
  const recorded = recordedRunOf(testCase, transcriptsDir);
  if (!recorded) {
    continue;
  }
  const result = await judgeAnswer({
    model,
    rubric: CONCLUSION_RUBRIC,
    question: testCase.question,
    answer: recorded.transcript,
  });
  const passed = typeof result.score === 'number' && result.score >= minScore;
  if (!passed) {
    failed += 1;
  }
  console.log(
    `${passed ? '✓' : '✕'} ${testCase.id}: ${result.score ?? '—'}/5, ` +
      `${result.rubricId}@${result.rubricVersion} — ${result.reason}`,
  );
}

process.exit(failed === 0 ? 0 : 1);
