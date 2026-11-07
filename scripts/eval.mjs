// Офлайн-оценка кейсов: грейдеры по записанным ответам, без сети.
// Режимы: offline (по умолчанию), live (полный граф на фейках), judge (LLM-судья).
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { collectCaseResults, formatEvalReport, loadEvalCases, summarizeEval } from '../dist/eval/index.js';

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const mode = valueOf('mode', 'offline');
const casesPath = valueOf('cases', 'test/eval/cases');
const transcriptsDir = valueOf('transcripts', 'test/eval/transcripts');

if (mode === 'live') {
  // Живая оценка: кейсы прогоняются через работающий сервис N раз, считается
  // «сколько прогонов прошло» — разброс видно только на живых ответах.
  const rest = args.filter((arg) => arg !== '--mode' && arg !== 'live');
  const result = spawnSync('node', ['scripts/eval-live.mjs', ...rest], {
    stdio: 'inherit',
    shell: true,
  });
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

/** Корзины: файл или каталог со всеми `*.json`; шаблоны кейсов не считаются корзиной. */
const filesOf = (path) => {
  if (!statSync(path).isDirectory()) {
    return [path];
  }
  return readdirSync(path)
    .filter((name) => name.endsWith('.json') && !name.endsWith('-template.json'))
    .sort()
    .map((name) => join(path, name));
};

const basketFiles = filesOf(casesPath);
const cases = basketFiles.flatMap((file) => loadEvalCases(file));
const { results, skipped } = collectCaseResults(cases, transcriptsDir);
const summary = summarizeEval(results);

console.log(`Корзин: ${basketFiles.length}, кейсов: ${cases.length}`);
console.log(formatEvalReport(summary));
if (skipped.length > 0) {
  console.log(`Без записанного ответа (пропущено): ${skipped.length}`);
  for (const id of skipped) {
    console.log(`  · ${id}`);
  }
}

process.exit(summary.failed.length === 0 ? 0 : 1);
