import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import { loadTickerAliases } from '../../../capabilities/news/news.aliases.js';
import type { KnowledgeProvider } from '../../../capabilities/knowledge/index.js';
import type { AgentStateType } from '../../graph/state.js';
import { routeQuestion } from '../../routing/index.js';

/** Предел ожидания классификатора: одно слово, дольше ждать бессмысленно. */
export const CLASSIFY_TIMEOUT_MS = 8_000;

export interface ClassifyNodeOptions {
  /** Файл алиасов: подстроки для поиска бумаги в вопросе. */
  aliasesPath?: string;
  helpEnabled?: boolean;
  newsEnabled?: boolean;
}

/**
 * Узел классификации: тонкий переходник над `routeQuestion`.
 *
 * Вся логика (guard → правила → модель → безопасный вариант) живёт в
 * `agent/routing`; узел только читает последний вопрос и возвращает дельту
 * состояния вместе с источником решения (`routeSource`).
 */
export const createClassifyNode = (
  model: BaseChatModel,
  knowledge?: KnowledgeProvider,
  options: ClassifyNodeOptions = {},
) => {
  const logger = new Logger('ClassifyNode');

  return async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const typeOf = (message: unknown): string =>
      (message as { _getType?: () => string })._getType?.() ?? '';
    const humans = state.messages.filter((message) => typeOf(message) === 'human');
    const lastHuman = humans.at(-1);
    // Бумага могла быть названа в предыдущем вопросе: «стоит ли её покупать?».
    const previousHuman = humans.length > 1 ? humans[humans.length - 2] : undefined;
    const contentOf = (message: (typeof humans)[number] | undefined): string =>
      typeof message?.content === 'string'
        ? message.content
        : JSON.stringify(message?.content ?? '');

    const question = contentOf(lastHuman);

    const route = await routeQuestion({
      question,
      previousQuestion: contentOf(previousHuman),
      // Сценарий прошлого вопроса: уточнение («расскажи детальней») его наследует.
      previousIntent: state.intent,
      aliases: loadTickerAliases(
        options.aliasesPath ?? process.env.TICKER_ALIASES_FILE?.trim() ?? 'data/ticker-aliases.yaml',
      ),
      knowledge,
      model,
      helpEnabled: options.helpEnabled,
      newsEnabled: options.newsEnabled,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
    });

    if (route.source === 'fallback') {
      logger.warn('Классификатор недоступен: вопрос обработан как data_lookup');
    }

    return {
      intent: route.intent,
      scope: route.scope,
      scopeTarget: route.scopeTarget,
      scopeLabel: route.scopeLabel,
      ...(route.dataNeed ? { dataNeed: route.dataNeed } : { dataNeed: null }),
      routeSource: route.source,
      followUp: route.followUp === true,
      // Ответ guardrail кладём сообщением: отдельный канал состояния не нужен.
      ...(route.guard ? { messages: [new AIMessage(route.guard.answer)] } : {}),
      // Новый вопрос — новое согласие: в рамках одного прогона подтверждение одно.
      dataApproved: false,
      // Новый вопрос начинает прогон с чистого листа: иначе ответ возьмётся
      // из прошлого отчёта (`lastResult`), а данные сбора — из прежнего плана.
      lastResult: null,
      collection: null,
      readingPlan: [],
      reportId: null,
      reportTemplateVersion: null,
      reportType: null,
      partial: false,
      dataAsOf: null,
    };
  };
};


