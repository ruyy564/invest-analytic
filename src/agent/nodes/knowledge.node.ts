import { AIMessage } from '@langchain/core/messages';
import type { AppConfigService } from '../../config/app-config.service.js';
import {
  formatKnowledgeAnswer,
  formatKnowledgeMiss,
  loadKnowledgeBase,
  topicForQuestion,
} from '../../knowledge/knowledge.js';
import type { AgentStateType } from '../graph/state.js';

export interface KnowledgeDeps {
  config: AppConfigService;
}

/** Последний вопрос пользователя: по нему ищем тему в базе. */
const lastQuestion = (state: AgentStateType): string => {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    const type = (message as unknown as { _getType?: () => string })._getType?.();
    if (type === 'human') {
      return typeof message.content === 'string' ? message.content : '';
    }
  }
  return '';
};

/**
 * Узел справочного ответа: объясняет инвестиционное понятие по базе знаний.
 * Данные брокера не читаются, модель не вызывается, подтверждение не нужно.
 */
export const createKnowledgeNode =
  (deps: KnowledgeDeps) =>
  async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const base = loadKnowledgeBase(deps.config.value.run.knowledgeFile);
    const topic = topicForQuestion(base, lastQuestion(state));
    const answer = topic ? formatKnowledgeAnswer(topic) : formatKnowledgeMiss(base);

    return {
      intent: 'knowledge_question',
      messages: [new AIMessage(answer)],
      partial: false,
      dataAsOf: new Date().toISOString(),
    };
  };
