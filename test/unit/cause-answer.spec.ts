import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import {
  CAUSE_UNKNOWN,
  causeFactsAnswer,
  foreignTickers,
  isGroundedCauseAnswer,
  knownTickers,
  newsFailures,
  newsItems,
  newsTickersRequested,
  toolResults,
} from '../../src/agent/nodes/agent/index.js';

const NEWS_TEXT = [
  'Новости YDEX за 30 дн.:',
  '• 2026-11-06 [interfax] Яндекс отчитался хуже ожиданий по выручке',
  '• 2026-11-04 [rbc] VK показал рост рекламной выручки',
].join('\n');

/** Результат новостного инструмента в истории: вызов и ответ на него. */
const newsHistory = (id = 'call-news', text = NEWS_TEXT) => [
  new HumanMessage('почему упал яндекс?'),
  new AIMessage({ content: '', tool_calls: [{ id, name: 'news__search', args: { ticker: 'YDEX' } }] }),
  new ToolMessage({ tool_call_id: id, content: text }),
];

describe('публикации прогона', () => {
  it('разбирает ленту с датой и источником', () => {
    const items = newsItems(newsHistory() as never);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      date: '2026-11-06',
      source: 'interfax',
      title: 'Яндекс отчитался хуже ожиданий по выручке',
    });
  });

  it('разбирает JSON брокера и убирает дубли', () => {
    const raw = JSON.stringify({
      items: [
        { title: 'Яндекс отчитался хуже ожиданий по выручке', ts: '2026-11-06T09:00:00Z' },
        { title: 'Яндекс отчитался хуже ожиданий по выручке', ts: '2026-11-06T09:00:00Z' },
      ],
    });

    const items = newsItems([
      new HumanMessage('почему упал яндекс?'),
      new AIMessage({ content: '', tool_calls: [{ id: 'n1', name: 'invest_get_news', args: {} }] }),
      new ToolMessage({ tool_call_id: 'n1', content: raw }),
    ] as never);

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('брокер');
  });

  it('запоминает, по каким тикерам новости уже запрошены', () => {
    expect([...newsTickersRequested(newsHistory() as never)]).toEqual(['YDEX']);
  });

  it('берёт только ответы новостных инструментов', () => {
    const results = toolResults(
      [
        new HumanMessage('почему упал яндекс?'),
        new AIMessage({ content: '', tool_calls: [{ id: 'd1', name: 'market__price_dynamics', args: {} }] }),
        new ToolMessage({ tool_call_id: 'd1', content: 'Динамика YDEX' }),
      ] as never,
      new Set(['news__search']),
    );

    expect(results).toEqual([]);
  });
});

describe('проверка ответа про причины', () => {
  const ALIASES = { YDEX: ['Яндекс'], VKCO: ['VK'] };

  it('принимает ответ со ссылкой на публикацию', () => {
    const messages = newsHistory() as never;
    const answer = 'Яндекс отчитался хуже ожиданий по выручке — 2026-11-06, interfax.';

    expect(
      isGroundedCauseAnswer(answer, newsItems(messages), knownTickers(messages, ALIASES)),
    ).toBe(true);
  });

  it('принимает прямое признание, что причина не установлена', () => {
    const messages = newsHistory() as never;

    expect(
      isGroundedCauseAnswer(
        `${CAUSE_UNKNOWN}: публикаций с объяснением нет.`,
        newsItems(messages),
        knownTickers(messages, ALIASES),
      ),
    ).toBe(true);
  });

  it('принимает ответ со ссылкой на дату публикации', () => {
    const messages = newsHistory() as never;
    const answer = 'Давление усилилось после публикации 06.11 — подробности в ленте.';

    expect(
      isGroundedCauseAnswer(answer, newsItems(messages), knownTickers(messages, ALIASES)),
    ).toBe(true);
  });

  it('отговорка «нет доступа к новостям» не считается ответом', () => {
    const messages = newsHistory() as never;
    const answer = 'Причина не установлена: у меня нет доступа к новостям компании.';

    expect(
      isGroundedCauseAnswer(answer, newsItems(messages), knownTickers(messages, ALIASES)),
    ).toBe(false);
  });

  it('отклоняет домыслы без ссылок на публикации', () => {
    const messages = newsHistory() as never;
    const answer = 'VK более успешная компания, поэтому инвесторы покупали её акции.';

    expect(
      isGroundedCauseAnswer(answer, newsItems(messages), knownTickers(messages, ALIASES)),
    ).toBe(false);
  });

  it('отклоняет пересказ публикации без даты и источника', () => {
    const messages = newsHistory() as never;
    // Слова совпадают с заголовком, но проверить нечем: ссылки нет.
    const answer = 'Яндекс отчитался хуже ожиданий по выручке, поэтому акции упали.';

    expect(
      isGroundedCauseAnswer(answer, newsItems(messages), knownTickers(messages, ALIASES)),
    ).toBe(false);
  });

  it('отклоняет ответ с тикером, которого нет в данных', () => {
    const messages = newsHistory() as never;
    // YNDX — не Яндекс: у него тикер YDEX, и в данных прогона такого тикера нет.
    const answer = 'Яндекс (YNDX) отчитался хуже ожиданий по выручке.';

    const known = knownTickers(messages, ALIASES);
    expect(foreignTickers(answer, known)).toEqual(['YNDX']);
    expect(isGroundedCauseAnswer(answer, newsItems(messages), known)).toBe(false);
  });

  it('знает тикеры из данных и алиасов', () => {
    const known = knownTickers(newsHistory('call-news', NEWS_TEXT) as never, ALIASES);

    expect(known.has('YDEX')).toBe(true);
    expect(known.has('VK')).toBe(true);
    expect(known.has('RUB')).toBe(false);
  });
});

describe('ответ по фактам', () => {
  it('показывает динамику, публикации и признаёт причину неустановленной', () => {
    const answer = causeFactsAnswer({
      dynamics: ['Динамика YDEX (Яндекс) за 180 дней:\n• изменение: -9,19 %, падение'],
      news: newsItems(newsHistory() as never),
      tickers: ['YDEX'],
    });

    expect(answer).toContain(CAUSE_UNKNOWN);
    expect(answer).toContain('Динамика YDEX');
    expect(answer).toContain('• 2026-11-06 [interfax]');
    expect(answer).toContain('не инвестиционная рекомендация');
  });

  it('честно говорит, что публикаций нет', () => {
    const answer = causeFactsAnswer({ dynamics: [], news: [], tickers: ['YDEX', 'VKCO'] });

    expect(answer).toContain(CAUSE_UNKNOWN);
    expect(answer).toContain('Публикаций по теме в доступных источниках нет (YDEX, VKCO)');
  });

  it('показывает источники, которые не удалось прочитать', () => {
    const messages = [
      new HumanMessage('почему вырос лукойл?'),
      new AIMessage({ content: '', tool_calls: [{ id: 'n1', name: 'news__search', args: { ticker: 'LKOH' } }] }),
      new ToolMessage({
        tool_call_id: 'n1',
        content: 'Новости LKOH за 30 дн.:\nновостей нет\nНедоступные источники: rbc, smartlab',
      }),
    ];

    expect(newsFailures(messages as never)).toEqual(['rbc, smartlab']);

    const answer = causeFactsAnswer({
      dynamics: [],
      news: newsItems(messages as never),
      tickers: ['LKOH'],
      failures: newsFailures(messages as never),
    });
    expect(answer).toContain('Не удалось прочитать: rbc, smartlab.');
  });
});
