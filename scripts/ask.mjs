// Быстрый вопрос агенту с итогом прогона: runId, сценарий, покрытие и traceUrl.
// Нужен для проверки правок по трейсам: получили traceUrl → открыли в LangSmith
// или посмотрели `npm run trace -- <runId>`.
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:3000/api/v1' },
    /** Подтвердить чтение данных пользователя (ветка разбора). */
    approve: { type: 'boolean', default: false },
    /** Показать ответ целиком, а не первые строки. */
    full: { type: 'boolean', default: false },
    /** Сохранить весь вывод в файл (UTF-8): удобно для чтения без консольных кодировок. */
    save: { type: 'string' },
    timeout: { type: 'string', default: '240000' },
  },
});

const question = positionals.join(' ').trim();
if (question.length === 0) {
  console.error('Укажи вопрос: node scripts/ask.mjs "почему вырос лукойл?" [--approve] [--full]');
  process.exit(2);
}

const base = values.base;
const timeout = Number(values.timeout);

const post = async (path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  try {
    return { status: response.status, payload: JSON.parse(text) };
  } catch {
    return { status: response.status, payload: { raw: text.slice(0, 500) } };
  }
};

const sessionId = crypto.randomUUID();
let result = await post('/agent/chat', { message: question, sessionId });
const approvals = [];
while (result.status === 202 && values.approve) {
  approvals.push(result.payload?.approval?.label ?? 'подтверждение');
  result = await post('/agent/chat/approve', { sessionId, approved: true });
}

const payload = result.payload ?? {};
const answer = String(payload.answer ?? '');
const lines = [
  `вопрос: ${question}`,
  `HTTP: ${result.status}, статус: ${payload.status ?? '—'}, сценарий: ${payload.intent ?? '—'}` +
    (payload.scope ? `, область: ${payload.scope}${payload.scopeTarget ? `/${payload.scopeTarget}` : ''}` : ''),
  `частичный ответ: ${payload.partial ?? '—'}` +
    (approvals.length > 0 ? `, подтверждений: ${approvals.length} (${approvals.join('; ')})` : ''),
  `runId: ${payload.runId ?? '—'}   (журнал: .state/runs/<runId>.jsonl → npm run replay -- <runId>)`,
  `traceUrl: ${payload.traceUrl ?? '—'}`,
];
if (payload.report) {
  lines.push(
    `отчёт: id=${payload.report.reportId ?? '—'} тип=${payload.report.type ?? '—'}` +
      ` (выгрузка: ${base}/reports/${payload.report.reportId}?format=json)`,
  );
  const coverage = Array.isArray(payload.report.coverage) ? payload.report.coverage : [];
  const missing = coverage.filter((entry) => entry.status !== 'ok');
  lines.push(`покрытие: ${coverage.length} источников, недоступно ${missing.length}`);
  for (const entry of missing.slice(0, 12)) {
    lines.push(`  · ${entry.source}: ${entry.reason ?? 'нет данных'}`);
  }
}
if (payload.approval && result.status === 202) {
  lines.push(`ожидает подтверждения: ${payload.approval.label ?? 'да'} (запусти с --approve)`);
}
lines.push('--- ответ ---');
lines.push(values.full ? answer : answer.split('\n').slice(0, 14).join('\n'));
if (!values.full && answer.split('\n').length > 14) {
  lines.push(`… (ещё ${answer.split('\n').length - 14} строк, полный текст: --full)`);
}
console.log(lines.join('\n'));
if (values.save) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(values.save, `${lines.join('\n')}\n`, 'utf8');
  console.log(`сохранено: ${values.save}`);
}
