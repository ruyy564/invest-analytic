import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import type { AppConfig } from '../../config/configuration.js';
import { buildOpenAiParams } from './openai.provider.js';
import type { LlmProvider, LlmRole } from '../llm-provider.interface.js';

/** OpenAI-совместимый шлюз: тот же клиент, но с обязательным `LLM_BASE_URL`. */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = 'openai-compatible' as const;

  constructor(private readonly llm: AppConfig['llm']) {}

  createChatModel(role: LlmRole): BaseChatModel {
    return new ChatOpenAI(buildOpenAiParams(this.llm, role));
  }
}
