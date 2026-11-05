import {
  createRbcQuoteSource,
  parseRbcQuote,
  RBC_QUOTE_SOURCE,
} from '../../src/news/sources/rbc-quote.js';
import {
  createTbankResearchSource,
  parseTbankResearch,
  TBANK_RESEARCH_SOURCE,
} from '../../src/news/sources/tbank-research.js';
import { jsonScriptsOf } from '../../src/parsing/html.js';

/** Минимальный слепок `__NEXT_DATA__` страницы РБК Инвестиций. */
const RBC_HTML = `<html><head><title>РБК</title></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      materials: {
        items: [
          {
            id: 'a1',
            header: 'Альфа-банк назвал акции с дивидендной доходностью выше ставки ЦБ',
            anons: '<p>Дивиденды <b>выше</b> ставки</p>',
            publishDate: 'Thu, 05 Nov 2026 19:39:46 +0300',
            url: 'https://www.rbc.ru/quote/news/a1',
            tickers: [{ title: 'SBER' }, { title: 'LKOH' }],
          },
          {
            id: 'a2',
            header: 'Утренняя сводка рынка',
            publishDate: 'Thu, 05 Nov 2026 08:00:00 +0300',
          },
        ],
      },
      newsfeed: {
        items: [
          {
            id: 'b1',
            titleOnMain: 'Индекс Мосбиржи обновил максимум',
            anons: 'Рынок растёт',
            publishDate: 'Thu, 05 Nov 2026 18:00:00 +0300',
            tickers: [],
          },
        ],
      },
    },
  },
})}</script>
</body></html>`;

/** Минимальный слепок SSR-состояния Tramvai страницы research. */
const TBANK_HTML = `<html><body>
<script>window.__TRAMVAI_INLINE_REPORTER = {};</script>
<script type="application/json">${JSON.stringify({
  'growth-research-portal@0.15.0': {
    stores: {
      tradingIdeas: {
        ideas: [
          {
            id: 4823,
            title: 'Татнефть — все еще фаворит сектора',
            date: '2026-10-29T17:48:06.417Z',
            description: '<p><strong>Драйверы</strong></p><p>дивиденд 55 ₽ на акцию</p>',
            tickers: [{ ticker: 'TATN' }],
          },
          {
            id: 4824,
            title: 'Яндекс: фундаментальщики продают, технари покупают',
            date: '2026-10-29T17:33:03.492Z',
            description: 'Тикер: #YDEX',
            tickers: [{ ticker: 'YDEX' }],
          },
        ],
      },
    },
  },
})}</script>
</body></html>`;

describe('источники-страницы вместо Telegram', () => {
  it('достаёт JSON из SSR-скриптов и пропускает битые блоки', () => {
    const values = jsonScriptsOf(
      '<script type="application/json">{"a":1}</script><script type="application/json">{битый}</script>',
    );

    expect(values).toEqual([{ a: 1 }]);
  });

  it('разбирает РБК Инвестиции: заголовок, дата, тикеры, аннотация', () => {
    const items = parseRbcQuote(RBC_HTML);

    expect(items.map((item) => item.title)).toEqual([
      'Альфа-банк назвал акции с дивидендной доходностью выше ставки ЦБ',
      'Индекс Мосбиржи обновил максимум',
    ]);
    const dividends = items[0];
    expect(dividends.source).toBe(RBC_QUOTE_SOURCE);
    expect(dividends.tags).toEqual(['SBER', 'LKOH']);
    expect(dividends.publishedAt).toBe('2026-11-05T16:39:46.000Z');
    expect(dividends.summary).toBe('Дивиденды выше ставки');
    // «Утренняя сводка» — дайджест, а не новость по рынку.
    expect(items.some((item) => item.title.includes('сводка'))).toBe(false);
  });

  it('фильтрует РБК по тикеру и по подстрокам', async () => {
    const source = createRbcQuoteSource({ fetchText: async () => RBC_HTML });

    const byTicker = await source.fetchNews({ tickers: ['LKOH'], pages: 1, maxItems: 10 });
    expect(byTicker.map((item) => item.title)).toEqual([
      'Альфа-банк назвал акции с дивидендной доходностью выше ставки ЦБ',
    ]);

    const byMatcher = await source.fetchNews({ matchers: ['мосбиржи'], pages: 1, maxItems: 10 });
    expect(byMatcher.map((item) => item.title)).toEqual(['Индекс Мосбиржи обновил максимум']);
  });

  it('разбирает идеи Т-Инвестиций: заголовок, дата, текст без HTML', () => {
    const items = parseTbankResearch(TBANK_HTML);

    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Татнефть — все еще фаворит сектора');
    expect(items[0].source).toBe(TBANK_RESEARCH_SOURCE);
    expect(items[0].tags).toEqual(['TATN']);
    expect(items[0].publishedAt).toBe('2026-10-29T17:48:06.417Z');
    expect(items[0].summary).toBe('Драйверы дивиденд 55 ₽ на акцию');
  });

  it('отдаёт идеи Т-Инвестиций по тикеру', async () => {
    const source = createTbankResearchSource({ fetchText: async () => TBANK_HTML });

    const items = await source.fetchNews({ tickers: ['YDEX'], pages: 1, maxItems: 10 });

    expect(items.map((item) => item.title)).toEqual([
      'Яндекс: фундаментальщики продают, технари покупают',
    ]);
  });

  it('на пустой странице возвращает пусто, а не бросает', () => {
    expect(parseRbcQuote('<html></html>')).toEqual([]);
    expect(parseTbankResearch('<html></html>')).toEqual([]);
  });
});
