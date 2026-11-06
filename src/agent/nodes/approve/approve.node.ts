import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { Command, END, interrupt, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type {
  ApprovalFlowService,
  ApproveDecision,
  ApprovePayload,
} from '../../approval-flow.service.js';
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

/** Виды данных плана — их видит пользователь в запросе подтверждения. */
const groupLabels: Record<string, string> = {
  accounts: 'счета',
  portfolio: 'состав и стоимость портфеля',
  prices: 'текущие цены',
  candles: 'история цен',
  reference: 'справочники бумаг',
  analytics: 'прогнозы аналитиков',
  dividends: 'дивиденды',
  fundamentals: 'фундаментальные показатели',
  signals: 'сигналы и мнения',
  news: 'новости',
  marketnews: 'новости рынка',
  tax: 'налоги',
  macro: 'ключевая ставка',
  indices: 'индексы',
};

/**
 * Решение приходит из разных источников: HTTP-API (`{ approved: true }`),
 * поле Resume в LangSmith Studio (объект, строка JSON или пустое значение),
 * голый boolean.
 *
 * Пустое значение — это нажатая кнопка Resume: пользователь согласился, но
 * ничего не ввёл, а Studio отправляет `""`. Поэтому согласием считаются
 * `""`, `null`, `undefined` и `{}`, а отказом — только явные `false`, «нет»,
 * `no`, `decline`, `reject` и `{ approved: false }`.
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
    const last = state.messages.at(-1) as AIMessage | undefined;
    const calls = last?.tool_calls ?? [];
    const threadId = String(config?.configurable?.thread_id ?? '');
    const plan = state.readingPlan ?? [];

    // Ветка разбора: подтверждается весь план чтений одним запросом.
    if (plan.length > 0) {
      const groups = [...new Set(plan.map((entry) => entry.group))];
      const accounts = [...new Set(plan.map((entry) => entry.target).filter((id): id is string => Boolean(id)))];
      const rule = deps.policy.ruleFor('portfolio__review') ?? {
        tool: 'portfolio__review',
        label: 'Разбор портфеля',
        question: 'Прочитать данные для разбора портфеля?',
        requiresApproval: true,
      };

      deps.flow.markRequested(threadId);
      const scopeLabel = state.scopeLabel ?? 'портфеля';
      const approved = interrupt<ApprovePayload, ApproveDecision>({
        ...deps.flow.buildPayload(
          [
            {
              rule: {
                ...rule,
                question:
                  `Прочитать ${plan.length} видов данных для разбора ${scopeLabel}` +
                  ` (${groups.map((group) => groupLabels[group] ?? group).join(', ')})?`,
              },
              args: { requests: plan.length, groups, accounts },
            },
          ],
          deps.accountId,
        ),
      });
      deps.flow.clear(threadId);

      if (isApprovedDecision(approved)) {
        // Согласие действует до конца прогона: сбор не спросит заново.
        return new Command({ goto: 'collect', update: { dataApproved: true } });
      }
      return new Command({
        goto: END,
        update: { messages: [new AIMessage(DECLINE_REPORT_TEXT)], partial: false },
      });
    }

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

    if (isApprovedDecision(decision)) {
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
