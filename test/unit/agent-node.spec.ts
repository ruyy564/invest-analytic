import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { createAgentNode } from '../../src/agent/nodes/agent.node.js';
import { createHelpNode } from '../../src/agent/nodes/help.node.js';
import { buildAgentSystemPrompt } from '../../src/agent/nodes/agent/prompt.js';
import { isApprovedDecision } from '../../src/agent/nodes/approve.node.js';
import { KnowledgeRepository, KnowledgeService } from '../../src/knowledge/index.js';
import type { AppConfigService } from '../../src/config/app-config.service.js';
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

  it('на «что ты умеешь» отвечает нода справки, а не модель', async () => {
    // Справка живёт в отдельной ноде: модель на общий вопрос отвечает визиткой.
    const node = createHelpNode({
      config: {
        value: { run: { reviewEnabled: true }, sources: { newsFeed: { enabled: true } } },
      },
    } as never);

    const result = await node();

    const answer = String((result.messages?.[0] as AIMessage).content);
    expect(answer).toContain('Что умею');
    expect(answer).toContain('Портфель и счета');
    expect(result.intent).toBe('agent_help');
    expect(answer).not.toContain('умный помощник');
  });
});


describe('принципы принятия решений в промпте агента', () => {
  const knowledge = () => {
    const service = new KnowledgeService(
      new KnowledgeRepository({
        value: {
          run: {
            knowledgeEnabled: true,
            knowledgeDir: 'data/knowledge',
            knowledgeFile: undefined,
            knowledgeMaxChars: 1_800,
          },
        },
      } as unknown as AppConfigService),
    );
    return service.promptBlock({
      section: 'verdict',
      required: ['decision-checklist'],
      limit: 1,
      maxChars: 1_800,
    });
  };

  it('добавляет чек-лист и правило про оценки', () => {
    const prompt = buildAgentSystemPrompt({ knowledge: knowledge() });

    expect(prompt).toContain('Чек-лист принятия решений');
    expect(prompt).toContain('принципы трактовки, а не данные');
    expect(prompt).toContain('помечай (оценка)');
    // Роль и запрет торговли остаются на месте.
    expect(prompt).toContain('Не совершай торговых операций');
  });

  it('без базы знаний промпт остаётся прежним', () => {
    const prompt = buildAgentSystemPrompt();

    expect(prompt).not.toContain('Чек-лист принятия решений');
    expect(prompt).not.toContain('принципы трактовки');
    expect(prompt).toContain('Не совершай торговых операций');
  });
});

