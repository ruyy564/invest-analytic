import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { withTimeout } from '../../transports/mcp/mcp-tool.adapter.js';
import { loadTickerAliases } from '../../capabilities/news/news.aliases.js';
import { detectScope } from '../scope.js';
import { CAPABILITIES_PATTERN } from '../nodes/help/capabilities.js';
import {
  KNOWLEDGE_QUESTION_PATTERN,
  type KnowledgeProvider,
} from '../../capabilities/knowledge/index.js';
import {
  CLASSIFIER_FALLBACK_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT,
  heuristicIntent,
  heuristicNewsIntent,
  isEconomyQuestion,
  isMoneyQuestion,
  isSecurityQuestion,
  parseIntentText,
} from '../nodes/classify/prompt.js';
import { PORTFOLIO_SCOPE_PROMPT } from '../nodes/off-topic/prompt.js';
import type { AgentStateType } from '../graph/state.js';
import { guardQuestion, type GuardDecision } from './guard.js';
import { needsPortfolioData } from './rules.js';

/** Время ожидания классификатора: одно слово, дольше ждать бессмысленно. */
export const ROUTE_TIMEOUT_MS = 8_000;

/** Откуда взят сценарий: правило, модель, безопасный вариант или guard. */
export type RouteSource = 'rule' | 'model' | 'fallback' | 'guard';

export interface RouteDecision {
  intent: AgentStateType['intent'];
  scope: AgentStateType['scope'];
  scopeTarget?: string;
  scopeLabel?: string;
  /** Для вопроса нужны данные состава портфеля (решает правило, не модель). */
  dataNeed?: 'portfolio';
  /** Уточняющий вопрос: тема и область взяты у предыдущего вопроса. */
  followUp?: boolean;
  source: RouteSource;
  /** Заполнено, если вопрос заблокирован до модели. */
  guard?: GuardDecision & { blocked: true };
}

export interface RouteOptions {
  question: string;
  /** Предыдущий вопрос диалога: по нему находится бумага, названная местоимением. */
  previousQuestion?: string;
  /** Сценарий предыдущего вопроса: уточнение наследует тему. */
  previousIntent?: AgentStateType['intent'];
  aliases?: Record<string, string[]>;
  knowledge?: KnowledgeProvider;
  model?: BaseChatModel;
  helpEnabled?: boolean;
  newsEnabled?: boolean;
  timeoutMs?: number;
}

/** Ссылка на бумагу местоимением: «стоит ли её покупать» после вопроса о Сбере. */
const ANAPHORA_PATTERN =
  /(?:^|[^а-яё])(?:её|ее|его|им|ней|неё|нему|этой|эту|эти|этих|данной|данную|такую|такой)(?![а-яё])/i;

/**
 * Уточняющий вопрос: «расскажи детальней», «подробнее», «а почему», «что ещё».
 * Своей темы у него нет — она берётся из предыдущего вопроса.
 */
const FOLLOW_UP_PATTERN =
  /(?:^|[^а-яё])(?:расскажи|расскажите|поясни|поясните|уточни|уточните|подробн|детальн|разверни|раскрой|что\s+ещ[её]|а\s+почему|и\s+почему|а\s+как|и\s+как)(?![а-яё])/i;

/** Вопрос — уточнение к предыдущему ответу, а не новая тема. */
export const isFollowUpQuestion = (question: string): boolean => FOLLOW_UP_PATTERN.test(question);

/**
 * Область вопроса с учётом диалога: если бумага названа в предыдущем вопросе,
 * а текущий ссылается на неё местоимением, разбор идёт по этой бумаге.
 * Без предыдущего вопроса область остаётся портфельной: угадывать тикер нельзя.
 */
const scopeOf = (
  question: string,
  aliases: Record<string, string[]>,
  previousQuestion?: string,
) => {
  const scoped = detectScope(question, aliases);
  if (scoped.scope !== 'portfolio' || !previousQuestion || !ANAPHORA_PATTERN.test(question)) {
    return { scope: scoped.scope, scopeTarget: scoped.target, scopeLabel: scoped.label };
  }
  const previous = detectScope(previousQuestion, aliases);
  return previous.scope === 'instrument'
    ? { scope: previous.scope, scopeTarget: previous.target, scopeLabel: previous.label }
    : { scope: scoped.scope, scopeTarget: scoped.target, scopeLabel: scoped.label };
};

/**
 * Маршрутизация вопроса: guard → правила → модель → безопасный вариант.
 * Возвращает не только сценарий, но и источник решения — это попадает в лог и
 * журнал прогона (`routeSource`), поэтому «почему так ответили» видно без отладки.
 */
export const routeQuestion = async (options: RouteOptions): Promise<RouteDecision> => {
  const { question } = options;
  const aliases = options.aliases ?? loadTickerAliases('data/ticker-aliases.yaml');
  const scoped = scopeOf(question, aliases, options.previousQuestion);

  // Правило: некоторым вопросам данные портфеля нужны без решения модели.
  const dataNeedFields = needsPortfolioData(question) ? { dataNeed: 'portfolio' as const } : {};

  /**
   * Единый выход маршрутизатора: «вне компетенции» не ставим, если в вопросе
   * названа бумага (классификатор ошибается на коротких вопросах вроде «что с
   * самолётом»), спрашивают про бумагу или эмитента (даже незнакомого — тикер
   * найдёт инструмент) или про личные деньги (квартира, ипотека, вклад, гараж):
   * это работа эксперта, а не отказ.
   */
  const decide = (
    intent: RouteDecision['intent'],
    source: RouteSource,
    extra: { guard?: RouteDecision['guard']; followUp?: boolean } = {},
  ): RouteDecision => {
    const named = scoped.scope === 'instrument';
    const money = isMoneyQuestion(question);
    const security = isSecurityQuestion(question);
    const economy = isEconomyQuestion(question);
    const resolved =
      intent === 'off_topic'
        ? named || security
          ? 'security_analysis'
          : money || economy
            ? 'data_lookup'
            : intent
        : intent;
    return {
      intent: resolved,
      ...scoped,
      ...dataNeedFields,
      ...(extra.followUp ? { followUp: true } : {}),
      source,
      ...(extra.guard ? { guard: extra.guard } : {}),
    };
  };

  // Уточнение без своей темы: «расскажи детальней», «подробнее», «а почему».
  // Тему и область берём у предыдущего вопроса — иначе такой вопрос уходит в отказ.
  if (
    isFollowUpQuestion(question) &&
    scoped.scope === 'portfolio' &&
    !scoped.scopeTarget &&
    options.previousQuestion
  ) {
    const previous = scopeOf(options.previousQuestion, aliases);
    const inherited =
      options.previousIntent && options.previousIntent !== 'off_topic'
        ? options.previousIntent
        : previous.scope === 'instrument'
          ? 'security_analysis'
          : 'portfolio_review';
    return {
      intent: inherited,
      scope: previous.scope,
      scopeTarget: previous.scopeTarget,
      scopeLabel: previous.scopeLabel,
      ...dataNeedFields,
      followUp: true,
      source: 'rule',
    };
  }

  const guard = guardQuestion(question);
  if (guard.blocked) {
    return { intent: 'off_topic', ...scoped, ...dataNeedFields, source: 'guard', guard };
  }

  if ((options.helpEnabled ?? true) && CAPABILITIES_PATTERN.test(question)) {
    return decide('agent_help', 'rule');
  }

  if (
    options.knowledge &&
    !options.knowledge.isEmpty &&
    KNOWLEDGE_QUESTION_PATTERN.test(question) &&
    options.knowledge.topicFor(question)
  ) {
    return decide('knowledge_question', 'rule');
  }

  const heuristic = heuristicIntent(question, scoped.scope);
  if (heuristic) {
    return decide(heuristic.intent, 'rule');
  }

  const newsEnabled = options.newsEnabled ?? true;
  if (newsEnabled && heuristicNewsIntent(question, scoped.scope)) {
    return decide('market_news', 'rule');
  }

  if (!options.model) {
    return decide('data_lookup', 'fallback');
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
    return decide(normalized, 'model');
  } catch {
    // Недоступность классификатора не должна ломать прогон: безопасный вариант.
    return decide('data_lookup', 'fallback');
  }
};
