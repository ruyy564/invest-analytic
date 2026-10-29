import type { BaseMessage } from '@langchain/core/messages';
// Схемы для провайдеров (в т.ч. GigaChat) конвертируются через zod-to-json-schema,
// который понимает только zod 3, поэтому structured output объявляется в `zod/v3`.
import { z } from 'zod/v3';

export const INTENT_SCHEMA = z.object({
  intent: z.enum(['portfolio', 'off_topic']),
});

export type Intent = z.infer<typeof INTENT_SCHEMA>;

export const CLASSIFIER_SYSTEM_PROMPT = [
  'Ты классифицируешь вопросы пользователя инвестиционного ассистента.',
  'portfolio — вопрос о собственном портфеле: состав, позиции, стоимость, сколько чего куплено,',
  'прибыль по портфелю, «что у меня есть».',
  'off_topic — всё остальное: погода, новости, налоги, прогнозы цены, макроэкономика,',
  'теоретические вопросы, просьбы совершить сделку.',
  'Если вопрос неоднозначен, но речь о своём портфеле — выбирай portfolio.',
].join(' ');

export const CLASSIFIER_FALLBACK_PROMPT =
  'Ответь ровно одним словом: portfolio или off_topic. Без пояснений.';

/** Разбор метки из текстового ответа модели (фолбэк без structured output). */
export const parseIntentText = (text: string): Intent | null => {
  const normalized = text.toLowerCase();
  if (/portfolio/.test(normalized)) {
    return { intent: 'portfolio' };
  }
  if (/off[_\s-]?topic/.test(normalized)) {
    return { intent: 'off_topic' };
  }
  return null;
};

export const buildClassifierMessages = (messages: BaseMessage[]): BaseMessage[] => messages;
