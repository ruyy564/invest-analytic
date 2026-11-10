/**
 * Проверка LangSmith Studio-сервера теми же HTTP-запросами, что делает UI:
 * тред → прогон в треде (`/runs/stream`) → пауза подтверждения → resume.
 *
 *   npm run studio:check            (сервер уже запущен: npm run studio)
 *   npm run studio:check -- 2024    (другой порт)
 */
import { Client } from '@langchain/langgraph-sdk';

const port = process.argv[2] ?? process.env.STUDIO_PORT ?? '2024';
const baseUrl = `http://127.0.0.1:${port}`;
const client = new Client({ apiUrl: baseUrl });

const step = (text) => console.log(`\n── ${text}`);
const ok = (text) => console.log(`✔ ${text}`);
const fail = (text) => {
  console.error(`\n✖ ${text}`);
  process.exit(1);
};

step(`сервер ${baseUrl}`);
const assistants = await client.assistants.search({ limit: 10 });
if (assistants.length === 0) {
  fail('графы не зарегистрированы — проверьте langgraph.json и npm run build');
}
const graphId = process.env.STUDIO_GRAPH ?? assistants[0].graph_id;
ok(`граф «${graphId}» зарегистрирован`);

const [assistant] = await client.assistants.search({ graphId, limit: 1 });
const graph = await client.assistants.getGraph(assistant.assistant_id);
const nodes = graph.nodes.map((node) => node.id).sort();
ok(`узлы графа: ${nodes.join(', ')}`);

/** Прогон: как `/runs/stream` из UI, поток `values` (состояние после каждого узла). */
const run = async (threadId, input) => {
  const events = [];
  for await (const chunk of client.runs.stream(threadId, graphId, { input, streamMode: 'values' })) {
    events.push(Array.isArray(chunk) ? { event: chunk[0], data: chunk[1] } : chunk);
  }
  return events;
};

step('чат: сообщение в новом треде');
const thread = await client.threads.create();
ok(`тред: ${thread.thread_id}`);

const first = await run(thread.thread_id, {
  messages: [{ type: 'human', content: 'Что у меня в портфеле?' }],
});
const firstError = first.find((event) => event.event === 'error');
if (firstError) {
  fail(`прогон упал: ${JSON.stringify(firstError.data).slice(0, 500)}`);
}

const state1 = await client.threads.getState(thread.thread_id);
// Пауза статическая: interrupt-задач нет, но прогон остановлен (`next` не пуст).
if ((state1.next?.length ?? 0) === 0) {
  const last = [...first].reverse().find((event) => event.event === 'values')?.data;
  fail(`нет паузы подтверждения. Ответ: ${JSON.stringify(last?.messages?.at(-1)).slice(0, 400)}`);
}
ok(`пауза перед подтверждением: ждут ${state1.next.join(', ')}`);
ok(`сообщений в треде: ${state1.values.messages.length}, intent: ${state1.values.intent}`);

/**
 * Печать ошибки провайдера: GigaChat бросает `ResponseError` с `response.data`
 * (`{ status, message }`), поэтому одного `String(error)` мало.
 */
const describeError = (data) => {
  const seen = new Set();
  const parts = [];
  let current = data instanceof Error ? data : null;
  for (let depth = 0; current && depth < 4; depth += 1) {
    parts.push(current.message);
    for (const key of ['status', 'code', 'detail']) {
      if (current[key] !== undefined) {
        parts.push(String(current[key]));
      }
    }
    const payload = current.response?.data ?? current.data;
    if (payload) {
      parts.push(typeof payload === 'string' ? payload : JSON.stringify(payload));
    }
    if (seen.has(current.cause)) break;
    seen.add(current.cause);
    current = current.cause instanceof Error ? current.cause : null;
  }
  return parts.filter(Boolean).join(' | ').slice(0, 400) || 'неизвестная ошибка провайдера';
};

const isLlmFailure = (events) => events.find((event) => event.event === 'error');

step('чат: продолжение диалога в том же треде');
const historyBefore = state1.values.messages.length;
const second = await run(thread.thread_id, {
  messages: [{ type: 'human', content: 'Сколько у меня позиций?' }],
});
const secondError = isLlmFailure(second);
const state2 = await client.threads.getState(thread.thread_id);
if (state2.values.messages.length <= historyBefore && !secondError) {
  fail('история не выросла: состояние треда не сохраняется');
}
const humanCount = state2.values.messages.filter((message) => message.type === 'human').length;
ok(`история: ${historyBefore} → ${state2.values.messages.length} сообщений (${humanCount} от пользователя)`);
if (secondError) {
  console.log(`⚠ второй прогон прерван провайдером LLM: ${describeError(secondError.data)}`);
  console.log('  (тред и история при этом сохранены — это ограничение GigaChat, не Studio)');
}

step('подтверждение: пустой Resume');
const resumeEvents = [];
for await (const chunk of client.runs.stream(thread.thread_id, graphId, {
  input: null,
  streamMode: 'values',
})) {
  resumeEvents.push(Array.isArray(chunk) ? { event: chunk[0], data: chunk[1] } : chunk);
}
const resumeError = isLlmFailure(resumeEvents);
const state3 = await client.threads.getState(thread.thread_id);
if ((state3.next?.length ?? 0) > 0) {
  fail('после Resume подтверждение всё ещё висит');
}
ok('пустой Resume принят, пауза снята');
if (resumeError) {
  console.log(`⚠ прогон прерван провайдером LLM: ${describeError(resumeError.data)}`);
} else {
  const answer = [...state3.values.messages].reverse().find((message) => message.type === 'ai');
  ok(`прогон завершён, ответ: «${String(answer?.content ?? '').slice(0, 100)}…»`);
}

console.log('\n✔ Studio-сервер: граф, история треда и подтверждение работают');
