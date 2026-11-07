/**
 * Проверка структуры трейса запроса в LangSmith: корневой прогон и все спаны под ним
 * (название, тип, статус, ошибки). Нужна для проверки `traceUrl` без UI.
 * Запуск: node --env-file=.env scripts/trace-report.mjs <runId>
 *
 * `<runId>` — наш идентификатор прогона из ответа API. Id корневого run создаёт
 * LangSmith SDK, поэтому при 404 ищем корень по метке `runId` в metadata.
 */
import { Client } from 'langsmith';

const runId = process.argv[2];
if (!runId) {
  console.error('укажите runId из traceUrl');
  process.exit(1);
}

const project = process.env.LANGSMITH_PROJECT;
const client = new Client();

/** Корень дерева по нашей метке: два прогона при подтверждении — берём последний. */
const findByMetadata = async (attempts = 3) => {
  const filter = `and(eq(is_root, true), eq(metadata_key, "runId"), eq(metadata_value, "${runId}"))`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let found;
    for await (const run of client.listRuns({ projectName: project, filter, limit: 20 })) {
      const metadata = run.extra?.metadata ?? {};
      if (String(run.parent_run_id ?? '') !== '' || metadata.runId !== runId) {
        continue;
      }
      if (!found || String(run.start_time) > String(found.start_time)) {
        found = run;
      }
    }
    if (found) {
      return found;
    }
    // LangSmith индексирует прогон с задержкой: сразу после ответа его может не быть.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return undefined;
};

let root;
try {
  root = await client.readRun(runId, { projectName: project });
} catch (error) {
  console.log(`по id ${runId} прогон не найден (${error.status ?? '—'}), ищем по метке…`);
  root = await findByMetadata();
}

if (!root) {
  console.error(`прогон с меткой runId=${runId} не найден в проекте ${project}`);
  process.exit(1);
}

const metadata = root.extra?.metadata ?? {};
console.log(`КОРЕНЬ: ${root.name} | ${root.run_type} | ${root.status} | ${root.id}`);
console.log(
  `МЕТАДАННЫЕ: requestId=${metadata.requestId ?? '-'} sessionId=${metadata.sessionId ?? '-'}`,
);
console.log(`ССЫЛКА: https://smith.langchain.com/r/${root.id}`);
if (root.error) {
  console.log(`ОШИБКА КОРНЯ: ${root.error.split('\n')[0]}`);
}

const runs = [];
for await (const run of client.listRuns({ projectName: project, limit: 100 })) {
  runs.push(run);
}

/** Все потомки корня в порядке старта (дерево может быть глубже одного уровня). */
const descendants = (parentId) => {
  const direct = runs.filter((run) => String(run.parent_run_id ?? '') === parentId);
  return direct.flatMap((run) => [run, ...descendants(String(run.id))]);
};
const children = descendants(String(root.id)).sort((a, b) =>
  String(a.start_time).localeCompare(String(b.start_time)),
);

console.log(`СПАНЫ (${children.length}):`);
for (const run of children) {
  const status = run.error ? `ошибка: ${run.error.split('\n')[0]}` : run.status;
  console.log(` - ${run.name} (${run.run_type}) — ${status}`);
}
