import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { GigaChat } from 'langchain-gigachat';
import type { AppConfig } from '../../config/configuration.js';
import type { LlmProvider, LlmRole } from '../llm-provider.interface.js';

export interface GigachatParams {
  credentials: string;
  scope: string;
  authUrl: string;
  model: string;
}

/** Параметры GigaChat вынесены отдельно, чтобы их можно было проверить тестом. */
export const buildGigachatParams = (llm: AppConfig['llm'], role: LlmRole): GigachatParams => ({
  credentials: llm.gigachat.credentials ?? '',
  scope: llm.gigachat.scope,
  authUrl: llm.gigachat.authUrl,
  model: role === 'answer' ? llm.model : llm.routerModel,
});

export class GigachatProvider implements LlmProvider {
  readonly id = 'gigachat' as const;

  constructor(private readonly llm: AppConfig['llm']) {}

  createChatModel(role: LlmRole): BaseChatModel {
    return new GigaChat(buildGigachatParams(this.llm, role));
  }
}
