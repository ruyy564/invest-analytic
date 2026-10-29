import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage } from '@langchain/core/messages';
import { invokeStructured } from '../../llm/structured-output.js';
import type { AgentStateType } from '../graph/state.js';
import {
  CLASSIFIER_FALLBACK_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT,
  INTENT_SCHEMA,
  parseIntentText,
  type Intent,
} from '../prompts/classifier.prompt.js';

/** Классификация области вопроса дешёвой моделью с текстовым фолбэком. */
export const createClassifyNode =
  (model: BaseChatModel) => async (state: AgentStateType) => {
    const intent = await invokeStructured<Intent & Record<string, unknown>>({
      model,
      schema: INTENT_SCHEMA,
      name: 'classify_intent',
      messages: [new SystemMessage(CLASSIFIER_SYSTEM_PROMPT), ...state.messages],
      fallback: { systemPrompt: CLASSIFIER_FALLBACK_PROMPT, parse: parseIntentText },
    });
    return { intent: intent.intent };
  };
