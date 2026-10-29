import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { Command, interrupt, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type {
  ApprovalFlowService,
  ApproveDecision,
  ApprovePayload,
} from '../approval-flow.service.js';
import type { ApprovalPolicyService } from '../approvals/approval-policy.service.js';
import type { AgentStateType } from '../graph/state.js';

export interface ApproveNodeDeps {
  policy: ApprovalPolicyService;
  flow: ApprovalFlowService;
  accountId?: string;
}

const DECLINE_TEXT =
  'Пользователь отклонил чтение данных: данные не запрашивались. ' +
  'Сообщи об этом и предложи переформулировать вопрос.';

/**
 * Узел подтверждения: пауза через `interrupt`. При подтверждении управление
 * уходит в `tools`, при отказе — обратно в `agent` с `ToolMessage` на каждый вызов
 * (иначе модель ждёт ответ на `tool_call` и граф зависает).
 */
export const createApproveNode =
  (deps: ApproveNodeDeps) => async (state: AgentStateType, config?: LangGraphRunnableConfig) => {
    const last = state.messages.at(-1) as AIMessage | undefined;
    const calls = last?.tool_calls ?? [];
    const threadId = String(config?.configurable?.thread_id ?? '');

    const items = calls
      .filter((call) => deps.policy.requiresApproval(call.name))
      .map((call) => ({
        rule: deps.policy.ruleFor(call.name) ?? {
          tool: call.name,
          label: call.name,
          question: 'Подтвердить чтение данных?',
          requiresApproval: true,
        },
        args: (call.args ?? {}) as Record<string, unknown>,
      }));

    deps.flow.markRequested(threadId);
    const decision = interrupt<ApprovePayload, ApproveDecision>(
      deps.flow.buildPayload(items, deps.accountId),
    );
    deps.flow.clear(threadId);

    if (decision.approved) {
      return new Command({ goto: 'tools' });
    }

    return new Command({
      goto: 'agent',
      update: {
        messages: calls.map(
          (call) => new ToolMessage({ tool_call_id: call.id ?? '', content: DECLINE_TEXT }),
        ),
      },
    });
  };
