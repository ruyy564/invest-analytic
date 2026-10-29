import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { bindToolsCompat } from '../../llm/bind-tools.js';
import { buildAgentSystemPrompt } from '../prompts/agent.prompt.js';
import type { AgentStateType } from '../graph/state.js';

interface BoundModel {
  invoke(input: (SystemMessage | AgentStateType['messages'][number])[]): Promise<AIMessage>;
}

/** Узел агента: модель с инструментами, роль и запрет торговли — в системном промпте. */
export const createAgentNode =
  (
    model: BaseChatModel,
    tools: StructuredToolInterface[],
    options: { accountId?: string } = {},
  ) =>
  async (state: AgentStateType) => {
    const bound = bindToolsCompat(model, tools) as unknown as BoundModel;
    const response = await bound.invoke([
      new SystemMessage(buildAgentSystemPrompt(options)),
      ...state.messages,
    ]);
    return { messages: [response] };
  };
