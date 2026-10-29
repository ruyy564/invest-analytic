import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/** Роль модели: дорогая для ответов, дешёвая для классификации. */
export type LlmRole = 'answer' | 'router';

/**
 * Провайдер LLM: единственное место, где создаётся конкретная модель.
 * Узлы графа получают `BaseChatModel` через DI и не знают про библиотеку.
 * `id` — строка, чтобы в тестах можно было подключать собственные провайдеры.
 */
export interface LlmProvider {
  readonly id: string;
  createChatModel(role: LlmRole): BaseChatModel;
}

