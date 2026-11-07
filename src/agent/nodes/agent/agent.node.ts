import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { bindToolsCompat } from '../../../platform/llm/bind-tools.js';
import { buildAgentSystemPrompt } from './prompt.js';
import {
  MARKET_DYNAMICS_TOOL,
  PORTFOLIO_SNAPSHOT_TOOL,
} from '../../../transports/mcp/mcp-registry.service.js';
import { reportOfState } from '../../results/index.js';
import { isDataRefusal } from '../../services/respond.service.js';
import { DECISION_PATTERN } from '../classify/prompt.js';
import { detectInstruments } from '../../scope.js';
import { FACTORS_TOOL } from '../../../capabilities/market/tools/factors/factors.service.js';
import {
  causeFactsAnswer,
  factsWithoutInterpretation,
  isGroundedCauseAnswer,
  knownTickers,
  newsFailures,
  newsItems,
  newsTickersRequested,
  NEWS_SEARCH_TOOL,
  toolResults,
  type CauseFactsInput,
} from './cause.js';
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

/**
 * Готовый вызов рыночных факторов: числа вместо слов «возможно, нефть выросла».
 * Публичные котировки и ставка, подтверждение не требуется.
 */
const marketCallFor = (
  messages: BaseMessage[],
  tools: StructuredToolInterface[],
): AIMessage | undefined => {
  if (!tools.some((tool) => tool.name === FACTORS_TOOL)) {
    return undefined;
  }
  const asked = messages.some(
    (message) =>
      messageType(message) === 'ai' &&
      ((message as AIMessage).tool_calls ?? []).some((call) => call.name === FACTORS_TOOL),
  );
  if (asked) {
    return undefined;
  }
  return new AIMessage({
    content: '',
    tool_calls: [{ id: `factors-${Date.now()}`, name: FACTORS_TOOL, args: { days: 30 } }],
  });
};

/**
 * Вызов новостей для вопроса о причинах: по каждой названной бумаге, а если бумага
 * не названа — по общей повестке. Уже запрошенные в прогоне не повторяются,
 * подтверждение не нужно: новостной фасад работает с публичными источниками.
 */
const newsCallFor = (
  tickers: string[],
  messages: BaseMessage[],
  tools: StructuredToolInterface[],
  question = '',
): AIMessage | undefined => {
  if (!tools.some((tool) => tool.name === NEWS_SEARCH_TOOL)) {
    return undefined;
  }
  const requested = newsTickersRequested(messages);
  const wanted = (tickers.length > 0 ? tickers : ['']).slice(0, 3);
  const missing = wanted.filter((ticker) => !requested.has(ticker));
  // По бумаге публикаций не нашлось: причину ищут и в общей повестке — нефть,
  // курс валюты, ставка, санкции объясняют движение чаще, чем новости эмитента.
  const noNewsYet = newsItems(messages).length === 0;
  const general =
    tickers.length > 0 && missing.length === 0 && noNewsYet && !requested.has('') ? [''] : [];
  const calls = [...missing, ...general];
  if (calls.length === 0) {
    return undefined;
  }
  // По одному вызову за круг: несколько function results на один assistant message
  // принимают не все провайдеры (GigaChat отвечает 422 «every assistant function
  // result must have an assistant function call in history»).
  const [ticker] = calls;

  return new AIMessage({
    content: '',
    tool_calls: [
      {
        id: `news-${Date.now()}`,
        name: NEWS_SEARCH_TOOL,
        // На вопрос о причине нужен запас публикаций: по одному заголовку причину
        // не определить, а аннотации дают содержание. Окно шире месяца: движение
        // цены за полгода объясняют и более ранние публикации. Статьи дочитываются
        // целиком, к новостям бумаги добавляются публикации по факторам (нефть,
        // курс, ставка, санкции), а порядок задаёт сам вопрос (`focus`).
        args: {
          ...(ticker ? { ticker, days: 90 } : { days: 14 }),
          limit: 12,
          fullText: true,
          factors: true,
          ...(question.trim().length > 0 ? { focus: question } : {}),
        },
      },
    ],
  });
};

/**
 * Предел ожидания ответа модели. 60 с, а не 15: развёрнутый ответ по двум бумагам
 * с фактами и публикациями не укладывался — прогон отдавал «не удалось за
 * отведённое время» вместо ответа (поймано корзиной регрессий).
 */
export const ANSWER_TIMEOUT_MS = 60_000;

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
 * Объём результатов инструментов, который получает модель.
 *
 * Ленты отдают полные тексты публикаций, и на вопросе о двух бумагах контекст
 * перерастал лимит провайдера: GigaChat отвечал `ResponseError`, а прогон —
 * «не удалось подготовить ответ». Режем по бюджету, свежие результаты важнее:
 * старые обрезаются первыми.
 */
export const TOOL_CONTEXT_MAX_CHARS = 40_000;
export const TOOL_RESULT_MAX_CHARS = 4_000;

/** История для модели: длинные ответы инструментов урезаются до бюджета контекста. */
export const clipToolResults = (
  messages: BaseMessage[],
  maxChars = TOOL_CONTEXT_MAX_CHARS,
): BaseMessage[] => {
  const toolIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) => messageType(message) === 'tool' && typeof message.content === 'string',
    );

  let budget = maxChars;
  const clipped = new Map<number, BaseMessage>();
  // С конца: последние данные — те, о которых спрашивают.
  for (const { message, index } of [...toolIndexes].reverse()) {
    const text = String(message.content);
    const limit = Math.max(0, Math.min(TOOL_RESULT_MAX_CHARS, budget));
    const content = text.length <= limit ? text : `${text.slice(0, limit)}… (текст сокращён)`;
    budget -= content.length;
    const tool = message as ToolMessage;
    clipped.set(
      index,
      new ToolMessage({
        tool_call_id: tool.tool_call_id,
        content,
        ...(tool.name ? { name: tool.name } : {}),
        additional_kwargs: message.additional_kwargs ?? {},
      }),
    );
  }

  return messages.map((message, index) => clipped.get(index) ?? message);
};
/**
 * Вопрос про причину движения цены: «почему упал Сбер», «что случилось с Яндексом».
 * Перечень цен на такой вопрос не отвечает — нужна трактовка, а если причин в данных
 * нет, так и сказать. Слово «почему» без движения бумаги сюда не относится: причины
 * ищут только у цены.
 */
const CAUSE_WORDS = /почему|отчего|по какой причине|из-за чего|с чего|что случилось|что происходит/i;
const MOVEMENT_WORDS =
  /упал|вырос|просел|подешевел|подорожал|рухнул|обвалил|взлетел|снизил|поднял|растёт|растет|падает|котировк|цена|цены|акци/i;
const MOVEMENT_ONLY = /что\s+случилось|что\s+происходит/i;

/** Вопрос про причину движения цены — повод собрать публикации, а не цифры. */
export const asksForCause = (question: string): boolean =>
  CAUSE_WORDS.test(question) && (MOVEMENT_WORDS.test(question) || MOVEMENT_ONLY.test(question));

/**
 * Вопрос требует трактовки, а не готового отчёта кодом: «стоит ли покупать» и
 * «почему упал» — просьбы об оценке, поэтому одной динамики цены для ответа мало.
 */
export const asksForInterpretation = (
  intent: AgentStateType['intent'] | undefined,
  question: string,
): boolean => intent === 'security_analysis' || DECISION_PATTERN.test(question) || asksForCause(question);

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

/** Индекс последнего вопроса пользователя в истории; `-1` — вопросов нет. */
const lastHumanIndex = (messages: BaseMessage[]): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messageType(messages[index]) === 'human') {
      return index;
    }
  }
  return -1;
};

/**
 * Сообщения текущего прогона: всё, что появилось после последнего вопроса.
 * Результаты прошлых вопросов в треде в ответ не идут — иначе новый вопрос
 * получал бы готовый отчёт предыдущего прогона (тот самый «закешированный ответ»).
 */
export const currentRun = (messages: BaseMessage[]): BaseMessage[] => {
  const index = lastHumanIndex(messages);
  return index === -1 ? messages : messages.slice(index + 1);
};

/** Текст последнего вопроса: по нему отличаем вопрос-оценку от вопроса по данным. */
export const lastQuestion = (messages: BaseMessage[]): string => {
  const index = lastHumanIndex(messages);
  const content = index === -1 ? '' : messages[index].content;
  return typeof content === 'string' ? content : '';
};

/** Значение как строка без зависимости от порядка ключей: подпись вызова устойчива. */
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/** Подпись вызова инструмента: по ней видно, что тот же вызов уже выполнен. */
export const callSignature = (name: string, args: unknown): string =>
  `${name}:${stableJson(args ?? {})}`;

/**
 * Вызовы, по которым в переданных сообщениях уже есть результат. Повторять их
 * незачем: это второй круг подтверждения и повторный запрос к брокеру вместо ответа.
 */
export const answeredCalls = (messages: BaseMessage[]): Set<string> => {
  const pending = new Map<string, string>();
  for (const message of messages) {
    if (messageType(message) !== 'ai') {
      continue;
    }
    for (const call of (message as AIMessage).tool_calls ?? []) {
      if (call.id) {
        pending.set(call.id, callSignature(call.name, call.args));
      }
    }
  }

  const answered = new Set<string>();
  for (const message of messages) {
    if (messageType(message) !== 'tool') {
      continue;
    }
    const signature = pending.get((message as ToolMessage).tool_call_id ?? '');
    if (signature) {
      answered.add(signature);
    }
  }
  return answered;
};

/** Ответ модели без вызовов: прогон завершается текстом, а не новым кругом чтения. */
const withoutToolCalls = (message: AIMessage): AIMessage => {
  const { tool_calls: _dropped, ...rest } = message;
  void _dropped;
  return new AIMessage({ ...rest, tool_calls: [] });
};

/** Ответ модели с частью вызовов: уже выполненные повторно не запрашиваются. */
const withToolCalls = (
  message: AIMessage,
  calls: NonNullable<AIMessage['tool_calls']>,
): AIMessage => {
  const { tool_calls: _dropped, ...rest } = message;
  void _dropped;
  return new AIMessage({ ...rest, tool_calls: calls });
};

/**
 * Узел агента: модель с инструментами, роль и запрет торговли — в системном промпте.
 *
 * Данные берутся только из результатов инструментов ТЕКУЩЕГО прогона: отчёт
 * прошлого вопроса в треде не переиспользуется. Готовый отчёт кода (сводка по
 * счетам, динамика цены) отдаётся сразу, если вопрос — точечный, и служит
 * резервом ответа, если модель промолчала или сослалась на недоступность данных.
 * Повторный вызов с теми же аргументами не выполняется: данные уже получены,
 * а второй круг подтверждения и лишний запрос к брокеру ответом не являются.
 */
export const createAgentNode =
  (
    model: BaseChatModel,
    tools: StructuredToolInterface[],
    options: {
      accountId?: string;
      knowledge?: string;
      /** Алиасы эмитентов: по ним находятся все бумаги, названные в вопросе. */
      aliases?: Record<string, string[]>;
    } = {},
  ) =>
  async (state: AgentStateType) => {
    // Решение о данных — в `dataNeed` и `intent`: узел не разбирает текст вопроса,
    // кроме одного признака — нужна ли трактовка, а не пересказ цифр.
    const history = withToolResults(state.messages);
    // Только текущий прогон: прошлые ответы в треде в расчёт не идут.
    const run = currentRun(history);
    const answered = answeredCalls(run);
    // Сначала типизированный результат (review-ветка), затем отчёт инструмента-агрегатора.
    const report = reportOfState(state)?.payload ?? reportFromTools(run);
    const question = lastQuestion(history);
    // «Почему упал/вырос X» — вопрос о причине: у брокера причин нет, они берутся
    // из публикаций. Сначала собираем новости, иначе модель их придумает.
    const causeQuestion = asksForCause(question);
    // Вопрос требует трактовки («почему», «стоит ли»): сырой отчёт инструмента
    // на такой вопрос не отвечает — это легаси-ответ, его здесь не отдаём.
    const interpretationRequired = asksForInterpretation(state.intent, question);
    const tickers = causeQuestion ? detectInstruments(question, options.aliases ?? {}) : [];
    // Числа по рынку (нефть, курс, ставка) — аргументы, а не догадки.
    const marketRequest = causeQuestion ? marketCallFor(run, tools) : undefined;
    if (marketRequest) {
      return { messages: [marketRequest] };
    }
    const newsRequest = causeQuestion ? newsCallFor(tickers, run, tools, question) : undefined;
    if (newsRequest) {
      return { messages: [newsRequest] };
    }

    // Точечный вопрос по готовым данным: отдаём отчёт как есть, без генерации и таймаутов.
    // Отчёт — ответ только для такого вопроса: «почему/стоит ли» требует трактовки.
    if (report && !interpretationRequired) {
      return { messages: [new AIMessage(report)] };
    }

    const bound = bindToolsCompat(model, tools) as unknown as BoundModel;
    const response = await withTimeout(
      // Провайдеру уходит урезанная история: полные тексты публикаций переполняли
      // контекст, и модель отвечала ошибкой вместо причин.
      bound.invoke([new SystemMessage(buildAgentSystemPrompt(options)), ...clipToolResults(history)]),
      ANSWER_TIMEOUT_MS,
      () => new Error('llm timeout'),
    );

    const text = textOf(response.content).trim();
    const answeredByText = text !== '' && !isDataRefusal(text);
    const useless = !answeredByText;
    // Вопрос о причинах: ответ принимается только со ссылкой на публикацию.
    const news = causeQuestion ? newsItems(run) : [];
    const grounded =
      answeredByText &&
      (!causeQuestion || isGroundedCauseAnswer(text, news, knownTickers(run, options.aliases ?? {})));
    // Факты вместо домыслов: движения цен, публикации и честное «причина не установлена».
    const facts = (): CauseFactsInput => ({
      dynamics: toolResults(run, new Set([MARKET_DYNAMICS_TOOL])),
      macro: toolResults(run, new Set([FACTORS_TOOL])),
      news,
      tickers,
      failures: newsFailures(run),
    });
    const factsAnswer = (): string => causeFactsAnswer(facts());
    /** Вопрос требовал трактовки, а модели нет: факты прогона без вывода. */
    const withoutInterpretation = (): string => factsWithoutInterpretation(facts());

    // «Что в моем портфеле / сколько у меня акций» — данные нужны всегда.
    // Правило живёт в маршрутизации (`dataNeed`), узел не разбирает текст вопроса.
    const askedPortfolio = state.dataNeed === 'portfolio';
    const hasToolResult = run.some((message) => messageType(message) === 'tool');
    if (askedPortfolio && !hasToolResult && (useless || (response.tool_calls ?? []).length === 0)) {
      return { messages: [snapshotCall()] };
    }

    const calls = response.tool_calls ?? [];
    // Вызовы, данные по которым в этом прогоне уже есть, повторять незачем.
    const fresh = calls.filter((call) => !answered.has(callSignature(call.name, call.args)));

    if (calls.length > 0) {
      if (fresh.length === 0) {
        // Модель просит то, что уже получено в этом прогоне.
        if (causeQuestion) {
          // На вопрос о причине одной динамикой цены не ответить: отдаём факты.
          return { messages: [new AIMessage(grounded ? text : factsAnswer())] };
        }
        if (answeredByText) {
          return { messages: [withoutToolCalls(response)] };
        }
        // Отчёт как ответ — только для точечного вопроса по данным.
        if (report && !interpretationRequired) {
          return { messages: [new AIMessage(report)] };
        }
        if (interpretationRequired) {
          return { messages: [new AIMessage(withoutInterpretation())] };
        }
        // Ни текста, ни отчёта: повтор вызова лучше пустого ответа.
        return { messages: [response] };
      }
      return {
        messages: [fresh.length === calls.length ? response : withToolCalls(response, fresh)],
      };
    }

    // Вопрос о причинах: отказ («нет доступа к новостям») или текст без ссылки на
    // публикацию — не ответ. Отдаём факты прогона и честное «причина не установлена».
    if (causeQuestion) {
      return { messages: [new AIMessage(grounded ? text : factsAnswer())] };
    }

    // Вызовов нет: модель либо ответила, либо промолчала при уже собранных данных.
    if (useless) {
      // Вопрос требовал трактовки — сырой отчёт инструмента здесь не ответ.
      if (interpretationRequired) {
        return { messages: [new AIMessage(withoutInterpretation())] };
      }
      if (report) {
        return { messages: [new AIMessage(report)] };
      }
    }

    return { messages: [response] };
  };
