import { createFeedSource, parseFeed } from '../../src/news/sources/feed.js';
import { stripMarkup } from '../../src/parsing/feed.js';
import { FEED_DEFAULTS, feedUrl } from '../../src/news/sources/defaults.js';
import { createSmartLabTagSource } from '../../src/news/sources/smartlab-tag.js';
import { isDigestTitle } from '../../src/news/news.filters.js';
import { dedupeKey, mergeNews, NewsRegistry } from '../../src/news/news.registry.js';
import type { NewsSourceAdapter, SourceItem } from '../../src/news/news.types.js';
import { mapNews } from '../../src/news/sources/tinkoff.js';
import { collectNewsDigest, formatNewsDigest } from '../../src/tools/news-digest/news-digest.service.js';

const RSS = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>
<item><title>Сбербанк отчитался за квартал</title><link>https://a/1</link>
<description><![CDATA[<p>Чистая прибыль выросла</p>]]></description>
<category>Экономика</category><pubDate>Wed, 04 Nov 2026 10:00:00 +0300</pubDate>
<guid>1</guid></item>
<item><title>Ставка ЦБ: что изменится</title><link>https://a/2</link>
<description>Налоговые нюансы</description><pubDate>Tue, 03 Nov 2026 09:00:00 +0300</pubDate></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Газпром: дивиденды</title><link href="https://b/1"/><updated>2026-11-02T09:00:00Z</updated>
<summary>Кратко</summary><category term="Рынок"/></entry></feed>`;

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  id: 'id',
  title: 'Заголовок',
  publishedAt: new Date().toISOString(),
  tags: [],
  source: 'test',
  ...overrides,
});

describe('адаптер лент', () => {
  it('разбирает RSS: заголовок, ссылка, аннотация, теги, дата', () => {
    const items = parseFeed(RSS, { format: 'rss', source: 'interfax' });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Сбербанк отчитался за квартал',
      url: 'https://a/1',
      summary: 'Чистая прибыль выросла',
      tags: ['Экономика'],
      source: 'interfax',
    });
    expect(items[0].publishedAt).toBe(new Date('2026-11-04T07:00:00Z').toISOString());
  });

  it('разбирает Atom: ссылка из атрибута href', () => {
    const items = parseFeed(ATOM, { format: 'atom', source: 'rbc' });

    expect(items[0]).toMatchObject({ title: 'Газпром: дивиденды', url: 'https://b/1' });
  });

  it('отклоняет HTML вместо XML и пустую ленту', () => {
    expect(() =>
      parseFeed('<html><body>нет ленты</body></html>', { format: 'rss', source: 'x' }),
    ).toThrow(/HTML/);
    expect(() => parseFeed('<rss><channel></channel></rss>', { format: 'rss', source: 'x' })).toThrow(
      /нет элементов/,
    );
  });

  it('оставляет элементы только за период и сортирует новые сверху', async () => {
    const source = createFeedSource({
      id: 'interfax',
      url: 'https://feed',
      format: 'rss',
      fetchText: async () => RSS,
    });

    const fresh = await source.fetchNews({ pages: 1, maxItems: 10, sinceDays: 1 });
    const all = await source.fetchNews({ pages: 1, maxItems: 10 });

    expect(all).toHaveLength(2);
    expect(all[0].publishedAt >= all[1].publishedAt).toBe(true);
    expect(fresh.length).toBeLessThanOrEqual(1);
  });

  it('убирает разметку и раскрывает сущности', () => {
    expect(stripMarkup('<p>A &amp; B</p>')).toBe('A & B');
  });
});

describe('слияние источников', () => {
  it('дедуплицирует по ссылке и сохраняет приоритет источника', () => {
    const merged = mergeNews([
      { source: 'interfax', items: [item({ id: '1', url: 'https://a/1', source: 'interfax' })] },
      { source: 'rbc', items: [item({ id: '2', url: 'https://a/1', source: 'rbc' })] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('interfax');
    expect(dedupeKey(merged[0])).toBe('https://a/1');
  });

  it('не прерывает сводку при отказе одного источника и пишет покрытие', async () => {
    const ok: NewsSourceAdapter = {
      id: 'ok',
      topics: ['news'],
      fetchNews: async () => [item({ url: 'https://ok/1', source: 'ok' })],
    };
    const broken: NewsSourceAdapter = {
      id: 'broken',
      topics: ['news'],
      fetchNews: async () => {
        throw new Error('HTTP 500');
      },
    };

    const digest = await new NewsRegistry([broken, ok]).newsDigest({ pages: 1, maxItems: 5 });

    expect(digest.items).toHaveLength(1);
    expect(digest.coverage).toEqual([
      { source: 'broken', status: 'missing', reason: 'HTTP 500' },
      { source: 'ok', status: 'ok', items: 1 },
    ]);
  });

  it('фильтрует источники по теме', () => {
    const news: NewsSourceAdapter = { id: 'n', topics: ['news'], fetchNews: async () => [] };
    const tax: NewsSourceAdapter = { id: 't', topics: ['tax'], fetchNews: async () => [] };
    const registry = new NewsRegistry([news, tax]);

    expect(registry.newsSourcesFor('news').map((source) => source.id)).toEqual(['n']);
    expect(registry.newsSourcesFor('tax').map((source) => source.id)).toEqual(['t']);
  });
});

describe('новости брокера', () => {
  it('превращает ответ инструмента в элементы с источником и курсором', () => {
    const { items, nextCursor } = mapNews(
      {
        items: [
          { id: '10', title: 'Заголовок', content: 'Текст новости', ts: '2026-11-04T10:00:00Z' },
        ],
        nextCursor: '9',
      },
      'tinkoff',
    );

    expect(items[0]).toMatchObject({ id: '10', title: 'Заголовок', source: 'tinkoff' });
    expect(nextCursor).toBe('9');
  });
});

describe('сводка новостей по периодам', () => {
  it('раскладывает новости по четырём периодам', async () => {
    const now = new Date('2026-11-04T12:00:00Z');
    const source: NewsSourceAdapter = {
      id: 'interfax',
      topics: ['news'],
      fetchNews: async () => [
        item({ title: 'Акции выросли сегодня', publishedAt: '2026-11-04T09:00:00Z', url: 'https://n/1' }),
        item({ title: 'Акции выросли месяц назад', publishedAt: '2026-10-10T09:00:00Z', url: 'https://n/2' }),
      ],
    };

    const result = await collectNewsDigest(new NewsRegistry([source]), {
      pages: 1,
      maxItems: 5,
      now,
    });

    expect(result.periods.map((period) => period.id)).toEqual([
      'fresh',
      'week',
      'month',
      'half_year',
    ]);
    expect(result.periods[0].items.map((entry) => entry.title)).toEqual(['Акции выросли сегодня']);
    expect(result.periods[2].items.map((entry) => entry.title)).toEqual([
      'Акции выросли сегодня',
      'Акции выросли месяц назад',
    ]);
    expect(formatNewsDigest(result)).toContain('Новости свежие:');
  });

  it('общая лента отбрасывает неинвестиционный мусор', async () => {
    const source: NewsSourceAdapter = {
      id: 'tass',
      topics: ['news'],
      supportsMatcherQuery: true,
      fetchNews: async () => [
        item({ title: 'В АдГ заявили, что визиты Зеленского дорого обходятся немцам', source: 'tass' }),
        item({ title: 'В МЧС назвали причину трагедии с гибелью альпинистов', source: 'tass' }),
        item({ title: 'Более 570 тыс. человек участвовали в акциях всеобщей забастовки', source: 'tass' }),
        item({ title: 'Мировой суд Москвы взыскал с агентства более 80 тыс. рублей', source: 'tass' }),
        item({ title: 'Индекс Мосбиржи вырос на 1,2 %', source: 'tass' }),
      ],
    };

    const result = await collectNewsDigest(new NewsRegistry([source]), {
      pages: 1,
      maxItems: 5,
      now: new Date('2026-11-04T12:00:00Z'),
    });

    expect(result.periods[0].items.map((entry) => entry.title)).toEqual([
      'Индекс Мосбиржи вырос на 1,2 %',
    ]);
  });
});

describe('новости по бумагам', () => {
  it('не смешивает общую ленту с новостями по тикеру', async () => {
    // Общая лента не умеет искать по бумаге: при запросе по тикеру её не берём.
    const general: NewsSourceAdapter = {
      id: 'rbc',
      topics: ['news'],
      supportsTickerQuery: false,
      fetchNews: async () => [item({ title: 'Спорт и политика', source: 'rbc' })],
    };
    const broker: NewsSourceAdapter = {
      id: 'tinkoff',
      topics: ['news'],
      supportsTickerQuery: true,
      fetchNews: async (query) =>
        query.tickers?.length ? [item({ title: `Новость ${query.tickers[0]}`, source: 'tinkoff' })] : [],
    };
    const registry = new NewsRegistry([general, broker]);

    const byTicker = await registry.newsDigest({ tickers: ['SBER'], pages: 1, maxItems: 10 });
    expect(byTicker.items.map((entry) => entry.title)).toEqual(['Новость SBER']);

    const generalDigest = await registry.newsDigest({ pages: 1, maxItems: 10 });
    expect(generalDigest.items.map((entry) => entry.title)).toEqual(['Спорт и политика']);
  });

describe('лента smart-lab по тикеру', () => {
  const RSS_BY_TICKER: Record<string, string> = {
    PLZL: `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Полюс: рост выручки на фоне снижения прибыли</title>
        <description>Разбор отчётности золотодобытчика</description>
        <pubDate>Wed, 04 Nov 2026 10:00:00 +0300</pubDate></item>
      <item><title>Неделя на рынке: итоги и прогнозы</title>
        <description>Общий обзор</description>
        <pubDate>Tue, 03 Nov 2026 10:00:00 +0300</pubDate></item>
    </channel></rss>`,
    SBER: `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Дал трём ИИ по миллиону</title>
        <description>Личный пост без отношения к бумаге</description>
        <pubDate>Wed, 04 Nov 2026 09:00:00 +0300</pubDate></item>
    </channel></rss>`,
  };

  const source = createSmartLabTagSource({
    fetchText: async (url) => {
      const ticker = url.split('/').pop() ?? '';
      return RSS_BY_TICKER[ticker] ?? '<rss><channel></channel></rss>';
    },
  });

  it('запрашивает ленту по тикеру и отбрасывает общие посты', async () => {
    const items = await source.fetchNews({
      tickers: ['PLZL'],
      matchers: ['PLZL', 'Полюс'],
      pages: 1,
      maxItems: 10,
    });

    expect(items.map((entry) => entry.title)).toEqual([
      'Полюс: рост выручки на фоне снижения прибыли',
    ]);
    expect(items[0]?.source).toBe('smartlab');
  });

  it('не подставляет бумаге посты, где её нет в тексте', async () => {
    const items = await source.fetchNews({
      tickers: ['SBER'],
      matchers: ['SBER', 'Сбер'],
      pages: 1,
      maxItems: 10,
    });

    expect(items).toEqual([]);
  });

  it('без тикеров лента не читается', async () => {
    expect(await source.fetchNews({ pages: 1, maxItems: 10 })).toEqual([]);
  });
});

describe('шумовые заголовки', () => {
  it('отбрасывает общие сводки и оставляет новости по бумаге', () => {
    expect(isDigestTitle('Утренняя сводка новостей от БКС')).toBe(true);
    expect(isDigestTitle('Неделя на рынке: Трамп против санкций')).toBe(true);
    expect(isDigestTitle('Корпоративные события на предстоящей неделе')).toBe(true);
    expect(isDigestTitle('Итоги торгов акциями на Мосбирже')).toBe(true);
    expect(isDigestTitle('Полюс: рост выручки на фоне снижения прибыли')).toBe(false);
    expect(isDigestTitle('Лукойл (LKOH): высокие дивиденды впереди')).toBe(false);
  });
});

describe('ленты по умолчанию', () => {
  it('не использует Telegram: деловые ленты читаются напрямую', () => {
    expect(FEED_DEFAULTS.vedomosti.url).toBe('https://www.vedomosti.ru/rss/news');
    expect(FEED_DEFAULTS.kommersant.url).toContain('kommersant.ru/RSS');
    expect(FEED_DEFAULTS.tass.url).toContain('tass.ru/rss/v2.xml');
    expect(FEED_DEFAULTS.finam.url).toContain('finam.ru');
    // Каналы брокеров приходят со страниц research/quote, а не через мост.
    expect(FEED_DEFAULTS.bcs).toBeUndefined();
    expect(FEED_DEFAULTS.tbank).toBeUndefined();
    expect(FEED_DEFAULTS.rbc_news).toBeUndefined();
  });

  it('адрес ленты переопределяется переменной NEWS_<ID>_URL', () => {
    const env = { NEWS_VEDOMOSTI_URL: 'https://mirror.example/feed' } as NodeJS.ProcessEnv;

    expect(feedUrl(FEED_DEFAULTS.vedomosti, env)).toBe('https://mirror.example/feed');
    expect(feedUrl(FEED_DEFAULTS.vedomosti, {} as NodeJS.ProcessEnv)).toBe(
      FEED_DEFAULTS.vedomosti.url,
    );
  });

  it('фильтрует ленту по подстрокам бумаги: тикер и название', async () => {
    const source = createFeedSource({
      id: 'finam',
      url: 'https://example/feed',
      format: 'rss',
      fetchText: async () => RSS,
    });

    const byName = await source.fetchNews({ matchers: ['Сбер'], pages: 1, maxItems: 10 });
    expect(byName.map((entry) => entry.title)).toEqual(['Сбербанк отчитался за квартал']);

    const byNothing = await source.fetchNews({
      matchers: ['Полюс'],
      pages: 1,
      maxItems: 10,
    });
    expect(byNothing).toEqual([]);
  });
});

});
