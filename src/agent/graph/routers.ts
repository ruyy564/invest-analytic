import type { AIMessage } from '@langchain/core/messages';
import { END } from '@langchain/langgraph';
import type { ApprovalPolicyService } from '../approvals/approval-policy.service.js';
import type { AgentStateType } from './state.js';

export const afterClassify = (state: AgentStateType): 'offTopic' | 'agent' =>
  state.intent === 'off_topic' ? 'offTopic' : 'agent';

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
