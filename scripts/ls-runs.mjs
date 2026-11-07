// Последние прогоны в LangSmith: проверка, что трейсинг работает и какие id у run.
// Запуск: node --env-file=.env scripts/ls-runs.mjs [limit]
import { Client } from 'langsmith';

const limit = Number(process.argv[2] ?? 10);
const project = process.env.LANGSMITH_PROJECT;
const client = new Client();

const runs = [];
for await (const run of client.listRuns({ projectName: project, limit })) {
  runs.push(run);
}

console.log(`проект ${project}: прогонов ${runs.length}`);
for (const run of runs) {
  const metadata = run.extra?.metadata ?? {};
  console.log(
    `${run.id} | ${run.name} | ${run.run_type} | ${run.status}` +
      ` | метка runId=${metadata.runId ?? '-'} sessionId=${metadata.sessionId ?? '-'}`,
  );
}
