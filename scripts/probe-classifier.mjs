import 'dotenv/config';
import { GigaChat } from 'langchain-gigachat';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { invokeStructured } from '../src/llm/structured-output.ts';
import { INTENT_SCHEMA, parseIntentText, CLASSIFIER_SYSTEM_PROMPT, CLASSIFIER_FALLBACK_PROMPT } from '../src/agent/prompts/classifier.prompt.ts';
import { PORTFOLIO_SCOPE_PROMPT } from '../src/agent/prompts/off-topic.ts';

/** Проверка классификатора на живом GigaChat. */
const model = new GigaChat({
  credentials: process.env.GIGACHAT_CREDENTIALS,
  scope: process.env.GIGACHAT_SCOPE ?? 'GIGACHAT_API_PERS',
  authUrl: process.env.GIGACHAT_AUTH_URL,
  model: process.env.LLM_ROUTER_MODEL ?? process.env.LLM_MODEL,
});

const question = process.argv[2] ?? 'что у меня в портфеле?';
const messages = [
  new SystemMessage(`${PORTFOLIO_SCOPE_PROMPT}\n\n${CLASSIFIER_SYSTEM_PROMPT}`),
  new HumanMessage(question),
];

const raw = await model.invoke(messages);
console.log('raw content:', JSON.stringify(raw.content).slice(0, 400));

// То, что реально использует узел классификации:
const structured = model.withStructuredOutput(INTENT_SCHEMA, { name: 'classify_intent' });
try {
  const direct = await structured.invoke(messages);
  console.log('withStructuredOutput:', JSON.stringify(direct));
} catch (error) {
  console.log('withStructuredOutput error:', String(error?.message ?? error).slice(0, 300));
}

const result = await invokeStructured({
  model,
  schema: INTENT_SCHEMA,
  name: 'classify_intent',
  messages,
  fallback: { systemPrompt: CLASSIFIER_FALLBACK_PROMPT, parse: parseIntentText },
});
console.log('invokeStructured:', JSON.stringify(result));
