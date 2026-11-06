import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
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
    const lastHuman = [...state.messages]
      .reverse()
      .find(
        (message) =>
          (message as unknown as { _getType?: () => string })._getType?.() === 'human',
      );
    const question =
      typeof lastHuman?.content === 'string'
        ? lastHuman.content
        : JSON.stringify(lastHuman?.content ?? '');

    const route = await routeQuestion({
      question,
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
      ...(route.dataNeed ? { dataNeed: route.dataNeed } : {}),
      routeSource: route.source,
      ...(route.guard ? { guardAnswer: route.guard.answer } : {}),
      // Новый вопрос — новое согласие: в рамках одного прогона подтверждение одно.
      dataApproved: false,
    };
  };
};


