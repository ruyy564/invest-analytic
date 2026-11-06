import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { withTimeout } from '../../mcp/mcp-tool.adapter.js';
import { loadTickerAliases } from '../../news/news.aliases.js';
import { detectScope } from '../scope.js';
import { CAPABILITIES_PATTERN } from '../nodes/help/capabilities.js';
import {
  KNOWLEDGE_QUESTION_PATTERN,
  type KnowledgeProvider,
} from '../../knowledge/index.js';
import {
  CLASSIFIER_FALLBACK_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT,
  heuristicIntent,
  heuristicNewsIntent,
  parseIntentText,
} from '../nodes/classify/prompt.js';
import { PORTFOLIO_SCOPE_PROMPT } from '../nodes/off-topic/prompt.js';
import type { AgentStateType } from '../graph/state.js';
import { guardQuestion, type GuardDecision } from './guard.js';

/** Время ожидания классификатора: одно слово, дольше ждать бессмысленно. */
export const ROUTE_TIMEOUT_MS = 8_000;

/** Откуда взят сценарий: правило, модель, безопасный вариант или guard. */
export type RouteSource = 'rule' | 'model' | 'fallback' | 'guard';

export interface RouteDecision {
  intent: AgentStateType['intent'];
  scope: AgentStateType['scope'];
  scopeTarget?: string;
  scopeLabel?: string;
  source: RouteSource;
  /** Заполнено, если вопрос заблокирован до модели. */
  guard?: GuardDecision & { blocked: true };
}

export interface RouteOptions {
  question: string;
  aliases?: Record<string, string[]>;
  knowledge?: KnowledgeProvider;
  model?: BaseChatModel;
  helpEnabled?: boolean;
  newsEnabled?: boolean;
  timeoutMs?: number;
}

const scopeOf = (question: string, aliases: Record<string, string[]>) => {
  const scoped = detectScope(question, aliases);
  return {
    scope: scoped.scope,
    scopeTarget: scoped.target,
    scopeLabel: scoped.label,
  };
};

/**
 * Маршрутизация вопроса: guard → правила → модель → безопасный вариант.
 * Возвращает не только сценарий, но и источник решения — это попадает в лог и
 * журнал прогона (`routeSource`), поэтому «почему так ответили» видно без отладки.
 */
export const routeQuestion = async (options: RouteOptions): Promise<RouteDecision> => {
  const { question } = options;
  const aliases = options.aliases ?? loadTickerAliases('data/ticker-aliases.yaml');
  const scoped = scopeOf(question, aliases);

  const guard = guardQuestion(question);
  if (guard.blocked) {
    return { intent: 'off_topic', ...scoped, source: 'guard', guard };
  }

  if ((options.helpEnabled ?? true) && CAPABILITIES_PATTERN.test(question)) {
    return { intent: 'agent_help', ...scoped, source: 'rule' };
  }

  if (
    options.knowledge &&
    !options.knowledge.isEmpty &&
    KNOWLEDGE_QUESTION_PATTERN.test(question) &&
    options.knowledge.topicFor(question)
  ) {
    return { intent: 'knowledge_question', ...scoped, source: 'rule' };
  }

  const heuristic = heuristicIntent(question, scoped.scope);
  if (heuristic) {
    return { intent: heuristic.intent, ...scoped, source: 'rule' };
  }

  const newsEnabled = options.newsEnabled ?? true;
  if (newsEnabled && heuristicNewsIntent(question, scoped.scope)) {
    return { intent: 'market_news', ...scoped, source: 'rule' };
  }

  if (!options.model) {
    return { intent: 'data_lookup', ...scoped, source: 'fallback' };
  }

  try {
    const response = await withTimeout(
      options.model.invoke([
        new SystemMessage(
          `${PORTFOLIO_SCOPE_PROMPT}\n\n${CLASSIFIER_SYSTEM_PROMPT}\n\n${CLASSIFIER_FALLBACK_PROMPT}`,
        ),
        // История не нужна: маршрут определяется последним вопросом.
        new HumanMessage(question),
      ]),
      options.timeoutMs ?? ROUTE_TIMEOUT_MS,
      () => new Error('llm timeout'),
    );
    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const intent = parseIntentText(text)?.intent ?? 'data_lookup';
    const normalized =
      intent === 'market_news' && (!newsEnabled || scoped.scope !== 'portfolio')
        ? 'data_lookup'
        : intent;
    return { intent: normalized, ...scoped, source: 'model' };
  } catch {
    // Недоступность классификатора не должна ломать прогон: безопасный вариант.
    return { intent: 'data_lookup', ...scoped, source: 'fallback' };
  }
};
