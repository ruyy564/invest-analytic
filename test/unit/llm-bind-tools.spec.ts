import { jest } from '@jest/globals';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { RunnableBinding } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { bindToolsCompat } from '../../src/llm/bind-tools.js';

const demo = tool(async () => 'ok', {
  name: 'demo',
  description: 'демо-инструмент',
  schema: z.object({}),
});

describe('привязка инструментов к модели', () => {
  it('для GigaChat использует RunnableBinding с готовыми functions', () => {
    const formatted = [{ name: 'demo' }];
    const model = {
      _llmType: () => 'gigachat',
      formatStructuredToolToGigaChat: jest.fn(() => formatted),
      bindTools: jest.fn(),
    } as unknown as BaseChatModel;

    const bound = bindToolsCompat(model, [demo]);

    expect(bound).toBeInstanceOf(RunnableBinding);
    expect((model as unknown as { bindTools: jest.Mock }).bindTools).not.toHaveBeenCalled();
  });

  it('для остальных провайдеров использует bindTools', () => {
    const boundResult = { bound: true };
    const model = {
      _llmType: () => 'openai',
      bindTools: jest.fn(() => boundResult),
    } as unknown as BaseChatModel;

    expect(bindToolsCompat(model, [demo])).toBe(boundResult);
    expect((model as unknown as { bindTools: jest.Mock }).bindTools).toHaveBeenCalledWith([demo]);
  });

  it('падает, если модель не поддерживает инструменты', () => {
    const model = { _llmType: () => 'plain' } as unknown as BaseChatModel;

    expect(() => bindToolsCompat(model, [demo])).toThrow(/не поддерживает привязку инструментов/);
  });
});
