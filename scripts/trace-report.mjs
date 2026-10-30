/**
 * Проверка структуры трейса запроса в LangSmith: корневой прогон и все спаны под ним
 * (название, тип, статус, ошибки). Нужна для проверки `traceUrl` без UI.
 * Запуск: node --env-file=.env scripts/trace-report.mjs <runId>
 */
import { Client } from 'langsmith';

const runId = process.argv[2];
if (!runId) {
  console.error('укажите runId из traceUrl');
  process.exit(1);
}

const project = process.env.LANGSMITH_PROJECT;
const client = new Client();

const root = await client.readRun(runId, { projectName: project });
const metadata = root.extra?.metadata ?? {};
console.log(`КОРЕНЬ: ${root.name} | ${root.run_type} | ${root.status} | ${root.id}`);
console.log(
  `МЕТАДАННЫЕ: requestId=${metadata.requestId ?? '-'} sessionId=${metadata.sessionId ?? '-'}`,
);
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
const children = descendants(runId).sort((a, b) =>
  String(a.start_time).localeCompare(String(b.start_time)),
);

console.log(`СПАНЫ (${children.length}):`);
for (const run of children) {
  const status = run.error ? `ошибка: ${run.error.split('\n')[0]}` : run.status;
  console.log(` - ${run.name} (${run.run_type}) — ${status}`);
}
