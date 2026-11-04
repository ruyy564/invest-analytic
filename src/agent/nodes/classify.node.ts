import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Logger } from '@nestjs/common';
import { SystemMessage } from '@langchain/core/messages';
import { PORTFOLIO_SCOPE_PROMPT } from '../prompts/off-topic.js';
import type { AgentStateType } from '../graph/state.js';
import { withTimeout } from '../../tools/mcp-tool.adapter.js';
import { loadTickerAliases } from '../../sources/aliases.js';
import { detectScope } from '../scope.js';
import { CAPABILITIES_PATTERN } from '../prompts/capabilities.js';
import {
  KNOWLEDGE_QUESTION_PATTERN,
  knowledgeSources,
  loadKnowledgeBase,
  topicForQuestion,
} from '../../knowledge/knowledge.js';
import {
  CLASSIFIER_FALLBACK_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT,
  heuristicIntent,
  heuristicNewsIntent,
  parseIntentText,
} from '../prompts/classifier.prompt.js';

/** Предел ожидания классификатора: одно слово, дольше ждать бессмысленно. */
export const CLASSIFY_TIMEOUT_MS = 8_000;

/** Ветка справочных ответов включена (флаг `KNOWLEDGE_ENABLED`). */
const knowledgeEnabled = (): boolean =>
  process.env.KNOWLEDGE_ENABLED?.trim().toLowerCase() !== 'false';

/** Каталог тем: та же настройка, что у разбора и ответов. */
const knowledgeDir = (): string => process.env.KNOWLEDGE_DIR?.trim() || 'data/knowledge';

/** Дополнительный файл-тема, если задан. */
const knowledgeFile = (): string | undefined => process.env.KNOWLEDGE_FILE?.trim();

/**
 * Классификация области вопроса дешёвой моделью с текстовым фолбэком.
 *
 * Если провайдер не ответил вовсе (лимит, 5xx, сеть, битый поток), прогон не
 * падает: вопрос уходит по маршруту `portfolio`. Решение о данных всё равно
 * остаётся за подтверждением — модель без согласия данные не прочитает.
 */
/**
 * Классификация области вопроса дешёвой моделью.
 *
 * Вызов простой, без `withStructuredOutput`: у GigaChat структурный режим
 * (function calling + SSE) иногда не отвечает вовсе, и прогон висел минутами.
 * Метка разбирается из текста, при любой проблеме вопрос уходит как `portfolio`
 * — данные всё равно защищены подтверждением.
 */
export const createClassifyNode = (model: BaseChatModel) => {
  const logger = new Logger('ClassifyNode');

  return async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // Явные маркеры сценария решаем сами: модель иногда относит «проанализируй
    // мой портфель» к посторонним темам, а это ядро продукта.
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

    // Область разбора (портфель / счёт / бумага) определяем правилом: модель
    // путает «разбери Сбер» и «разбери портфель» куда чаще регулярки.
    const aliases = loadTickerAliases(
      process.env.TICKER_ALIASES_FILE?.trim() || 'data/ticker-aliases.yaml',
    );
    const scoped = detectScope(question, aliases);
    const scopeFields = {
      scope: scoped.scope,
      scopeTarget: scoped.target,
      scopeLabel: scoped.label,
    };

    // Справка о возможностях: решаем правилом ДО модели и раньше остальных меток —
    // иначе «что ты умеешь» уходит в отказ по теме.
    const helpEnabled = process.env.AGENT_HELP_ENABLED?.trim().toLowerCase() !== 'false';
    if (helpEnabled && CAPABILITIES_PATTERN.test(question)) {
      return { intent: 'agent_help', ...scopeFields };
    }

    // Справочный вопрос по понятию: термин базы знаний и просьба объяснить.
    // Проверяем до эвристик — «что такое диверсификация» иначе уходит в разбор портфеля.
    if (knowledgeEnabled()) {
      const base = loadKnowledgeBase(
        knowledgeSources({ knowledgeDir: knowledgeDir(), knowledgeFile: knowledgeFile() }),
      );
      if (KNOWLEDGE_QUESTION_PATTERN.test(question) && topicForQuestion(base, question)) {
        return { intent: 'knowledge_question', ...scopeFields };
      }
    }

    const heuristic = heuristicIntent(question);
    if (heuristic) {
      return { intent: heuristic.intent, ...scopeFields };
    }

    // Новости рынка без бумаги и портфеля — отдельная ветка: решаем правилом,
    // чтобы «какие новости за неделю» стабильно попадало в сводку.
    const newsEnabled = process.env.NEWS_FEED_ENABLED?.trim().toLowerCase() !== 'false';
    if (newsEnabled && heuristicNewsIntent(question, scoped.scope)) {
      return { intent: 'market_news', ...scopeFields };
    }

    try {
      const response = await withTimeout(
        model.invoke([
          new SystemMessage(
            `${PORTFOLIO_SCOPE_PROMPT}\n\n${CLASSIFIER_SYSTEM_PROMPT}\n\n${CLASSIFIER_FALLBACK_PROMPT}`,
          ),
          ...state.messages,
        ]),
        CLASSIFY_TIMEOUT_MS,
        () => new Error('llm timeout'),
      );
      const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      const intent = parseIntentText(text)?.intent ?? 'data_lookup';
      // Метка новостей применима только к вопросам без бумаги, счёта и портфеля.
      const normalized =
        intent === 'market_news' && (!newsEnabled || scoped.scope !== 'portfolio')
          ? 'data_lookup'
          : intent;
      return { intent: normalized, ...scopeFields };
    } catch (error) {
      logger.warn(
        `Классификатор недоступен (${(error as Error)?.message}): вопрос обработан как data_lookup`,
      );
      return { intent: 'data_lookup', ...scopeFields };
    }
  };
};

