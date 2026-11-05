import type { ApprovePayload } from '../approval-flow.service.js';
import type { AgentStateType } from '../graph/state.js';

/** Прерывание графа (подтверждение) превращаем в payload для API. */
export const extractInterrupt = (result: unknown): ApprovePayload | undefined => {
  const interrupts = (result as { __interrupt__?: { value?: unknown }[] }).__interrupt__;
  const value = interrupts?.[0]?.value;
  return value ? (value as ApprovePayload) : undefined;
};

/** Ответ помечается частичным, если инструмент упёрся в бюджет прогона. */
export const hasBudgetError = (messages: AgentStateType['messages'] | undefined): boolean =>
  (messages ?? []).some(
    (message) =>
      (message as { _getType?: () => string })._getType?.() === 'tool' &&
      typeof message.content === 'string' &&
      /run_budget_exceeded|Лимит вызовов|Лимит времени/.test(message.content),
  );

/** Последний содержательный ответ модели: только он попадает в `answer`. */
export const lastAnswer = (
  messages: AgentStateType['messages'] | undefined,
): string | undefined => {
  const list = messages ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    const type = (message as { _getType?: () => string })._getType?.();
    if (type === 'ai' && typeof message.content === 'string' && message.content.trim() !== '') {
      return message.content;
    }
  }
  return undefined;
};
