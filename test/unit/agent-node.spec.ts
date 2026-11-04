import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { createAgentNode } from '../../src/agent/nodes/agent.node.js';
import { isApprovedDecision } from '../../src/agent/nodes/approve.node.js';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

describe('решение по подтверждению', () => {
  it('принимает объект, строку JSON, boolean и слова', () => {
    expect(isApprovedDecision({ approved: true })).toBe(true);
    expect(isApprovedDecision('{"approved": true}')).toBe(true);
    expect(isApprovedDecision('{"approved": false}')).toBe(false);
    expect(isApprovedDecision(true)).toBe(true);
    expect(isApprovedDecision('да')).toBe(true);
    expect(isApprovedDecision({ approve: 'true' })).toBe(true);
  });

  it('считает отказом пустое значение и мусор', () => {
    // Пустое поле Resume в Studio приходит как `undefined` или `{}` — это не «да».
    expect(isApprovedDecision(undefined)).toBe(false);
    expect(isApprovedDecision(null)).toBe(false);
    expect(isApprovedDecision({})).toBe(false);
    expect(isApprovedDecision('')).toBe(false);
    expect(isApprovedDecision('какой-то текст')).toBe(false);
    expect(isApprovedDecision({ approved: false })).toBe(false);
  });
});

describe('узел агента после сводки по счетам', () => {
  const SNAPSHOT = 'Портфель по счетам брокера:\n\n▸ Долгосрочный (acc-1)\n  • SBER: 77,00 шт.';
  const history = (extra: unknown[] = []) =>
    [
      new HumanMessage('Что в моем портфеле?'),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'portfolio_all_accounts', args: {} }],
      }),
      new ToolMessage({ tool_call_id: 'call-1', content: SNAPSHOT }),
      ...extra,
    ] as never;

  it('отдаёт текст сводки, если модель повторно просит инструмент', async () => {
    // GigaChat после получения данных иногда снова зовёт тот же инструмент:
    // без этой защиты прогон уходил на второй круг подтверждения.
    const model = new ScriptedChatModel([
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-2', name: 'portfolio_all_accounts', args: {} }],
      }),
    ]);

    const result = await createAgentNode(model, [fakeTool('portfolio_all_accounts')])({
      messages: history(),
    } as never);

    expect(String((result.messages as never[])[0] && (result.messages[0] as AIMessage).content)).toBe(
      SNAPSHOT,
    );
  });

  it('отдаёт текст сводки, если модель вернула пустой ответ', async () => {
    const model = new ScriptedChatModel(['']);

    const result = await createAgentNode(model, [fakeTool('portfolio_all_accounts')])({
      messages: history(),
    } as never);

    expect((result.messages[0] as AIMessage).content).toBe(SNAPSHOT);
  });

  it('оставляет обычный ответ модели, когда отчёта в истории нет', async () => {
    const model = new ScriptedChatModel(['У вас 77 акций SBER на счёте Долгосрочный.']);

    const result = await createAgentNode(model, [fakeTool('portfolio_all_accounts')])({
      messages: [
        new HumanMessage('Сколько у меня акций SBER?'),
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call-9', name: 'portfolio_all_accounts', args: {} }],
        }),
        new ToolMessage({ tool_call_id: 'call-9', content: 'ok' }),
      ],
    } as never);

    expect(String((result.messages[0] as AIMessage).content)).toContain('77 акций');
  });

  it('на «что ты умеешь» отвечает фиксированным списком возможностей', async () => {
    // На общий вопрос GigaChat отвечает своей визиткой, игнорируя промпт.
    const model = new ScriptedChatModel(['Я — ваш умный помощник.']);

    const result = await createAgentNode(model, [fakeTool('portfolio_all_accounts')])({
      messages: [new HumanMessage('что ты можешь?')],
    } as never);

    const answer = String((result.messages[0] as AIMessage).content);
    expect(answer).toContain('Что умею');
    expect(answer).toContain('портфель по всем счетам');
    expect(answer).not.toContain('умный помощник');
  });
});
