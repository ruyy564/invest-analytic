import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';

describe('ScriptedChatModel', () => {
  it('отдаёт шаги по очереди и повторяет последний', async () => {
    const model = new ScriptedChatModel(['первый', 'второй']);
    const messages = [new HumanMessage('привет')];

    const first = await model.invoke(messages);
    const second = await model.invoke(messages);
    const third = await model.invoke(messages);

    expect(first.content).toBe('первый');
    expect(second.content).toBe('второй');
    expect(third.content).toBe('второй');
  });

  it('возвращает заранее заданные tool_calls', async () => {
    const withToolCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call-1', name: 'tinkoff__invest_get_portfolio', args: {} }],
    });
    const model = new ScriptedChatModel([withToolCall]);

    const response = await model.invoke([new HumanMessage('покажи портфель')]);

    expect((response as AIMessage).tool_calls).toEqual([
      { id: 'call-1', name: 'tinkoff__invest_get_portfolio', args: {} },
    ]);
  });
});
