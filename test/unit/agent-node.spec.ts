import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { asksForCause, clipToolResults, createAgentNode, NO_INTERPRETATION_INTRO } from '../../src/agent/nodes/agent/index.js';
import { createHelpNode } from '../../src/agent/nodes/help/index.js';
import { buildAgentSystemPrompt } from '../../src/agent/nodes/agent/prompt.js';
import { isApprovedDecision } from '../../src/agent/nodes/approve/index.js';
import { KnowledgeRepository, KnowledgeService } from '../../src/capabilities/knowledge/index.js';
import type { AppConfigService } from '../../src/platform/config/app-config.service.js';
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

  it('считает подтверждением пустое поле Resume в Studio', () => {
    // Пользователь нажал Resume и ничего не ввёл: Studio отправляет `""`.
    expect(isApprovedDecision('')).toBe(true);
    expect(isApprovedDecision(undefined)).toBe(true);
    expect(isApprovedDecision(null)).toBe(true);
    expect(isApprovedDecision({})).toBe(true);
  });

  it('считает отказом явный отказ и мусор', () => {
    expect(isApprovedDecision(false)).toBe(false);
    expect(isApprovedDecision('false')).toBe(false);
    expect(isApprovedDecision('нет')).toBe(false);
    expect(isApprovedDecision('no')).toBe(false);
    expect(isApprovedDecision({ approved: false })).toBe(false);
    expect(isApprovedDecision({ decision: 'decline' })).toBe(false);
    expect(isApprovedDecision('какой-то текст')).toBe(false);
  });
});

describe('узел агента после сводки по счетам', () => {
  const SNAPSHOT = 'Портфель по счетам брокера:\n\n▸ Долгосрочный (acc-1)\n  • SBER: 77,00 шт.';
  const history = (extra: unknown[] = []) =>
    [
      new HumanMessage('Что в моем портфеле?'),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'portfolio__snapshot', args: {} }],
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
        tool_calls: [{ id: 'call-2', name: 'portfolio__snapshot', args: {} }],
      }),
    ]);

    const result = await createAgentNode(model, [fakeTool('portfolio__snapshot')])({
      messages: history(),
    } as never);

    expect(String((result.messages as never[])[0] && (result.messages[0] as AIMessage).content)).toBe(
      SNAPSHOT,
    );
  });

  it('отдаёт текст сводки, если модель вернула пустой ответ', async () => {
    const model = new ScriptedChatModel(['']);

    const result = await createAgentNode(model, [fakeTool('portfolio__snapshot')])({
      messages: history(),
    } as never);

    expect((result.messages[0] as AIMessage).content).toBe(SNAPSHOT);
  });

  it('оставляет обычный ответ модели, когда отчёта в истории нет', async () => {
    const model = new ScriptedChatModel(['У вас 77 акций SBER на счёте Долгосрочный.']);

    const result = await createAgentNode(model, [fakeTool('invest_get_share')])({
      messages: [
        new HumanMessage('Сколько у меня акций SBER?'),
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call-9', name: 'invest_get_share', args: {} }],
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
describe('ответ по данным текущего прогона', () => {
  const DYNAMICS = [
    'Динамика SBER (Сбербанк) за 180 дней:',
    '• начало периода: 2026-05-11 — 323,75 RUB',
    '• изменение: -29,75 RUB (-9,19%), падение',
  ].join('\n');

  const dynamicsCall = (id: string, args: Record<string, unknown>) =>
    new AIMessage({
      content: '',
      tool_calls: [{ id, name: 'market__price_dynamics', args }],
    });

  it('новый вопрос не получает динамику прошлого вопроса', async () => {
    // «Почему упал Яндекс» после вопроса о Сбере: готовый отчёт прошлого прогона
    // не должен подменять ответ (именно это выглядело как закешированный ответ).
    const model = new ScriptedChatModel([
      'Причина не установлена: публикаций с объяснением движения нет.',
    ]);

    const result = await createAgentNode(model, [fakeTool('market__price_dynamics')])({
      messages: [
        new HumanMessage('что с ценой SBER за полгода?'),
        dynamicsCall('call-1', { ticker: 'SBER', days: 180 }),
        new ToolMessage({ tool_call_id: 'call-1', content: DYNAMICS }),
        new AIMessage('За полгода бумага подешевела.'),
        new HumanMessage('почему упал яндекс?'),
      ],
      intent: 'data_lookup',
    } as never);

    const answer = String((result.messages[0] as AIMessage).content);
    expect(answer).toContain('Причина не установлена');
    expect(answer).not.toContain('Динамика SBER');
  });

  it('на «стоит ли покупать» отвечает трактовкой, а не строкой динамики', async () => {
    // Динамика уже получена: одной цены для решения мало, отвечает модель.
    const model = new ScriptedChatModel([
      'За: цена ниже цели аналитиков (оценка). Против: ставка давит на маржу. Это не рекомендация.',
    ]);

    const result = await createAgentNode(model, [fakeTool('market__price_dynamics')])({
      messages: [
        new HumanMessage('стоит ли ее покупать?'),
        dynamicsCall('call-2', { ticker: 'SBER', days: 180 }),
        new ToolMessage({ tool_call_id: 'call-2', content: DYNAMICS }),
      ],
      intent: 'security_analysis',
    } as never);

    const answer = String((result.messages[0] as AIMessage).content);
    expect(answer).toContain('оценка');
    expect(answer).not.toBe(DYNAMICS);
  });

  it('если модель промолчала на «стоит ли», отдаёт факты, а не сырой отчёт', async () => {
    // Легаси-ответ: готовый отчёт инструмента вместо ответа на вопрос-оценку.
    // Здесь вопрос требует трактовки, поэтому при молчании модели — факты и
    // честное «оценку не даю», но не отчёт как есть.
    const model = new ScriptedChatModel(['']);

    const result = await createAgentNode(model, [fakeTool('market__price_dynamics')])({
      messages: [
        new HumanMessage('стоит ли покупать лукойл'),
        dynamicsCall('call-3', { ticker: 'LKOH', days: 180 }),
        new ToolMessage({ tool_call_id: 'call-3', content: DYNAMICS }),
      ],
      intent: 'security_analysis',
    } as never);

    const answer = String((result.messages[0] as AIMessage).content);
    expect(answer.startsWith(NO_INTERPRETATION_INTRO)).toBe(true);
    expect(answer).toContain('Что известно по данным');
    expect(answer).not.toBe(DYNAMICS);
  });

  it('точечный вопрос по данным получает готовый отчёт без обращения к модели', async () => {
    const model = new ScriptedChatModel(['текст модели не должен использоваться']);

    const result = await createAgentNode(model, [])({
      messages: [
        new HumanMessage('что с ценой SBER за полгода?'),
        dynamicsCall('call-3', { ticker: 'SBER', days: 180 }),
        new ToolMessage({ tool_call_id: 'call-3', content: DYNAMICS }),
      ],
      intent: 'data_lookup',
    } as never);

    expect(String((result.messages[0] as AIMessage).content)).toBe(DYNAMICS);
  });

  it('повторный вызов с теми же аргументами не уходит на второй круг', async () => {
    // GigaChat снова просит динамику, хотя данные уже есть: второй запрос не нужен.
    const model = new ScriptedChatModel([
      dynamicsCall('call-4', { days: 180, ticker: 'SBER' }),
    ]);

    const result = await createAgentNode(model, [fakeTool('market__price_dynamics')])({
      messages: [
        new HumanMessage('что с ценой sber за полгода?'),
        dynamicsCall('call-5', { ticker: 'SBER', days: 180 }),
        new ToolMessage({ tool_call_id: 'call-5', content: DYNAMICS }),
      ],
      intent: 'data_lookup',
    } as never);

    const message = result.messages[0] as AIMessage;
    // Вызов отброшен: прогон завершается ответом по уже полученным данным.
    expect(message.tool_calls ?? []).toHaveLength(0);
    expect(String(message.content)).toBe(DYNAMICS);
  });

  it('повтор вызова без готового отчёта выполняется: пустого ответа не будет', async () => {
    // Данные есть, но готового отчёта кода нет — лучше повторить вызов, чем ответить пусто.
    const share = (id: string) =>
      new AIMessage({ content: '', tool_calls: [{ id, name: 'instruments__meta', args: { ticker: 'SBER' } }] });
    const model = new ScriptedChatModel([share('call-7')]);

    const result = await createAgentNode(model, [fakeTool('instruments__meta')])({
      messages: [
        new HumanMessage('что за бумага SBER?'),
        share('call-6'),
        new ToolMessage({ tool_call_id: 'call-6', content: 'сектор: финансы' }),
      ],
      intent: 'data_lookup',
    } as never);

    expect((result.messages[0] as AIMessage).tool_calls ?? []).toHaveLength(1);
  });
});
describe('вопрос о причинах движения цены', () => {
  const ALIASES = { YDEX: ['Яндекс'], VKCO: ['VK'] };
  const NEWS = [
    'Новости YDEX за 30 дн.:',
    '• 2026-11-06 [interfax] Яндекс отчитался хуже ожиданий по выручке',
  ].join('\n');
  const DYNAMICS = 'Динамика YDEX (Яндекс) за 180 дней:\n• изменение: -29,75 RUB (-9,19%), падение';

  const calls = (id: string, name: string, args: Record<string, unknown>) =>
    new AIMessage({ content: '', tool_calls: [{ id, name, args }] });

  it('запрашивает новости по названным бумагам по одной за круг', async () => {
    // Причин у брокера нет: без публикаций модель объясняет движение домыслами.
    // Первым кругом идёт динамика цены: без неё ответ «что с бумагой» пуст.
    const model = new ScriptedChatModel(['ответ модели не используется']);
    const tools = [fakeTool('market__price_dynamics'), fakeTool('news__search')];
    const question = 'почему упал яндекс и вырос вк?';

    const first = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: [new HumanMessage(question)],
      intent: 'data_lookup',
    } as never);

    const firstCalls = (first.messages[0] as AIMessage).tool_calls ?? [];
    expect(firstCalls.map((call) => call.name)).toEqual(['market__price_dynamics']);
    expect((firstCalls[0].args as { ticker?: string }).ticker).toBe('YDEX');

    // Дальше — новости: один вызов за круг (несколько function results GigaChat
    // отклоняет с 422).
    const history = [
      new HumanMessage(question),
      new AIMessage({ content: '', tool_calls: firstCalls }),
      new ToolMessage({ tool_call_id: firstCalls[0].id ?? '', content: DYNAMICS }),
    ];
    const second = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: history,
      intent: 'data_lookup',
    } as never);

    const secondCalls = (second.messages[0] as AIMessage).tool_calls ?? [];
    expect(secondCalls.map((call) => call.name)).toEqual(['news__search']);
    expect((secondCalls[0].args as { ticker?: string }).ticker).toBe('YDEX');

    // Второй круг добирает вторую бумагу из вопроса.
    const third = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: [
        ...history,
        new AIMessage({ content: '', tool_calls: secondCalls }),
        new ToolMessage({ tool_call_id: secondCalls[0].id ?? '', content: 'публикаций нет' }),
      ],
      intent: 'data_lookup',
    } as never);

    const next = (third.messages[0] as AIMessage).tool_calls ?? [];
    expect((next[0]?.args as { ticker?: string }).ticker).toBe('VKCO');
  });

  it('«почему» без движения цены причиной не считается', () => {
    expect(asksForCause('почему упал яндекс?')).toBe(true);
    expect(asksForCause('что случилось с Яндексом?')).toBe(true);
    expect(asksForCause('почему в портфеле так много банков?')).toBe(false);
    expect(asksForCause('сравни Сбер и ВТБ')).toBe(false);
  });

  it('сначала запрашивает рыночные факторы числами', async () => {
    // «Возможно, нефть выросла» — догадка: сначала нужны числа по нефти, курсу и ставке.
    const model = new ScriptedChatModel(['ответ модели не используется']);
    const tools = [fakeTool('market__factors'), fakeTool('news__search')];

    const result = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: [new HumanMessage('почему упал яндекс?')],
      intent: 'data_lookup',
    } as never);

    const toolCalls = (result.messages[0] as AIMessage).tool_calls ?? [];
    expect(toolCalls.map((call) => call.name)).toEqual(['market__factors']);
  });

  it('факторы не запрашиваются повторно', async () => {
    const model = new ScriptedChatModel(['ответ модели не используется']);
    const tools = [fakeTool('market__factors'), fakeTool('news__search')];

    const result = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: [
        new HumanMessage('почему упал яндекс?'),
        calls('f1', 'market__factors', { days: 30 }),
        new ToolMessage({ tool_call_id: 'f1', content: 'Рыночные факторы: нефть 98,64' }),
      ],
      intent: 'data_lookup',
    } as never);

    const toolCalls = (result.messages[0] as AIMessage).tool_calls ?? [];
    expect(toolCalls.map((call) => call.name)).toEqual(['news__search']);
  });

  it('если по бумаге новостей нет, запрашивает общую повестку', async () => {
    // Причины бывают отраслевыми (нефть, курс, санкции) — они в общей ленте.
    const model = new ScriptedChatModel(['ответ модели не используется']);
    const tools = [fakeTool('news__search')];

    const result = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: [
        new HumanMessage('почему упал яндекс?'),
        calls('n1', 'news__search', { ticker: 'YDEX', days: 30, limit: 6 }),
        new ToolMessage({
          tool_call_id: 'n1',
          content: 'Новости YDEX за 30 дн.:\nновостей нет',
        }),
      ],
      intent: 'data_lookup',
    } as never);

    const toolCalls = (result.messages[0] as AIMessage).tool_calls ?? [];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('news__search');
    expect((toolCalls[0].args as { ticker?: string }).ticker).toBeUndefined();
  });

  it('ответ со ссылкой на публикацию остаётся как есть', async () => {
    const model = new ScriptedChatModel([
      'Яндекс отчитался хуже ожиданий по выручке (2026-11-06, interfax).',
    ]);
    const tools = [fakeTool('news__search')];

    const result = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: [
        new HumanMessage('почему упал яндекс?'),
        calls('n1', 'news__search', { ticker: 'YDEX' }),
        new ToolMessage({ tool_call_id: 'n1', content: NEWS }),
      ],
      intent: 'data_lookup',
    } as never);

    expect(String((result.messages[0] as AIMessage).content)).toContain('interfax');
  });

  it('домыслы без источников заменяются фактами', async () => {
    // Модель назвала чужой тикер (YNDX вместо YDEX) и объяснила движение «успешностью».
    const model = new ScriptedChatModel([
      'Яндекс (YNDX) упал из-за слабой отчётности, а VK успешнее и рос на новостях.',
    ]);
    const tools = [fakeTool('market__price_dynamics'), fakeTool('news__search')];

    const result = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: [
        new HumanMessage('почему упал яндекс?'),
        calls('d1', 'market__price_dynamics', { ticker: 'YDEX', days: 180 }),
        new ToolMessage({ tool_call_id: 'd1', content: DYNAMICS }),
        calls('n1', 'news__search', { ticker: 'YDEX' }),
        new ToolMessage({ tool_call_id: 'n1', content: NEWS }),
      ],
      intent: 'data_lookup',
    } as never);

    const answer = String((result.messages[0] as AIMessage).content);
    expect(answer).toContain('Причина не установлена');
    expect(answer).toContain('Динамика YDEX');
    expect(answer).toContain('2026-11-06 [interfax]');
    expect(answer).not.toContain('YNDX');
    expect(answer).not.toContain('успешнее');
  });
});
describe('вопрос «что с бумагой»', () => {
  const ALIASES = { SBER: ['Сбер', 'Сбербанк'] };

  it('считается вопросом о движении: сначала собирает публикации', async () => {
    // «Что со сбером?» — это про движение бумаги, а не только про цену.
    const model = new ScriptedChatModel(['']);
    const tools = [fakeTool('news__search')];

    const result = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: [new HumanMessage('что со сбером')],
      intent: 'security_analysis',
    } as never);

    const calls = (result.messages[0] as AIMessage).tool_calls ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('news__search');
    expect(calls[0]?.args).toMatchObject({ ticker: 'SBER' });
  });

  it('«что с портфелем» причиной не считается: бумага не названа', async () => {
    const model = new ScriptedChatModel(['ответ модели']);
    const tools = [fakeTool('news__search')];

    const result = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: [new HumanMessage('что с портфелем')],
      intent: 'data_lookup',
    } as never);

    expect((result.messages[0] as AIMessage).tool_calls ?? []).toEqual([]);
  });
});

describe('повтор вызова на вопрос о причине', () => {
  const ALIASES = { LKOH: ['ЛУКОЙЛ', 'Лукойл'] };
  const DYNAMICS = 'Динамика LKOH (ЛУКОЙЛ) за 180 дней:\n• изменение: +888,00 RUB (+17,08%), рост';

  const calls = (id: string, name: string, args: Record<string, unknown>) =>
    new AIMessage({ content: '', tool_calls: [{ id, name, args }] });

  it('не превращается в голую динамику цены', async () => {
    // Именно так пришёл ответ «почему вырос лукойл»: модель повторила уже
    // выполненный вызов, и узел отдал отчёт инструмента без разбора причин.
    const model = new ScriptedChatModel([
      calls('d2', 'market__price_dynamics', { ticker: 'LKOH', days: 180 }),
    ]);
    const tools = [fakeTool('market__price_dynamics'), fakeTool('news__search')];

    const result = await createAgentNode(model, tools, { aliases: ALIASES })({
      messages: [
        new HumanMessage('почему вырос лукойл?'),
        calls('n1', 'news__search', { ticker: 'LKOH', days: 30, limit: 6 }),
        new ToolMessage({
          tool_call_id: 'n1',
          content: 'Новости LKOH за 30 дн.:\nновостей нет\nНедоступные источники: rbc',
        }),
        calls('n2', 'news__search', { days: 7, limit: 6 }),
        new ToolMessage({ tool_call_id: 'n2', content: 'Новости рынка за 7 дн.:\nновостей нет' }),
        calls('d1', 'market__price_dynamics', { ticker: 'LKOH', days: 180 }),
        new ToolMessage({ tool_call_id: 'd1', content: DYNAMICS }),
      ],
      intent: 'data_lookup',
    } as never);

    const answer = String((result.messages[0] as AIMessage).content);
    expect(answer).toContain('Причина не установлена');
    expect(answer).toContain('Динамика LKOH');
    expect(answer).toContain('Не удалось прочитать: rbc');
    expect(answer).not.toBe(DYNAMICS);
  });
});





describe('объём контекста для модели', () => {
  const toolMessage = (id: string, length: number): ToolMessage =>
    new ToolMessage({ tool_call_id: id, content: 'я'.repeat(length) });

  it('урезает длинные ответы инструментов до бюджета', () => {
    const clipped = clipToolResults(
      [toolMessage('a', 300), toolMessage('b', 300)],
      100,
    );
    const contents = clipped.map((message) => String(message.content));

    // Свежий результат важнее: он получает весь бюджет, старый — только пометку.
    expect(contents[1].startsWith('я'.repeat(100))).toBe(true);
    expect(contents[1]).toContain('текст сокращён');
    expect(contents[0]).toContain('текст сокращён');
    expect(contents.join('').length).toBeLessThan(260);
  });

  it('не трогает короткие ответы и обычные сообщения', () => {
    const question = new HumanMessage('почему упал Сбер?');
    const clipped = clipToolResults([question, toolMessage('a', 20)], 1_000);

    expect(String(clipped[0].content)).toBe('почему упал Сбер?');
    expect(String(clipped[1].content)).toBe('я'.repeat(20));
  });

  it('сохраняет идентификатор вызова: провайдер сверяет ответ с вызовом', () => {
    const [clipped] = clipToolResults([toolMessage('call-1', 5_000)], 10);

    expect((clipped as ToolMessage).tool_call_id).toBe('call-1');
  });
});

