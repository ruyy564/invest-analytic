// Запись эталонных ответов для офлайн-оценки: гоняет вопросы кейсов через
// живой сервис (LLM + MCP) и кладёт ответы в `test/eval/transcripts/<id>.txt`.
//
// Это единственный честный способ записать транскрипт: текст формирует модель,
// поэтому придумать его руками нельзя. Уже записанные файлы не перезаписываются
// без `--force`, чтобы детерминированные транскрипты (например, собранные
// `scripts/record-brief-transcript.mjs`) не затирались живым прогоном.
import { mkdirSync, readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const base = valueOf('base', 'http://127.0.0.1:3000/api/v1');
const casesPath = valueOf('cases', 'test/eval/cases');
const transcriptsDir = valueOf('transcripts', 'test/eval/transcripts');
const limit = Number(valueOf('limit', '0'));
const only = valueOf('only', '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const force = has('force');
/** Ответ модели на разбор портфеля идёт минутами: таймаут на один кейс. */
const timeoutMs = Number(valueOf('timeout', '240000'));

const filesOf = (path) =>
  statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((name) => name.endsWith('.json') && !name.endsWith('-template.json'))
        .sort()
        .map((name) => join(path, name))
    : [path];

const cases = filesOf(casesPath).flatMap((file) => {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : parsed.cases;
});

const pending = cases.filter((testCase) => {
  if (only.length > 0 && !only.includes(testCase.id)) {
    return false;
  }
  const path = join(transcriptsDir, `${testCase.id}.txt`);
  return force || !existsSync(path);
});
const selected = limit > 0 ? pending.slice(0, limit) : pending;

if (selected.length === 0) {
  console.log('Нечего записывать: у всех выбранных кейсов уже есть транскрипт.');
  process.exit(0);
}
console.log(`Кейсов к записи: ${selected.length} (всего без транскрипта: ${pending.length})`);

const post = async (path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
};

/** Один кейс: вопрос, при необходимости подтверждение, затем итоговый ответ. */
const runCase = async (testCase) => {
  const sessionId = crypto.randomUUID();
  // Контекст диалога: кейс может требовать предыдущих вопросов той же сессии.
  for (const previous of testCase.history ?? []) {
    let step = await post('/agent/chat', { message: previous, sessionId });
    for (let attempt = 0; attempt < 3 && step.status === 202; attempt += 1) {
      step = await post('/agent/chat/approve', { sessionId, approved: true });
    }
  }

  let result = await post('/agent/chat', { message: testCase.question, sessionId });

  // Шаги с чтением данных пользователя требуют подтверждения: в записи считаем,
  // что пользователь согласен, — иначе транскрипта не будет вовсе.
  for (let attempt = 0; attempt < 3 && result.status === 202; attempt += 1) {
    result = await post('/agent/chat/approve', { sessionId, approved: true });
  }

  if (result.status !== 200) {
    throw new Error(`HTTP ${result.status}: ${JSON.stringify(result.payload).slice(0, 300)}`);
  }
  const answer = String(result.payload.answer ?? '').trim();
  if (answer.length === 0) {
    throw new Error(`пустой ответ (status: ${result.payload.status})`);
  }
  return answer;
};

mkdirSync(transcriptsDir, { recursive: true });
let failed = 0;
for (const testCase of selected) {
  const startedAt = Date.now();
  try {
    const answer = await runCase(testCase);
    writeFileSync(join(transcriptsDir, `${testCase.id}.txt`), `${answer}\n`, 'utf8');
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`ok   ${testCase.id} — ${answer.length} симв., ${seconds} с`);
  } catch (error) {
    failed += 1;
    console.log(`fail ${testCase.id} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`Готово: записано ${selected.length - failed}, ошибок ${failed}`);
process.exit(failed === 0 ? 0 : 1);
