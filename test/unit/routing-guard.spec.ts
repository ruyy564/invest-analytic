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

describe('денежные вопросы вне бумаг', () => {
  it('квартира, ипотека и гараж — работа эксперта, а не отказ', async () => {
    // «Вне моей компетенции» на вопрос о квартире — потерянный клиент:
    // это денежное решение, где нужен разбор критериев и рисков.
    const route = await routeQuestion({ question: 'стоит ли покупать квартиру в ипотеку сейчас?' });

    expect(route.intent).not.toBe('off_topic');
    expect(route.intent).toBe('data_lookup');
  });

  it('вклады и ИПС тоже не посторонняя тема', async () => {
    const route = await routeQuestion({ question: 'что выгоднее — вклад или ИПС?' });

    expect(route.intent).toBe('data_lookup');
  });

  it('погода остаётся посторонней темой', async () => {
    const route = await routeQuestion({ question: 'какая завтра погода в Москве?' });

    expect(route.intent).toBe('off_topic');
  });

  it('незнакомая бумага — вопрос к агенту, а не отказ', async () => {
    // Новых эмитентов нет в алиасах: тикер должен найти инструмент
    // (invest_find_instrument), а не захардкоженный список и не отказ.
    const route = await routeQuestion({ question: 'что за бумага хэдхантер?' });

    expect(route.intent).toBe('security_analysis');
  });

  it('«стоит ли брать акции X» тоже не посторонняя тема', async () => {
    const route = await routeQuestion({ question: 'стоит ли брать акции Циана?' });

    expect(route.intent).toBe('security_analysis');
  });

  it('вопросы по экономике не уходят в отказ', async () => {
    // «Это вне моей компетенции» на вопрос про инфляцию или ФРС — потерянный клиент:
    // знания есть в базе, а свежие данные добираются новостями и инструментами.
    const questions = [
      'что такое секьюритизация?',
      'почему ставка ФРС важна для инвесторов?',
      'будет ли расти рынок?',
      'как инфляция влияет на облигации?',
    ];

    for (const question of questions) {
      const route = await routeQuestion({ question });
      expect(route.intent).not.toBe('off_topic');
    }
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

  it('вопрос-решение продолжает бумагу, названную в предыдущем вопросе', async () => {
    // «Расскажи о Сбере» → «стоит ли её покупать»: местоимение ссылается на Сбер,
    // иначе вопрос уходил в свободный агент и отвечал одной динамикой цены.
    const route = await routeQuestion({
      question: 'стоит ли ее покупать?',
      previousQuestion: 'расскажи о сбере',
    });

    expect(route).toMatchObject({
      intent: 'portfolio_review',
      scope: 'instrument',
      scopeTarget: 'SBER',
      source: 'rule',
    });
  });

  it('без названной ранее бумаги тикер не угадывается', async () => {
    const route = await routeQuestion({
      question: 'стоит ли ее покупать?',
      previousQuestion: 'что у меня в портфеле?',
    });

    expect(route.scope).toBe('portfolio');
    expect(route.intent).toBe('data_lookup');
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

  it('вопрос о составе портфеля помечает потребность в данных', async () => {
    const withData = await routeQuestion({ question: 'что у меня в портфеле?' });
    const withoutData = await routeQuestion({ question: 'сколько стоит Сбер?' });

    // Правило маршрутизации, а не разбор текста в узле ответа.
    expect(withData.dataNeed).toBe('portfolio');
    expect(withoutData.dataNeed).toBeUndefined();
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

describe('уточняющий вопрос', () => {
  /** Алиасы как в проекте: без файла, но с нужными бумагами. */
  const aliases = { LKOH: ['ЛУКОЙЛ', 'Лукойл'], SMLT: ['Самолет', 'Самолёт'], SBER: ['Сбер', 'Сбербанк'] };

  it('наследует тему и область у предыдущего вопроса', async () => {
    // Без наследования «расскажи детальней» отвечал «это вне моей компетенции».
    const decision = await routeQuestion({
      question: 'расскажи детальней',
      previousQuestion: 'почему вырос лукойл?',
      previousIntent: 'security_analysis',
      aliases,
    });

    expect(decision.intent).toBe('security_analysis');
    expect(decision.scope).toBe('instrument');
    expect(decision.scopeTarget).toBe('LKOH');
    expect(decision.followUp).toBe(true);
  });

  it('без предыдущего вопроса уточнение остаётся портфельным', async () => {
    const decision = await routeQuestion({ question: 'расскажи детальней', aliases });

    expect(decision.followUp).toBeUndefined();
    expect(decision.scope).toBe('portfolio');
  });

  it('«расскажи о Сбере» — новая тема, а не уточнение', async () => {
    const decision = await routeQuestion({ question: 'расскажи о Сбере', aliases });

    expect(decision.followUp).toBeUndefined();
    expect(decision.scope).toBe('instrument');
    expect(decision.scopeTarget).toBe('SBER');
  });

  it('названная бумага не считается посторонней темой', async () => {
    // Классификатор ставил off_topic на короткое «что с самолетом?».
    const model = new ScriptedChatModel(['off_topic']);
    const decision = await routeQuestion({ question: 'что с самолетом?', aliases, model });

    expect(decision.intent).toBe('security_analysis');
    expect(decision.scope).toBe('instrument');
    expect(decision.scopeTarget).toBe('SMLT');
  });
});

