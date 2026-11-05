import { AIMessage } from '@langchain/core/messages';
import { OFF_TOPIC_ANSWER } from './off-topic/prompt.js';

/** Детерминированный отказ: без вызова модели и без инструментов. */
export const offTopicNode = async () => ({
  messages: [new AIMessage(OFF_TOPIC_ANSWER)],
});
