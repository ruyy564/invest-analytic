// Воспроизведение прогона по журналу: только чтение файла, без сети.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatReplay } from '../dist/platform/runs/replay.js';

const runId = process.argv[2];
if (!runId) {
  console.error('Укажи идентификатор прогона: npm run replay -- <runId>');
  process.exit(1);
}

const dir = process.env.STATE_RUNS_DIR?.trim() || './.state/runs';
const path = join(dir, `${runId}.jsonl`);

try {
  const events = readFileSync(path, 'utf8')
    // BOM появляется, если файл открывали редактором на Windows.
    .replace(/^\uFEFF/, '')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  console.log(formatReplay(events, runId));
} catch (error) {
  console.error(`Журнал прогона ${runId} не найден в ${dir}: ${error.message}`);
  process.exit(1);
}
