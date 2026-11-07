import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { bindToolsCompat } from '../../../platform/llm/bind-tools.js';
import { buildAgentSystemPrompt } from './prompt.js';
import { toolsForQuestion } from './tool-scope.js';
import { discoveryCallFor, tickersFromFind } from './discovery.js';
import {
  MARKET_DYNAMICS_TOOL,
  PORTFOLIO_SNAPSHOT_TOOL,
} from '../../../transports/mcp/mcp-registry.service.js';
import { reportOfState } from '../../results/index.js';
import { isDataRefusal, isRefusal } from '../../services/respond.service.js';
import { DECISION_PATTERN } from '../classify/prompt.js';
import type { KnowledgeProvider } from '../../../capabilities/knowledge/index.js';
import { detectInstruments } from '../../scope.js';
import { FACTORS_TOOL } from '../../../capabilities/market/tools/factors/factors.service.js';
import {
  asksWhatWith,
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
import { lastAnswer } from '../../runner/runner.helpers.js';

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
 * Готовый вызов истории цен: у вопроса о причине динамика должна быть всегда.
 * Модель может промолчать и не вызвать инструмент — тогда «что с бумагой»
 * останется без чисел, поэтому динамику запрашивает сам узел.
 */
const dynamicsCallFor = (
  tickers: string[],
  messages: BaseMessage[],
  tools: StructuredToolInterface[],
): AIMessage | undefined => {
  if (!tools.some((tool) => tool.name === MARKET_DYNAMICS_TOOL)) {
    return undefined;
  }
  const asked = messages.some(
    (message) =>
      messageType(message) === 'ai' &&
      ((message as AIMessage).tool_calls ?? []).some((call) => call.name === MARKET_DYNAMICS_TOOL),
  );
  const ticker = tickers[0];
  if (asked || !ticker) {
    return undefined;
  }
  return new AIMessage({
    content: '',
    tool_calls: [
      {
        id: `dynamics-${Date.now()}`,
        name: MARKET_DYNAMICS_TOOL,
        args: { ticker, days: 180 },
      },
    ],
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

/**
 * Сообщения предыдущего прогона: между предпоследним и последним вопросом.
 * Нужны уточняющему вопросу («расскажи детальней»): у него нет своих данных,
 * а ответ строится по прошлому прогону.
 */
export const previousRun = (messages: BaseMessage[]): BaseMessage[] => {
  const last = lastHumanIndex(messages);
  if (last <= 0) {
    return [];
  }
  const previous = lastHumanIndex(messages.slice(0, last));
  return messages.slice(previous + 1, last);
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
      /**
       * База знаний: темы отбираются под текущий вопрос, а не подаются один раз.
       * Один чек-лист в промпте делал из эксперта справочное бюро.
       */
      knowledge?: KnowledgeProvider;
      /** Сколько символов знаний подавать модели: контекст GigaChat не бесконечен. */
      knowledgeMaxChars?: number;
      /** Алиасы эмитентов: по ним находятся все бумаги, названные в вопросе. */
      aliases?: Record<string, string[]>;
    } = {},
  ) =>
  async (state: AgentStateType) => {
    // Решение о данных — в `dataNeed` и `intent`: узел не разбирает текст вопроса,
    // кроме одного признака — нужна ли трактовка, а не пересказ цифр.
    const history = withToolResults(state.messages);
    // Только текущий прогон: прошлые ответы в треде в расчёт не идут.
    // Уточнение: данных у вопроса нет, поэтому берём прошлый прогон целиком —
    // его ответ и результаты инструментов. Новый вопрос по-прежнему с чистого листа.
    const run = state.followUp ? previousRun(history) : currentRun(history);
    const answered = answeredCalls(run);
    // Сначала типизированный результат (review-ветка), затем отчёт инструмента-агрегатора.
    const report = reportOfState(state)?.payload ?? reportFromTools(run);
    const question = lastQuestion(history);
    // Бумаги, названные в вопросе: нужны и для причин, и для «что с <бумагой>».
    const tickers = [
      ...new Set([
        ...detectInstruments(question, options.aliases ?? {}),
        // Тикер мог найти инструмент по названию в падеже («сегежей» → SGZH).
        ...tickersFromFind(run),
      ]),
    ];
    // Бумага не распознана, но вопрос про эмитента: ищем через инструмент, а не
    // переспрашиваем «о каком самолёте речь». Уточнение тему уже унаследовало.
    if (!state.followUp) {
      const discovery = discoveryCallFor(question, tickers, run, tools);
      if (discovery) {
        return { messages: [discovery] };
      }
    }
    // «Почему упал/вырос X» — вопрос о причине: у брокера причин нет, они берутся
    // из публикаций. «Что с бумагой?» — тоже про движение, но не «что с ценой».
    const causeQuestion = asksForCause(question) || (asksWhatWith(question) && tickers.length > 0);
    // Вопрос требует трактовки («почему», «стоит ли»): сырой отчёт инструмента
    // на такой вопрос не отвечает — это легаси-ответ, его здесь не отдаём.
    const interpretationRequired = asksForInterpretation(state.intent, question);
    // Числа по рынку (нефть, курс, ставка) — аргументы, а не догадки.
    const marketRequest = causeQuestion ? marketCallFor(run, tools) : undefined;
    if (marketRequest) {
      return { messages: [marketRequest] };
    }
    // Динамика цены: без неё ответ «что с бумагой» пуст, и модель может промолчать.
    const dynamicsRequest = causeQuestion ? dynamicsCallFor(tickers, run, tools) : undefined;
    if (dynamicsRequest) {
      return { messages: [dynamicsRequest] };
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

    // Набор инструментов под вопрос: десятки определений в контексте путают модель
    // (Anthropic, «Writing effective tools for agents»), поэтому грузим базу и расширения темы.
    const scopedTools = toolsForQuestion(tools, question);
    const bound = bindToolsCompat(model, scopedTools) as unknown as BoundModel;
    // Уточнение: модели нужен сам предыдущий ответ, иначе она отказывается
    // «показывать данные». Инструкция идёт в тот же system-промпт: GigaChat
    // требует, чтобы system-сообщение было первым, второго он не принимает (422).
    const previousAnswer = state.followUp ? (lastAnswer(run) ?? '').slice(0, 2_000) : '';
    const followUpNote =
      state.followUp && previousAnswer.length > 0
        ? [
            `Пользователь продолжает предыдущую тему. Его сообщение: «${question}».`,
            'Предыдущий ответ:',
            previousAnswer,
            '',
            'Отвечай про тот же объект, что и в предыдущем ответе: если сообщение короткое («акции», ' +
              '«дивиденды», «риски»), это уточнение, а не новый вопрос. Не спрашивай заново, о какой ' +
              'бумаге речь. Разверни детали на данных прогона (динамика, мнение аналитиков, дивиденды, ' +
              'рыночные факторы, публикации с датой и источником). Новых чисел и событий не придумывай: ' +
              'если данных не хватает — так и скажи.',
            'Не задавай встречных вопросов вместо ответа: если данные прогона есть — отвечай по ним. ' +
              'Уточнение уместно только тогда, когда вопрос невозможно понять совсем.',
          ].join('\n')
        : '';
    const systemText = [
      buildAgentSystemPrompt({
        accountId: options.accountId,
        // Знания подбираются под вопрос: эксперт применяет принципы, а не общий чек-лист.
        knowledge:
          options.knowledge && !options.knowledge.isEmpty
            ? options.knowledge.promptBlock({
                question,
                limit: 4,
                maxChars: options.knowledgeMaxChars ?? 6_000,
                // Решение по бумаге или портфелю — вместе с чек-листом.
                ...(DECISION_PATTERN.test(question) ? { required: ['decision-checklist'] } : {}),
              })
            : undefined,
      }),
      followUpNote,
    ]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('\n\n');
    const response = await withTimeout(
      // Провайдеру уходит урезанная история: полные тексты публикаций переполняли
      // контекст, и модель отвечала ошибкой вместо причин.
      bound.invoke([new SystemMessage(systemText), ...clipToolResults(history)]),
      ANSWER_TIMEOUT_MS,
      () => new Error('llm timeout'),
    );

    // GigaChat иногда отдаёт пустой ответ на «расскажи детальней». Один короткий
    // повтор без инструментов: развернуть прошлый ответ по пунктам.
    let reply = response;
    if (state.followUp && textOf(response.content).trim() === '' && previousAnswer.length > 0) {
      try {
        reply = await withTimeout(
          model.invoke([
            new SystemMessage(
              'Разверни предыдущий ответ агента по пунктам: только факты из него, ' +
                'без новых чисел и событий. Если фактов мало — скажи, чего не хватает.',
            ),
            new HumanMessage(`Вопрос: ${question}\n\nПредыдущий ответ:\n${previousAnswer}`),
          ]),
          ANSWER_TIMEOUT_MS,
          () => new Error('llm timeout'),
        );
      } catch {
        // Повтор не удался — ниже сработает ответ по фактам.
      }
    }

    const text = textOf(reply.content).trim();
    // Отказ модели показать данные при доступных инструментах: один повтор с явной
    // инструкцией вызвать инструмент. Иначе агент отвечает «откройте приложение».
    const retryWithTools = async (): Promise<AIMessage | undefined> => {
      const hint = scopedTools
        .slice(0, 8)
        .map((tool) => tool.name)
        .join(', ');
      if (hint.length === 0) {
        return undefined;
      }
      try {
        const retry = await withTimeout(
          bound.invoke([
            new SystemMessage(
              `${systemText}\n\nПредыдущий ответ был отказом показать данные. ` +
                `Доступные инструменты: ${hint}. Вызови подходящий инструмент и ответь по его ` +
                'результату. Отказываться нельзя: данные доступны.',
            ),
            ...clipToolResults(history),
            new HumanMessage(question),
          ]),
          ANSWER_TIMEOUT_MS,
          () => new Error('llm timeout'),
        );
        return (retry.tool_calls ?? []).length > 0 ? (retry as AIMessage) : undefined;
      } catch {
        return undefined;
      }
    };
    // Уточнение разворачивает прошлый ответ: «данных о причинах нет» в нём —
    // законная часть, а не отказ показать данные (REFUSAL при этом действует).
    const answeredByText =
      text !== '' && !isRefusal(text) && (state.followUp || !isDataRefusal(text));
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
    if (askedPortfolio && !hasToolResult && (useless || (reply.tool_calls ?? []).length === 0)) {
      return { messages: [snapshotCall()] };
    }

    const calls = reply.tool_calls ?? [];
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
          return { messages: [withoutToolCalls(reply)] };
        }
        // Отчёт как ответ — только для точечного вопроса по данным.
        if (report && !interpretationRequired) {
          return { messages: [new AIMessage(report)] };
        }
        if (interpretationRequired) {
          return { messages: [new AIMessage(withoutInterpretation())] };
        }
        // Ни текста, ни отчёта: повтор вызова лучше пустого ответа.
        return { messages: [reply] };
      }
      return {
        messages: [fresh.length === calls.length ? reply : withToolCalls(reply, fresh)],
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
      // Отказ показать данные, хотя инструменты доступны: один повтор с прямой
      // инструкцией вызвать инструмент (Anthropic: агент не отказывает, а идёт за данными).
      const retry = await retryWithTools();
      if (retry) {
        return { messages: [retry] };
      }
    }

    return { messages: [reply] };
  };
