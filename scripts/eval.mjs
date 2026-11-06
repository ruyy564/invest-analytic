// Офлайн-оценка кейсов: грейдеры по записанным ответам, без сети.
// Режимы: offline (по умолчанию), live (полный граф на фейках), judge (LLM-судья).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { collectCaseResults, formatEvalReport, loadEvalCases, summarizeEval } from '../dist/eval/index.js';

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const mode = valueOf('mode', 'offline');
const casesPath = valueOf('cases', 'test/eval/cases/dialogues.json');
const transcriptsDir = valueOf('transcripts', 'test/eval/transcripts');

if (mode === 'live') {
  // Живой прогон графа на фейковых MCP и скриптовой модели: сеть не нужна.
  const result = spawnSync('npm', ['run', 'test:e2e'], { stdio: 'inherit', shell: true });
  process.exit(result.status ?? 1);
}

if (mode === 'judge') {
  const result = spawnSync('node', ['scripts/eval-judge.mjs'], { stdio: 'inherit', shell: true });
  process.exit(result.status ?? 1);
}

if (mode !== 'offline') {
  console.error(`Неизвестный режим: ${mode}. Допустимо: offline, live, judge.`);
  process.exit(2);
}

const cases = loadEvalCases(casesPath);
const { results, skipped } = collectCaseResults(cases, transcriptsDir);
const summary = summarizeEval(results);

console.log(`Кейсов в наборе: ${cases.length}`);
console.log(formatEvalReport(summary));
if (skipped.length > 0) {
  console.log(`Без записанного ответа (пропущено): ${skipped.length}`);
  for (const id of skipped) {
    console.log(`  · ${id}`);
  }
}

process.exit(summary.failed.length === 0 ? 0 : 1);
