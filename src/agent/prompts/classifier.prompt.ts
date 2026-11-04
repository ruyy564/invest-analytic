import type { BaseMessage } from '@langchain/core/messages';
// Схемы для провайдеров (в т.ч. GigaChat) конвертируются через zod-to-json-schema,
// который понимает только zod 3, поэтому structured output объявляется в `zod/v3`.
import { z } from 'zod/v3';

export const INTENT_SCHEMA = z.object({
  intent: z.enum(['data_lookup', 'security_analysis', 'portfolio_review', 'off_topic']),
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
  'off_topic — только посторонние темы: погода, политика, медицина, развлечения,',
  'личные советы не про инвестиции, просьбы совершить сделку.',
  'Если сомневаешься и в вопросе есть бумага, тикер, цена, портфель или инвестиции —',
  'выбирай data_lookup или security_analysis, но не off_topic.',
].join(' ');

export const CLASSIFIER_FALLBACK_PROMPT =
  'Ответь ровно одним словом: data_lookup, security_analysis, portfolio_review или off_topic. Без пояснений.';

/** Разбор метки из текстового ответа модели (фолбэк без structured output). */
export const parseIntentText = (text: string): Intent | null => {
  const normalized = text.toLowerCase().replace(/[\s-]+/g, '_');
  if (/portfolio_review|разбор_портфел|анализ_портфел/.test(normalized)) {
    return { intent: 'portfolio_review' };
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

export const buildClassifierMessages = (messages: BaseMessage[]): BaseMessage[] => messages;
