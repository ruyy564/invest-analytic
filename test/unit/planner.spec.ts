import { AIMessage } from '@langchain/core/messages';
import {
  CAPABILITIES,
  fallbackPlanFor,
  mergePlan,
  parseModelPlan,
  planWithModel,
  validatePlan,
} from '../../src/agent/planning/index.js';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';

const planJson = (steps: { tool: string; args?: Record<string, unknown> }[]): string =>
  JSON.stringify({ steps });

describe('разбор и валидация плана', () => {
  it('достаёт JSON из ответа модели', () => {
    expect(parseModelPlan(`вот план: ${planJson([{ tool: 'portfolio__snapshot' }])}`)).toEqual({
      steps: [{ tool: 'portfolio__snapshot', args: {} }],
    });
    expect(parseModelPlan('без json')).toBeUndefined();
  });

  it('берёт группы из каталога и отбрасывает неизвестные инструменты', () => {
    const parsed = parseModelPlan(
      planJson([
        { tool: 'portfolio__snapshot' },
        { tool: 'invest_get_portfolio', args: { accountId: 'a' } },
      ]),
    );

    const { steps, dropped } = validatePlan(parsed!);

    expect(steps).toEqual([
      { tool: 'portfolio__snapshot', args: {}, group: 'portfolio' },
    ]);
    expect(dropped).toEqual(['invest_get_portfolio']);
  });
});

describe('планировщик', () => {
  it('принимает валидный план модели', async () => {
    const model = new ScriptedChatModel([
      new AIMessage(
        planJson([
          { tool: 'instruments__find', args: { query: 'SBER' } },
          { tool: 'instruments__forecast', args: {} },
        ]),
      ),
    ]);

    const result = await planWithModel({ model, question: 'стоит ли покупать Сбер' });

    expect(result.source).toBe('model');
    expect(result.steps.map((step) => step.tool)).toEqual([
      'instruments__find',
      'instruments__forecast',
    ]);
    expect(result.steps[1].group).toBe('analytics');
  });

  it('после двух невалидных ответов отдаёт безопасный план с причиной', async () => {
    const model = new ScriptedChatModel([new AIMessage('никакого json'), new AIMessage('{}')]);

    const result = await planWithModel({
      model,
      question: 'что у меня в портфеле',
      fallback: () => fallbackPlanFor('portfolio_review', 'portfolio'),
    });

    expect(result.source).toBe('fallback');
    expect(result.reason).toContain('валидацию');
    expect(result.steps.map((step) => step.tool)).toEqual(['portfolio__snapshot']);
  });

  it('при недоступности модели сразу использует фолбэк', async () => {
    const model = {
      invoke: async () => {
        throw new Error('provider down');
      },
    } as unknown as ScriptedChatModel;

    const result = await planWithModel({ model, question: 'что у меня в портфеле' });

    expect(result.source).toBe('fallback');
    expect(result.reason).toContain('недоступен');
  });

  it('безопасный план учитывает сценарий и область', () => {
    expect(fallbackPlanFor('market_news', 'portfolio').steps.map((step) => step.group)).toEqual([
      'news',
    ]);
    expect(fallbackPlanFor('portfolio_review', 'instrument').steps.map((step) => step.tool)).toEqual([
      'instruments__find',
    ]);
    expect(fallbackPlanFor('data_lookup', 'account').steps.map((step) => step.tool)).toEqual([
      'portfolio__snapshot',
    ]);
  });

  it('каталог содержит восемь доменных фасадов', () => {
    expect(CAPABILITIES).toHaveLength(8);
    expect(CAPABILITIES.every((item) => item.description.length > 20)).toBe(true);
  });

  it('агентский режим добавляет шаги модели, не теряя обязательные', () => {
    const base = {
      entries: [
        {
          tool: 'invest_get_portfolio',
          args: { accountId: 'a' },
          group: 'portfolio' as const,
          priority: 'mandatory' as const,
        },
      ],
      maxInstruments: 5,
    };

    const merged = mergePlan(base, [
      { tool: 'invest_get_candles', args: {}, group: 'candles' },
      { tool: 'invest_get_portfolio', args: { accountId: 'a' }, group: 'portfolio' },
    ]);

    // Дубликат запроса не появляется, обязательный источник остаётся первым.
    expect(merged.entries.map((entry) => entry.tool)).toEqual([
      'invest_get_portfolio',
      'invest_get_candles',
    ]);
    expect(merged.entries[1].priority).toBe('optional');
  });
});
