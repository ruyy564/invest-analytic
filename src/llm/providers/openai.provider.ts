import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import type { AppConfig } from '../../config/configuration.js';
import type { LlmProvider, LlmRole } from '../llm-provider.interface.js';

export interface OpenAiParams {
  model: string;
  apiKey: string;
  temperature: number;
  timeout: number;
  maxRetries: number;
  configuration?: { baseURL: string };
}

/**
 * Параметры клиента OpenAI. `baseURL` добавляется только когда он задан,
 * поэтому один и тот же билдер обслуживает `openai` и `openai-compatible`.
 */
export const buildOpenAiParams = (llm: AppConfig['llm'], role: LlmRole): OpenAiParams => ({
  model: role === 'answer' ? llm.model : llm.routerModel,
  apiKey: llm.apiKey ?? '',
  temperature: llm.temperature,
  timeout: 30_000,
  maxRetries: 1,
  ...(llm.baseUrl ? { configuration: { baseURL: llm.baseUrl } } : {}),
});

export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai' as const;

  constructor(private readonly llm: AppConfig['llm']) {}

  createChatModel(role: LlmRole): BaseChatModel {
    return new ChatOpenAI(buildOpenAiParams(this.llm, role));
  }
}
