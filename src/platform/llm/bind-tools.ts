import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { RunnableBinding } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

type GigachatToolFormatter = {
  formatStructuredToolToGigaChat(tools: StructuredToolInterface[]): unknown;
};

/**
 * GigaChat форматирует инструменты дважды (в `bindTools` и в `invocationParams`),
 * из-за чего вызов падает. Для него инструменты привязываются через `RunnableBinding`
 * с уже сконвертированными `functions`, для остальных провайдеров — обычный `bindTools`.
 */
export const bindToolsCompat = (model: BaseChatModel, tools: StructuredToolInterface[]): unknown => {
  const formatter = (model as Partial<GigachatToolFormatter>).formatStructuredToolToGigaChat;
  if (typeof formatter === 'function') {
    // Библиотека сужает тип kwargs до BaseLanguageModelCallOptions, поэтому приводим намеренно.
    return new RunnableBinding({
      bound: model,
      kwargs: { tools: formatter.call(model, tools) } as never,
      config: {},
    });
  }
  if (typeof model.bindTools !== 'function') {
    throw new Error(`Модель ${model._llmType()} не поддерживает привязку инструментов`);
  }
  return model.bindTools(tools);
};
