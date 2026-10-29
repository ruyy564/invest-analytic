import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, type BaseMessage } from '@langchain/core/messages';

/** Разбор структурированного ответа не удался ни первым, ни вторым способом. */
export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}

export interface StructuredFallback<T> {
  /** Инструкция, которая добавляется к диалогу во второй попытке. */
  systemPrompt: string;
  /** Разбор метки из текстового ответа; `null` — разобрать не удалось. */
  parse: (text: string) => T | null;
}

export interface InvokeStructuredParams<T extends Record<string, unknown>> {
  model: BaseChatModel;
  /** Схема для провайдера: zod 3 (`zod/v3`) или zod 4 — значение приводится внутри. */
  schema: unknown;
  /** Имя функции для провайдеров, поддерживающих вызов инструментов. */
  name: string;
  messages: BaseMessage[];
  fallback: StructuredFallback<T>;
}

const contentToText = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content);

/**
 * Структурированный вывод с текстовым фолбэком: часть провайдеров
 * не поддерживает вызов функций, тогда метка разбирается из обычного ответа.
 */
export const invokeStructured = async <T extends Record<string, unknown>>(
  params: InvokeStructuredParams<T>,
): Promise<T> => {
  try {
    const structured = params.model.withStructuredOutput(params.schema as never, {
      name: params.name,
    });
    return (await structured.invoke(params.messages)) as T;
  } catch {
    const response = await params.model.invoke([
      ...params.messages,
      new SystemMessage(params.fallback.systemPrompt),
    ]);
    const parsed = params.fallback.parse(contentToText(response.content));
    if (parsed === null) {
      throw new StructuredOutputError('Модель не вернула распознаваемую структуру ответа');
    }
    return parsed;
  }
};
