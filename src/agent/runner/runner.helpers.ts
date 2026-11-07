import type { ApprovePayload } from '../approval-flow.service.js';
import type { AgentStateType } from '../graph/state.js';

/** Прерывание графа (подтверждение) превращаем в payload для API. */
export const extractInterrupt = (result: unknown): ApprovePayload | undefined => {
  const interrupts = (result as { __interrupt__?: { value?: unknown }[] }).__interrupt__;
  const value = interrupts?.[0]?.value;
  return value ? (value as ApprovePayload) : undefined;
};

/**
 * Последний содержательный ответ модели: только он попадает в `answer`.
 *
 * Поиск идёт в пределах текущего прогона — от последнего вопроса пользователя.
 * Иначе пустой ответ нового прогона превращался бы в текст прошлого вопроса:
 * снаружи это выглядело как «ассистент ответил тем же, что и раньше».
 */
export const lastAnswer = (
  messages: AgentStateType['messages'] | undefined,
): string | undefined => {
  const list = messages ?? [];
  let start = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if ((list[index] as { _getType?: () => string })._getType?.() === 'human') {
      start = index;
      break;
    }
  }

  for (let index = list.length - 1; index >= start; index -= 1) {
    const message = list[index];
    const type = (message as { _getType?: () => string })._getType?.();
    if (type === 'ai' && typeof message.content === 'string' && message.content.trim() !== '') {
      return message.content;
    }
  }
  return undefined;
};

/**
 * Ошибка провайдера в виде текста.
 *
 * GigaChat кладёт детали в `response.data`, а `message` делает объектом — в логе
 * это выглядело как `ResponseError: [object Object]`, и причину сбоя нельзя было
 * прочитать. Здесь собираем статус и тело ответа.
 */
export const describeError = (error: unknown): string => {
  const candidate = error as {
    message?: unknown;
    response?: { status?: number; data?: unknown };
  };
  const data = candidate?.response?.data;
  const details =
    data === undefined ? '' : ` ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  const status = candidate?.response?.status;
  const raw = candidate?.message;
  const message =
    typeof raw === 'string' && raw !== '[object Object]'
      ? raw
      : typeof error === 'string'
        ? error
        : 'ошибка провайдера';
  return `${message}${status === undefined ? '' : ` [${status}]`}${details}`.trim();
};
