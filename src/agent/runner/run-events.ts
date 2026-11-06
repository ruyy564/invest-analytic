import type { ApprovePayload } from '../approval-flow.service.js';
import type { RunResult } from './runner.types.js';

/** События прогона: их получает клиент в потоковом режиме. */
export type RunEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'intent'; intent: string }
  | { type: 'approval'; approval: ApprovePayload }
  | { type: 'tool_call'; tool: string; args?: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; error?: string }
  | { type: 'delta'; text: string }
  | { type: 'completed'; result: RunResult }
  | { type: 'failed'; error: string }
  | { type: 'cancelled' };

/** Минимальный вид события `graph.streamEvents`: не тянем типы библиотеки в API. */
export interface StreamEventLike {
  event: string;
  name?: string;
  data?: Record<string, unknown>;
}

/** Текст чанка модели: строка или массив блоков контента. */
const chunkText = (chunk: unknown): string => {
  const content = (chunk as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === 'string' ? block : String((block as { text?: string })?.text ?? '')))
      .join('');
  }
  return '';
};

/**
 * Преобразует событие LangGraph в событие прогона. Чистая функция: порядок и
 * состав проверяются без запуска графа.
 */
export const runEventOf = (streamEvent: StreamEventLike): RunEvent | undefined => {
  const data = streamEvent.data ?? {};

  switch (streamEvent.event) {
    case 'on_tool_start':
      return { type: 'tool_call', tool: streamEvent.name ?? 'tool', args: data.input };
    case 'on_tool_end':
      return { type: 'tool_result', tool: streamEvent.name ?? 'tool', ok: true };
    case 'on_tool_error':
      return {
        type: 'tool_result',
        tool: streamEvent.name ?? 'tool',
        ok: false,
        error: (data.error as Error | undefined)?.message,
      };
    case 'on_chat_model_stream': {
      const text = chunkText(data.chunk);
      return text.length > 0 ? { type: 'delta', text } : undefined;
    }
    case 'on_chain_end': {
      if (streamEvent.name !== 'classify') {
        return undefined;
      }
      const output = data.output as { intent?: string } | undefined;
      return typeof output?.intent === 'string' ? { type: 'intent', intent: output.intent } : undefined;
    }
    default:
      return undefined;
  }
};

/** Формат SSE-кадра: имя события и JSON-данные одной строкой. */
export const toServerSentEvent = (event: RunEvent): string =>
  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
