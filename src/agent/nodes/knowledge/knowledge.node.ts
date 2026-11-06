import { AIMessage } from '@langchain/core/messages';
import type { KnowledgeProvider } from '../../../capabilities/knowledge/index.js';
import type { AgentStateType } from '../../graph/state.js';

export interface KnowledgeDeps {
  knowledge: KnowledgeProvider;
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
 * Узел справочного ответа: объясняет инвестиционное понятие. Логика отбора и
 * формата живёт в `KnowledgeService`; узел только спрашивает его и кладёт ответ.
 */
export const createKnowledgeNode =
  (deps: KnowledgeDeps) =>
  async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const question = lastQuestion(state);
    const answer = deps.knowledge.answerFor(question) ?? deps.knowledge.miss();

    return {
      intent: 'knowledge_question',
      messages: [new AIMessage(answer)],
      partial: false,
      dataAsOf: new Date().toISOString(),
    };
  };
