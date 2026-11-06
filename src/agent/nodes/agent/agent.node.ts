import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { bindToolsCompat } from '../../../platform/llm/bind-tools.js';
import { buildAgentSystemPrompt } from './prompt.js';
import { PORTFOLIO_SNAPSHOT_TOOL } from '../../../transports/mcp/mcp-registry.service.js';
import { reportOfState } from '../../results/index.js';
import { isDataRefusal } from '../../services/respond.service.js';
import type { AgentStateType } from '../../graph/state.js';
import { withTimeout } from '../../../transports/mcp/mcp-tool.adapter.js';

/** Готовый вызов сводки: тот же инструмент, что выбирает модель. */
const snapshotCall = (): AIMessage =>
  new AIMessage({
    content: '',
    tool_calls: [
      { id: `call-${Date.now()}`, name: PORTFOLIO_SNAPSHOT_TOOL, args: {} },
    ],
  });

export const ANSWER_TIMEOUT_MS = 15_000;

interface BoundModel {
  invoke(input: (SystemMessage | AgentStateType['messages'][number])[]): Promise<AIMessage>;
}

const messageType = (message: BaseMessage): string =>
  (message as unknown as { _getType?: () => string })._getType?.() ?? '';

/**
 * Отказ модели показать данные, хотя они уже получены, обрабатывается сервисом
 * ответа (`isDataRefusal`): здесь остаётся только решение, что делать дальше.
 */
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content ?? '');

/**
 * Провайдеры (GigaChat среди них) отклоняют историю, где у `assistant` есть
 * `tool_calls` без ответа `tool`: так выглядит прерванный прогон, если его
 * продолжили новым вопросом вместо подтверждения. Ответ на такие вызовы
 * достраивается явно — иначе второй вопрос в том же треде падает с 422.
 */
export const withToolResults = (messages: BaseMessage[]): BaseMessage[] => {
  const answered = new Set(
    messages
      .filter((message) => messageType(message) === 'tool')
      .map((message) => (message as ToolMessage).tool_call_id),
  );

  return messages.map((message) => {
    const calls = messageType(message) === 'ai' ? ((message as AIMessage).tool_calls ?? []) : [];
    const missing = calls.filter((call) => !call.id || !answered.has(call.id));

    if (missing.length === 0) {
      return message;
    }

    // Ответы идут сразу за сообщением с вызовами — этого требует формат провайдера.
    const results = missing.map(
      (call) =>
        new ToolMessage({
          tool_call_id: call.id ?? '',
          content: 'Данные не запрашивались: прогон прерван. Запроси их заново, если они нужны.',
          // Прерванный вызов — не отчёт: признак структурный, а не по тексту.
          additional_kwargs: { kind: 'interrupted' },
        }),
    );
    const { tool_calls: _dropped, ...rest } = message as AIMessage;
    void _dropped;
    return [new AIMessage({ ...rest, tool_calls: calls }), ...results];
  }).flat();
};

/** Инструменты, чей ответ — уже готовый отчёт, а не данные для пересказа. */
const REPORT_TOOLS = new Set([PORTFOLIO_SNAPSHOT_TOOL, 'market__price_dynamics']);

/**
 * Готовый отчёт из истории: ответ инструмента-агрегатора. Опознаётся по имени
 * инструмента (контракт), а не по тексту ответа.
 */
const reportFromTools = (messages: BaseMessage[]): string | undefined => {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (messageType(message) === 'ai') {
      for (const call of (message as AIMessage).tool_calls ?? []) {
        if (call.id) {
          names.set(call.id, call.name);
        }
      }
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (messageType(message) !== 'tool' || typeof message.content !== 'string') {
      continue;
    }
    const callId = (message as ToolMessage).tool_call_id;
    const name = names.get(callId ?? '');
    // Отказ и прерванный вызов — не отчёт, даже если инструмент агрегатор.
    const kind = (message as ToolMessage).additional_kwargs?.kind;
    if (kind === 'denied' || kind === 'interrupted') {
      continue;
    }
    if (name && REPORT_TOOLS.has(name) && message.content.trim().length > 0) {
      return message.content;
    }
  }
  return undefined;
};

/**
 * Узел агента: модель с инструментами, роль и запрет торговли — в системном промпте.
 *
 * Когда сводка по счетам уже получена, модель вызывается БЕЗ инструментов: иначе
 * GigaChat повторно просит тот же инструмент (и прогон уходит на второй круг
 * подтверждения вместо ответа). Если модель всё равно вернула пустой ответ,
 * отдаём текст сводки — он уже готов и проверен кодом.
 */
export const createAgentNode =
  (
    model: BaseChatModel,
    tools: StructuredToolInterface[],
    options: { accountId?: string; knowledge?: string } = {},
  ) =>
  async (state: AgentStateType) => {
    // Последний вопрос нужен только для истории: решение о данных — в `dataNeed`.
    const history = withToolResults(state.messages);
    // Сначала типизированный результат (review-ветка), затем отчёт инструмента-агрегатора.
    const report = reportOfState(state)?.payload ?? reportFromTools(history);
    // Отчёт уже сформирован кодом — отдаём его как есть, без генерации и таймаутов.
    if (report) {
      return { messages: [new AIMessage(report)] };
    }

    const bound = bindToolsCompat(model, tools) as unknown as BoundModel;
    let response: AIMessage;
    try {
      response = await withTimeout(
        bound.invoke([new SystemMessage(buildAgentSystemPrompt(options)), ...history]),
        ANSWER_TIMEOUT_MS,
        () => new Error('llm timeout'),
      );
    } catch (error) {
      throw error;
    }

    const empty = typeof response.content === 'string' && response.content.trim() === '';

    // «Что в моем портфеле / сколько у меня акций» — данные нужны всегда.
    // Правило живёт в маршрутизации (`dataNeed`), узел не разбирает текст вопроса.
    const askedPortfolio = state.dataNeed === 'portfolio';
    const hasToolResult = state.messages.some((message) => messageType(message) === 'tool');
    const useless = empty || isDataRefusal(textOf(response.content));
    if (askedPortfolio && !hasToolResult && (useless || (response.tool_calls ?? []).length === 0)) {
      return { messages: [snapshotCall()] };
    }

    return { messages: [response] };
  };
