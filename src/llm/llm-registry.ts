import { Injectable } from '@nestjs/common';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AppConfigService } from '../config/app-config.service.js';
import { ConfigError } from '../config/config.error.js';
import { SUPPORTED_LLM_PROVIDERS } from '../config/env.schema.js';
import type { AppConfig } from '../config/configuration.js';
import type { LlmProvider, LlmRole } from './llm-provider.interface.js';
import { GigachatProvider } from './providers/gigachat.provider.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider.js';
import { OpenAiProvider } from './providers/openai.provider.js';

/** Реестр провайдеров: добавление нового = новый класс + строка в этой карте. */
export const createProviderMap = (
  llm: AppConfig['llm'],
  extraProviders: LlmProvider[] = [],
): Map<string, LlmProvider> => {
  const builtIn: LlmProvider[] = [
    new GigachatProvider(llm),
    new OpenAiProvider(llm),
    new OpenAiCompatibleProvider(llm),
  ];
  return new Map([...builtIn, ...extraProviders].map((provider) => [provider.id, provider]));
};

@Injectable()
export class LlmRegistry {
  private readonly providers: Map<string, LlmProvider>;

  constructor(private readonly config: AppConfigService) {
    this.providers = createProviderMap(this.config.value.llm);
  }

  get providerId(): string {
    return this.config.value.llm.provider;
  }

  get provider(): LlmProvider {
    const found = this.providers.get(this.providerId);
    if (!found) {
      throw new ConfigError([
        `LLM_PROVIDER: "${this.providerId}" не поддерживается ` +
          `(доступны: ${SUPPORTED_LLM_PROVIDERS.join(', ')})`,
      ]);
    }
    return found;
  }

  createChatModel(role: LlmRole): BaseChatModel {
    return this.provider.createChatModel(role);
  }
}
