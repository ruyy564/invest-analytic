import { AIMessage } from '@langchain/core/messages';
import type { AgentStateType } from '../../graph/state.js';
import { OFF_TOPIC_ANSWER } from '../off-topic/prompt.js';

/**
 * Детерминированный отказ: без вызова модели и без инструментов. Если guard уже
 * подготовил точный ответ (пустой вопрос, просьба о сделке), используется он.
 */
export const offTopicNode = async (state: AgentStateType) => ({
  messages: [new AIMessage(state.guardAnswer ?? OFF_TOPIC_ANSWER)],
});
