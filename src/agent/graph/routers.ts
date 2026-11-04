import type { AIMessage } from '@langchain/core/messages';
import { END } from '@langchain/langgraph';
import type { ApprovalPolicyService } from '../approvals/approval-policy.service.js';
import type { AgentStateType } from './state.js';

/**
 * Маршрут после классификации: посторонние темы — отказ, разбор портфеля — в
 * ветку планирования, остальные вопросы — в узел ответа с инструментами.
 * При `reviewEnabled=false` метки остаются прежними и ветки `plan` нет.
 */
export const afterClassify =
  (reviewEnabled = true, newsEnabled = true, helpEnabled = true, knowledgeEnabled = true) =>
  (
    state: AgentStateType,
  ): 'offTopic' | 'agent' | 'plan' | 'news' | 'help' | 'knowledge' => {
    if (state.intent === 'off_topic') {
      return 'offTopic';
    }
    if (helpEnabled && state.intent === 'agent_help') {
      return 'help';
    }
    if (knowledgeEnabled && state.intent === 'knowledge_question') {
      return 'knowledge';
    }
    if (newsEnabled && state.intent === 'market_news') {
      return 'news';
    }
    return reviewEnabled && state.intent === 'portfolio_review' ? 'plan' : 'agent';
  };

/**
 * Маршрут после модели: `approve` — если хотя бы один вызов требует подтверждения
 * (решение принимает `ApprovalPolicyService`, а не код роутера).
 */
export const createAfterAgent =
  (policy: ApprovalPolicyService) =>
  (state: AgentStateType): 'approve' | 'tools' | typeof END => {
    const last = state.messages.at(-1) as AIMessage | undefined;
    const calls = last?.tool_calls ?? [];
    if (calls.length === 0) {
      return END;
    }
    return calls.some((call) => policy.requiresApproval(call.name)) ? 'approve' : 'tools';
  };

