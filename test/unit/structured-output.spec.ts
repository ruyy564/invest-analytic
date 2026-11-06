import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { StructuredOutputError, invokeStructured } from '../../src/platform/llm/structured-output.js';

const schema = z.object({ intent: z.enum(['portfolio', 'off_topic']) });

interface StubOptions {
  structured?: () => Promise<unknown>;
  invoke?: (messages: unknown[]) => Promise<unknown>;
}

const stubModel = (options: StubOptions): BaseChatModel =>
  ({
    _llmType: () => 'stub',
    withStructuredOutput: () => {
      if (!options.structured) {
        throw new Error('провайдер не поддерживает структурированный вывод');
      }
      return { invoke: options.structured };
    },
    invoke: options.invoke ?? (async () => new AIMessage('')),
  }) as unknown as BaseChatModel;

const fallback = {
  systemPrompt: 'Ответь одним словом: portfolio или off_topic',
  parse: (text: string) => {
    if (/portfolio/i.test(text)) {
      return { intent: 'portfolio' as const };
    }
    if (/off_topic/i.test(text)) {
      return { intent: 'off_topic' as const };
    }
    return null;
  },
};

const messages = [new HumanMessage('что у меня в портфеле?')];

describe('структурированный вывод с фолбэком', () => {
  it('возвращает результат структурированного вызова', async () => {
    const model = stubModel({ structured: async () => ({ intent: 'portfolio' }) });

    await expect(
      invokeStructured({ model, schema, name: 'classify', messages, fallback }),
    ).resolves.toEqual({ intent: 'portfolio' });
  });

  it('переходит к текстовому ответу, если структурированный вывод недоступен', async () => {
    const received: unknown[][] = [];
    const model = stubModel({
      invoke: async (input) => {
        received.push(input);
        return new AIMessage('portfolio');
      },
    });

    await expect(
      invokeStructured({ model, schema, name: 'classify', messages, fallback }),
    ).resolves.toEqual({ intent: 'portfolio' });

    expect(received[0]).toHaveLength(2);
    expect(received[0][1]).toBeInstanceOf(SystemMessage);
  });

  it('падает, если текст ответа не разбирается', async () => {
    const model = stubModel({ invoke: async () => new AIMessage('не знаю') });

    await expect(
      invokeStructured({ model, schema, name: 'classify', messages, fallback }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });
});
