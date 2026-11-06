import { OFF_TOPIC_ANSWER } from '../nodes/off-topic/prompt.js';

/** Почему вопрос заблокирован до обращения к модели. */
export type GuardReason = 'empty' | 'trading' | 'off_topic';

export type GuardDecision =
  | { blocked: false }
  | { blocked: true; reason: GuardReason; answer: string };

/** Просьбы о сделках: сервис торговых операций не выполняет. */
const TRADING =
  /(купи|куплю|купить|продай|продам|продать|выстав(ь|ить)\s+заявк|заявк[ау]\s+на\s+(покупку|продажу)|отмени\s+заявк|переведи\s+средства|выведи\s+средства|пополни\s+сч[её]т)/i;

/** Посторонние темы: на них модель ошибается чаще, чем правило. */
const OFF_TOPIC =
  /погод|гороскоп|анекдот|рецепт|футбол|хокке|теннис|олимпи|медицин|симптом|политик[аиу]\b|выборы\s+в\s+сша|кто\s+(стал|победил)|рецепт\s+бора|диета/i;

export const TRADING_ANSWER = [
  'Торговые операции я не выполняю: не покупаю, не продаю и не выставляю заявки.',
  'Могу разобрать бумагу или портфель и показать данные, на которые опирается решение.',
].join(' ');

export const EMPTY_ANSWER = 'Задайте вопрос: например, «разбери портфель» или «стоит ли покупать Сбер».';

/**
 * Guardrail до модели: пустой вопрос, просьба о сделке и посторонняя тема
 * отсекаются детерминированно — модель не должна решать, отвечать ли на них.
 */
export const guardQuestion = (question: string): GuardDecision => {
  const text = question.trim();
  if (text.length === 0) {
    return { blocked: true, reason: 'empty', answer: EMPTY_ANSWER };
  }
  if (TRADING.test(text)) {
    return { blocked: true, reason: 'trading', answer: TRADING_ANSWER };
  }
  if (OFF_TOPIC.test(text)) {
    return { blocked: true, reason: 'off_topic', answer: OFF_TOPIC_ANSWER };
  }
  return { blocked: false };
};
