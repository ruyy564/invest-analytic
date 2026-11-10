import { AIMessage } from '@langchain/core/messages';
import type { AgentStateType } from '../../graph/state.js';
import { OFF_TOPIC_ANSWER } from '../off-topic/prompt.js';

/**
 * Детерминированный отказ: без вызова модели и без инструментов. Если guard уже
 * подготовил точный ответ (пустой вопрос, просьба о сделке), он пришёл сообщением
 * из `classify` — второй ответ не нужен.
 */
export const offTopicNode = async (state: AgentStateType) => {
  const last = state.messages.at(-1) as { _getType?: () => string } | undefined;
  if (last?._getType?.() === 'ai') {
    return {};
  }
  return { messages: [new AIMessage(OFF_TOPIC_ANSWER)] };
};
