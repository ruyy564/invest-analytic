import { AIMessage } from '@langchain/core/messages';
import { guardQuestion, TRADING_ANSWER } from '../../src/agent/routing/index.js';
import { routeQuestion } from '../../src/agent/routing/index.js';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';

describe('guard до модели', () => {
  it('блокирует пустой вопрос', () => {
    const decision = guardQuestion('   ');

    expect(decision.blocked).toBe(true);
    if (decision.blocked) {
      expect(decision.reason).toBe('empty');
    }
  });

  it('блокирует просьбу о сделке и объясняет границу', () => {
    const decision = guardQuestion('купи 10 акций Сбера');

    expect(decision.blocked).toBe(true);
    if (decision.blocked) {
      expect(decision.reason).toBe('trading');
      expect(decision.answer).toBe(TRADING_ANSWER);
    }
  });

  it('блокирует постороннюю тему', () => {
    const decision = guardQuestion('какая завтра погода в Москве?');

    expect(decision.blocked).toBe(true);
    if (decision.blocked) {
      expect(decision.reason).toBe('off_topic');
    }
  });

  it('не блокирует вопросы про бумагу и портфель', () => {
    expect(guardQuestion('стоит ли покупать Сбер').blocked).toBe(false);
    expect(guardQuestion('что у меня в портфеле').blocked).toBe(false);
  });
});

describe('маршрутизация вопроса', () => {
  it('справку о возможностях решает правилом', async () => {
    const route = await routeQuestion({ question: 'что ты умеешь?' });

    expect(route).toMatchObject({ intent: 'agent_help', source: 'rule' });
  });

  it('разбор портфеля решает правилом', async () => {
    const route = await routeQuestion({ question: 'проанализируй мой портфель' });

    expect(route).toMatchObject({ intent: 'portfolio_review', source: 'rule' });
  });

  it('вопрос о покупке бумаги уходит в разбор с тикером', async () => {
    const route = await routeQuestion({ question: 'стоит ли покупать полюс золото' });

    expect(route).toMatchObject({
      intent: 'portfolio_review',
      scope: 'instrument',
      scopeTarget: 'PLZL',
      source: 'rule',
    });
  });

  it('посторонний вопрос отсекает guard с готовым ответом', async () => {
    const route = await routeQuestion({ question: 'какая погода в Москве?' });

    expect(route.intent).toBe('off_topic');
    expect(route.source).toBe('guard');
    expect(route.guard?.blocked).toBe(true);
  });

  it('неясный вопрос отдаёт модели и фиксирует источник', async () => {
    const model = new ScriptedChatModel([new AIMessage('data_lookup')]);

    const route = await routeQuestion({ question: 'расскажи подробнее', model });

    expect(route).toMatchObject({ intent: 'data_lookup', source: 'model' });
  });

  it('недоступная модель даёт безопасный вариант', async () => {
    const model = new ScriptedChatModel([new AIMessage('')]);
    // Пустой ответ разбирается как data_lookup моделью, но источник остаётся model.
    const ok = await routeQuestion({ question: 'расскажи подробнее', model });
    expect(ok.intent).toBe('data_lookup');

    const broken = {
      invoke: async () => {
        throw new Error('provider down');
      },
    } as unknown as ScriptedChatModel;
    const route = await routeQuestion({ question: 'расскажи подробнее', model: broken });

    expect(route).toMatchObject({ intent: 'data_lookup', source: 'fallback' });
  });
});
