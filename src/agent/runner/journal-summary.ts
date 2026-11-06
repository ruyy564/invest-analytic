import type { AgentStateType } from '../graph/state.js';
import type { RunResult } from './runner.types.js';

type Messages = AgentStateType['messages'];

/** Тип сообщения без импорта классов: нужен только для чтения полей. */
const kindOf = (message: unknown): string =>
  (message as { _getType?: () => string })._getType?.() ?? '';

/** Инструменты, которые модель запросила за прогон (по порядку). */
export const toolsOf = (messages: Messages): string[] =>
  (messages ?? []).flatMap((message) =>
    kindOf(message) === 'ai'
      ? ((message as { tool_calls?: { name: string }[] }).tool_calls ?? []).map((call) => call.name)
      : [],
  );

/** Расход токенов, если провайдер его вернул: иначе `undefined`. */
export const usageOf = (
  messages: Messages,
): { inputTokens: number; outputTokens: number } | undefined => {
  let inputTokens = 0;
  let outputTokens = 0;
  let found = false;
  for (const message of messages ?? []) {
    const usage = (message as { usage_metadata?: { input_tokens?: number; output_tokens?: number } })
      .usage_metadata;
    if (!usage) {
      continue;
    }
    found = true;
    inputTokens += usage.input_tokens ?? 0;
    outputTokens += usage.output_tokens ?? 0;
  }
  return found ? { inputTokens, outputTokens } : undefined;
};

/** Почему прогон завершился: нужен для метрик и разбора инцидентов. */
export const stopReasonOf = (
  result: RunResult,
  options: { budgetExhausted?: boolean } = {},
): 'answered' | 'approval' | 'budget' | 'guard' | 'no_data' => {
  if (result.status === 'awaiting_approval') {
    return 'approval';
  }
  // Бюджет проверяется по счётчику прогона, а не по тексту сообщения инструмента.
  if (options.budgetExhausted) {
    return 'budget';
  }
  if (result.intent === 'off_topic') {
    return 'guard';
  }
  return result.partial ? 'no_data' : 'answered';
};
