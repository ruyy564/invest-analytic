// Живая оценка: гоняет кейсы через работающий сервис N раз и считает, сколько
// прогонов прошло («3 из 5»). Офлайн-режим (scripts/eval.mjs) повторяет один и тот
// же записанный ответ, поэтому разброса там нет — стабильность видно только здесь.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatPassRates,
  gradeAnswer,
  loadEvalCases,
  runPassRates,
  casesBelowRate,
} from '../dist/eval/index.js';

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const base = valueOf('base', 'http://127.0.0.1:3000/api/v1');
const casesPath = valueOf('cases', 'test/eval/cases');
/** Сколько раз прогонять кейс: у кейса свой `trials`, флаг перекрывает его. */
const runsOverride = Number(valueOf('runs', '0'));
/** Порог: кейс считается надёжным, если прошло не меньше этой доли прогонов. */
const minPassRate = Number(valueOf('min-pass-rate', '0.6'));
const only = valueOf('only', '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const timeoutMs = Number(valueOf('timeout', '240000'));

const filesOf = (path) =>
  statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((name) => name.endsWith('.json') && !name.endsWith('-template.json'))
        .sort()
        .map((name) => join(path, name))
    : [path];

const cases = filesOf(casesPath)
  .flatMap((file) => loadEvalCases(file))
  .filter((testCase) => only.length === 0 || only.includes(testCase.id));

if (cases.length === 0) {
  console.error('Кейсы не найдены: проверьте --cases и --only.');
  process.exit(2);
}

const post = async (path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  try {
    return { status: response.status, payload: JSON.parse(text) };
  } catch {
    return { status: response.status, payload: { raw: text } };
  }
};

/** Один прогон кейса: контекст диалога, подтверждения и итоговый ответ. */
const runOnce = async (testCase) => {
  const sessionId = crypto.randomUUID();
  for (const previous of testCase.history ?? []) {
    let step = await post('/agent/chat', { message: previous, sessionId });
    for (let attempt = 0; attempt < 3 && step.status === 202; attempt += 1) {
      step = await post('/agent/chat/approve', { sessionId, approved: true });
    }
  }

  let result = await post('/agent/chat', { message: testCase.question, sessionId });
  for (let attempt = 0; attempt < 3 && result.status === 202; attempt += 1) {
    result = await post('/agent/chat/approve', { sessionId, approved: true });
  }
  const answer = String(result.payload?.answer ?? '').trim();
  if (result.status !== 200 || answer.length === 0) {
    throw new Error(`HTTP ${result.status}: ${JSON.stringify(result.payload).slice(0, 200)}`);
  }
  return answer;
};

/** Прогон кейса N раз: каждый ответ оценивается теми же грейдерами. */
const runCase = async (testCase) => {
  const runs = Math.max(1, runsOverride || testCase.trials || 5);
  const results = [];
  for (let index = 0; index < runs; index += 1) {
    const startedAt = Date.now();
    try {
      const answer = await runOnce(testCase);
      const graders = gradeAnswer(testCase, answer);
      const failed = graders.filter((grader) => !grader.passed);
      const run = {
        passed: failed.length === 0,
        graders,
        durationMs: Date.now() - startedAt,
      };
      results.push(run);
      const mark = run.passed ? 'ok ' : 'bad';
      console.log(`  ${mark} ${testCase.id} #${index + 1} — ${Math.round(run.durationMs / 1000)} с`);
    } catch (error) {
      // Сбой прогона — тоже провал: ответа нет, значит грейдеры не прошли.
      results.push({
        passed: false,
        graders: [{ grader: 'run', passed: false, detail: error.message }],
      });
      console.log(`  bad ${testCase.id} #${index + 1} — ${error.message}`);
    }
  }
  return { id: testCase.id, tags: testCase.tags, runs: results };
};

console.log(`Живая оценка: кейсов ${cases.length}, прогонов на кейс ${runsOverride || 'по trials'}`);

const collected = [];
for (const testCase of cases) {
  collected.push(await runCase(testCase));
}

const rates = runPassRates(collected);
const below = casesBelowRate(rates, minPassRate);

// Детали провалов: первый упавший грейдер каждого кейса, чтобы было что чинить.
for (const result of collected) {
  const failedRun = result.runs.find((run) => !run.passed);
  const failed = failedRun?.graders.find((grader) => !grader.passed);
  if (failed) {
    console.log(`  ✕ ${result.id}: ${failed.grader}${failed.detail ? ` — ${failed.detail}` : ''}`);
  }
}

console.log(formatPassRates(rates, minPassRate));
process.exit(below.length === 0 ? 0 : 1);
