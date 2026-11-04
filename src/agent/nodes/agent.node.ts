import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { bindToolsCompat } from '../../llm/bind-tools.js';
import { buildAgentSystemPrompt } from '../prompts/agent.prompt.js';
import { ALL_ACCOUNTS_TOOL } from '../../tools/portfolio-snapshot.js';
import type { AgentStateType } from '../graph/state.js';
import { withTimeout } from '../../tools/mcp-tool.adapter.js';

/** Вопросы, на которые данные портфеля нужны всегда — без решения модели. */
const PORTFOLIO_INTENT =
  /портфел|позици|позиций|по счёт|по счет|счетам|счетах|счётам|счетам|что у меня|сколько у меня|акци|бумаг/i;

/** Готовый вызов сводки: тот же инструмент, что выбирает модель. */
const snapshotCall = (): AIMessage =>
  new AIMessage({
    content: '',
    tool_calls: [
      { id: `call-${Date.now()}`, name: ALL_ACCOUNTS_TOOL, args: {} },
    ],
  });

export const ANSWER_TIMEOUT_MS = 15_000;

interface BoundModel {
  invoke(input: (SystemMessage | AgentStateType['messages'][number])[]): Promise<AIMessage>;
}

const messageType = (message: BaseMessage): string =>
  (message as unknown as { _getType?: () => string })._getType?.() ?? '';

/** Текст сообщения независимо от того, строка это или блоки контента. */
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content ?? '');

/**
 * Отказ модели показать данные, хотя они уже получены: «не могу предоставить»,
 * «обратитесь в приложение брокера», «уточните запрос». Используется как сигнал,
 * что ответ бесполезен: для портфельных вопросов вместо него подставляется вызов
 * инструмента, а при наличии отчёта — сам отчёт.
 */
const REFUSAL =
  /не могу (предоставить|показать|получить)|техническ|обратитесь к (вашему )?брокеру|в приложени[еи] брокера|(данные|информаци\w*) (сейчас )?недоступн|уточните запрос|нет доступа к данным/i;

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
        }),
    );
    const { tool_calls: _dropped, ...rest } = message as AIMessage;
    void _dropped;
    return [new AIMessage({ ...rest, tool_calls: calls }), ...results];
  }).flat();
};

/** Отчёты, которые уже готовы к показу: их не нужно пересказывать моделью. */
const REPORT_MARKERS = ['Портфель по счетам брокера:', 'Динамика '];

/**
 * Готовый отчёт из истории: сводка по счетам или динамика цены. Такой текст
 * сформирован кодом (цифры проверены), поэтому отдаём его напрямую — без
 * повторной генерации, которая на большом отчёте упирается в таймаут.
 */
const reportText = (messages: BaseMessage[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (messageType(message) === 'tool' && typeof message.content === 'string') {
      const content: string = message.content;
      if (REPORT_MARKERS.some((marker) => content.startsWith(marker))) {
        return content;
      }
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
    // Последний вопрос пользователя нужен для детерминированных сценариев
    // («что у меня в портфеле»), где модель отвечает уточнением вместо вызова.
    const lastHuman = [...state.messages]
      .reverse()
      .find((message) => messageType(message) === 'human');
    const history = withToolResults(state.messages);
    const report = reportText(history);
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
    // Модель иногда отвечает уточняющим вопросом вместо вызова инструмента,
    // поэтому на первом шаге подставляем вызов сводки сами.
    const askedPortfolio = lastHuman ? PORTFOLIO_INTENT.test(textOf(lastHuman.content)) : false;
    const hasToolResult = state.messages.some((message) => messageType(message) === 'tool');
    const useless = empty || REFUSAL.test(textOf(response.content));
    if (askedPortfolio && !hasToolResult && (useless || (response.tool_calls ?? []).length === 0)) {
      return { messages: [snapshotCall()] };
    }

    return { messages: [response] };
  };
