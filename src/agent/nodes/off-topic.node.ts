import { AIMessage } from '@langchain/core/messages';
import { OFF_TOPIC_ANSWER } from '../prompts/off-topic.js';

/** Детерминированный отказ: без вызова модели и без инструментов. */
export const offTopicNode = async () => ({
  messages: [new AIMessage(OFF_TOPIC_ANSWER)],
});
