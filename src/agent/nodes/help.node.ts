import { AIMessage } from '@langchain/core/messages';
import type { AppConfigService } from '../../config/app-config.service.js';
import { buildCapabilitiesAnswer } from './help/capabilities.js';
import type { AgentStateType } from '../graph/state.js';

export interface HelpDeps {
  config: AppConfigService;
}

/**
 * Узел справки: отвечает, что умеет сервис. Ни данных, ни модели, ни
 * подтверждения — текст собирается из карты возможностей.
 */
export const createHelpNode =
  (deps: HelpDeps) =>
  async (): Promise<Partial<AgentStateType>> => {
    const answer = buildCapabilitiesAnswer({
      reviewEnabled: deps.config.value.run.reviewEnabled,
      newsEnabled: deps.config.value.sources.newsFeed.enabled,
      knowledgeEnabled: deps.config.value.run.knowledgeEnabled,
    });
    return {
      intent: 'agent_help',
      messages: [new AIMessage(answer)],
      partial: false,
      dataAsOf: new Date().toISOString(),
    };
  };
