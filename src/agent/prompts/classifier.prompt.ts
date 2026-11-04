import type { BaseMessage } from '@langchain/core/messages';
// Схемы для провайдеров (в т.ч. GigaChat) конвертируются через zod-to-json-schema,
// который понимает только zod 3, поэтому structured output объявляется в `zod/v3`.
import { z } from 'zod/v3';

export const INTENT_SCHEMA = z.object({
  intent: z.enum([
    'data_lookup',
    'security_analysis',
    'portfolio_review',
    'market_news',
    'agent_help',
    'off_topic',
  ]),
});

export type Intent = z.infer<typeof INTENT_SCHEMA>;

export const CLASSIFIER_SYSTEM_PROMPT = [
  'Ты классифицируешь вопросы пользователя инвестиционного ассистента.',
  'data_lookup — точечный вопрос по данным: состав портфеля, цена бумаги, дивиденды,',
  'фундаментальные показатели, новости по бумаге, «сколько у меня акций».',
  'security_analysis — разбор одной бумаги или сравнение бумаг: «стоит ли покупать X»,',
  '«почему упал Полюс», «сравни Сбер и ВТБ».',
  'portfolio_review — просьба разобрать весь портфель: диверсификация, концентрация,',
  'чего не хватает, что делать с портфелем, а также вопросы про экономический цикл,',
  'секторы, налоговые изменения и мнения других инвесторов в контексте портфеля.',
  'market_news — просьба показать последние новости инвестиционного рынка за период',
  '(сегодня, неделя, месяц, полгода) без привязки к портфелю и без конкретной бумаги:',
  '«какие последние новости в мире инвестиций», «что нового на рынке за неделю».',
  'agent_help — вопрос о возможностях самого сервиса: «что ты умеешь», «чем можешь помочь»,',
  '«что здесь можно узнать».',
  'off_topic — только посторонние темы: погода, политика, медицина, развлечения,',
  'личные советы не про инвестиции, просьбы совершить сделку.',
  'Если сомневаешься и в вопросе есть бумага, тикер, цена, портфель или инвестиции —',
  'выбирай data_lookup или security_analysis, но не off_topic.',
].join(' ');

export const CLASSIFIER_FALLBACK_PROMPT =
  'Ответь ровно одним словом: data_lookup, security_analysis, portfolio_review, market_news, agent_help или off_topic. Без пояснений.';

/** Разбор метки из текстового ответа модели (фолбэк без structured output). */
export const parseIntentText = (text: string): Intent | null => {
  const normalized = text.toLowerCase().replace(/[\s-]+/g, '_');
  if (/agent_help|что_умеет|возможност/.test(normalized)) {
    return { intent: 'agent_help' };
  }
  if (/portfolio_review|разбор_портфел|анализ_портфел/.test(normalized)) {
    return { intent: 'portfolio_review' };
  }
  if (/market_news|новост/.test(normalized)) {
    return { intent: 'market_news' };
  }
  if (/security_analysis|разбор_бумаг|анализ_бумаг/.test(normalized)) {
    return { intent: 'security_analysis' };
  }
  if (/data_lookup|точечн/.test(normalized) || /^\s*portfolio\b/.test(normalized)) {
    return { intent: 'data_lookup' };
  }
  if (/off_topic/.test(normalized)) {
    return { intent: 'off_topic' };
  }
  return null;
};

/**
 * Явные маркеры сценария: такие вопросы не отдаём на откуп модели.
 * Провайдеры (GigaChat в их числе) иногда относят «проанализируй мой портфель»
 * к посторонним темам — детерминированное правило надёжнее.
 */
export const REVIEW_PATTERN =
  /проанализируй|проанализировать|разбери|разбор\s+портфел|диверсификац|ребаланс|что\s+(?:мне\s+)?делать\s+с\s+портфел|оцени\s+(?:мой\s+)?портфел|насколько\s+(?:он\s+)?диверсифицирован|каких\s+бумаг\s+не\s+хватает/i;

/** Посторонние темы, на которых модель ошибается реже, чем правило. */
export const OFF_TOPIC_PATTERN =
  /погод|гороскоп|анекдот|рецепт|футбол|медицин|симптом|политик[аиу]\b|выборы\s+в\s+сша/i;

/** Вопрос про новости рынка без привязки к бумаге и портфелю. */
export const NEWS_PATTERN =
  /новост|что\s+нового\s+на\s+рынке|что\s+происходит\s+на\s+рынке|информационн\w*\s+фон|повестк\w*\s+рынка/i;

/** Вопрос задевает портфель — тогда новостная ветка не применяется. */
export const PORTFOLIO_PATTERN =
  /портфел|диверсификац|ребаланс|мои\s+бумаг|мой\s+счёт|мой\s+счет|что\s+делать\s+с/i;

/** Метка по явным маркерам вопроса; `null` — решает модель. */
export const heuristicIntent = (text: string): Intent | null => {
  if (REVIEW_PATTERN.test(text)) {
    return { intent: 'portfolio_review' };
  }
  if (OFF_TOPIC_PATTERN.test(text)) {
    return { intent: 'off_topic' };
  }
  return null;
};

/**
 * Новостной вопрос: явные маркеры новостей без тикера, компании и портфеля.
 * «Новости по SBER» сюда не попадает — это точечный вопрос по бумаге.
 */
export const heuristicNewsIntent = (
  text: string,
  scope: 'portfolio' | 'account' | 'instrument' = 'portfolio',
): boolean => scope === 'portfolio' && NEWS_PATTERN.test(text) && !PORTFOLIO_PATTERN.test(text);

export const buildClassifierMessages = (messages: BaseMessage[]): BaseMessage[] => messages;
