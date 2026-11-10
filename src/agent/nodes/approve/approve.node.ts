import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { Command, END, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type { ApprovalFlowService } from '../../approval-flow.service.js';
import type { ApprovalPolicyService } from '../../approvals/approval-policy.service.js';
import type { AgentStateType } from '../../graph/state.js';

export interface ApproveNodeDeps {
  policy: ApprovalPolicyService;
  flow: ApprovalFlowService;
  accountId?: string;
}

const DECLINE_TEXT =
  'Пользователь НЕ подтвердил чтение данных: данные не запрашивались. ' +
  'Скажи, что без подтверждения показать данные нельзя, и предложи подтвердить запрос. ' +
  'Не утверждай, что данных нет или что брокер недоступен.';

const DECLINE_REPORT_TEXT =
  'Отчёт не сформирован: вы не подтвердили чтение данных, поэтому брокер не запрашивался. ' +
  'Подтвердите запрос, чтобы получить разбор портфеля.';

/**
 * Решение приходит из конфига прогона: HTTP-API передаёт `approve`/`reject`,
 * а Studio при пустом Resume не передаёт ничего — это согласие. Так кнопка
 * Resume работает без ввода значения: сервер LangGraph отклоняет пустой Command,
 * а статический breakpoint перед узлом — нет.
 */
export const isApprovedDecision = (decision: unknown): boolean => {
  if (typeof decision === 'boolean') {
    return decision;
  }
  if (typeof decision === 'string') {
    const text = decision.trim();
    if (text === '') {
      return true;
    }
    if (/^(true|да|yes|ок|ok|approve[ds]?)$/i.test(text)) {
      return true;
    }
    if (/^(false|нет|no|decline[ds]?|reject(ed)?)$/i.test(text)) {
      return false;
    }
    try {
      return isApprovedDecision(JSON.parse(text) as unknown);
    } catch {
      return false;
    }
  }
  if (Array.isArray(decision)) {
    return decision.some(isApprovedDecision);
  }
  if (decision && typeof decision === 'object') {
    const record = decision as Record<string, unknown>;
    const value = record.approved ?? record.approve ?? record.decision ?? record.value;
    if (value !== undefined) {
      return isApprovedDecision(value);
    }
    // Пустой объект из Studio — тоже нажатый Resume; `{1: true}` Studio шлёт иначе.
    if (Object.keys(record).length === 0) {
      return true;
    }
    return Object.values(record).some(isApprovedDecision);
  }
  // Studio без значения в поле Resume (`null`/`undefined`) — подтверждение.
  return decision === null || decision === undefined;
};

/**
 * Узел подтверждения: пауза через `interrupt`. При подтверждении управление
 * уходит в `tools`, при отказе — обратно в `agent` с `ToolMessage` на каждый вызов
 * (иначе модель ждёт ответ на `tool_call` и граф зависает).
 */
export const createApproveNode =
  (deps: ApproveNodeDeps) => async (state: AgentStateType, config?: LangGraphRunnableConfig) => {
    // Зависимости сохранены в типе: payload для HTTP собирает прогон, а не узел.
    void deps;
    const last = state.messages.at(-1) as AIMessage | undefined;
    const calls = last?.tool_calls ?? [];
    const plan = state.readingPlan ?? [];
    // Решение приходит конфигом: Studio при пустом Resume ничего не присылает —
    // это согласие; HTTP присылает 'approve' или 'reject'.
    const approved = isApprovedDecision(config?.configurable?.approvalDecision);

    // Ветка разбора: подтверждается весь план чтений одним запросом.
    if (plan.length > 0) {
      if (approved) {
        // Согласие действует до конца прогона: сбор не спросит заново.
        return new Command({ goto: 'collect', update: { dataApproved: true } });
      }
      return new Command({
        goto: END,
        update: { messages: [new AIMessage(DECLINE_REPORT_TEXT)], partial: false },
      });
    }

    if (approved) {
      // Согласие действует до конца прогона: следующие вызовы идут без паузы.
      return new Command({ goto: 'tools', update: { dataApproved: true } });
    }

    return new Command({
      goto: 'agent',
      update: {
        messages: calls.map(
          (call) =>
            new ToolMessage({
              tool_call_id: call.id ?? '',
              content: DECLINE_TEXT,
              // Структурный признак: ответ-отказ не считается отчётом инструмента.
              additional_kwargs: { kind: 'denied' },
            }),
        ),
      },
    });
  };
