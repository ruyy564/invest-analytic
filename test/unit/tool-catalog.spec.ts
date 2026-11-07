import { join } from 'node:path';
import { createThematicTools } from '../../src/transports/mcp/local-tools.js';
import { createAllAccountsTool } from '../../src/capabilities/portfolio/tools/portfolio-snapshot/portfolio-snapshot.tool.js';
import { createPriceDynamicsTool } from '../../src/capabilities/instruments/tools/price-dynamics/price-dynamics.tool.js';
import { NewsRegistry } from '../../src/capabilities/news/news.registry.js';
import { NewsIndex, toStored } from '../../src/capabilities/news/store/news-index.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

const config = { timeoutMs: 100, scanPages: 1, maxItems: 5, taxKeywordsFile: 'data/tax-keywords.yaml' };

describe('каталог инструментов', () => {
  it('содержит фасады бумаг и новостей', () => {
    const tools = createThematicTools({
      newsRegistry: new NewsRegistry([]),
      byName: new Map(),
      config,
    });

    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'news__search',
        'market__news_digest',
        'instruments__find',
        'instruments__prices',
        'instruments__candles',
        'instruments__forecast',
        'instruments__dividends',
        'instruments__meta',
      ]),
    );
    // Старых двойников больше нет: имена не дублируются.
    expect(names.filter((name) => name === 'portfolio__snapshot')).toHaveLength(0);
  });

  it('сводка по счетам и динамика имеют по одному имени', async () => {
    const snapshotSource = [fakeTool('invest_get_portfolio', async () => 'portfolio')];
    const snapshot = createAllAccountsTool(snapshotSource, 'portfolio__snapshot', 100);

    const candlesSource = [fakeTool('invest_get_candles', async () => ({ candles: [] }))];
    const dynamics = createPriceDynamicsTool(candlesSource, 'market__price_dynamics', 100);

    expect(snapshot.name).toBe('portfolio__snapshot');
    expect(dynamics.name).toBe('market__price_dynamics');
    expect(await snapshot.invoke({})).toBeTruthy();
  });

  it('новостной фасад ищет бумагу по имени, а не только по тикеру', async () => {
    // В лентах «Лукойл», а не «LKOH»: без алиасов фильтр не находит ничего,
    // и на вопрос «почему вырос Лукойл» приходило «причина не установлена».
    const queries: { matchers?: string[]; tickers?: string[] }[] = [];
    const registry = new NewsRegistry([
      {
        id: 'test-feed',
        topics: ['news'],
        supportsMatcherQuery: true,
        fetchNews: async (query) => {
          queries.push({ matchers: query.matchers, tickers: query.tickers });
          return [
            {
              id: 'news-1',
              title: 'Лукойл вырос на фоне дорожающей нефти',
              summary: 'Brent поднялась выше 113 долларов за баррель',
              publishedAt: new Date().toISOString(),
              tags: [],
              source: 'test-feed',
            },
          ];
        },
      },
    ]);
    const tools = createThematicTools({
      newsRegistry: registry,
      byName: new Map(),
      config: {
        ...config,
        tickerAliasesFile: join(import.meta.dirname, '..', '..', 'data', 'ticker-aliases.yaml'),
      },
    });

    const search = tools.find((tool) => tool.name === 'news__search');
    const answer = String(await search?.invoke({ ticker: 'LKOH', days: 7, limit: 5 }));

    expect(queries[0]?.tickers).toEqual(['LKOH']);
    expect(queries[0]?.matchers).toEqual(expect.arrayContaining(['ЛУКОЙЛ']));
    expect(answer).toContain('Лукойл вырос');
    // Модель должна видеть содержание публикации, а не только заголовок.
    expect(answer).toContain('— Brent поднялась выше 113 долларов за баррель');
  });

  it('дочитывает статью целиком по ссылке', async () => {
    // Причины часто в тексте: заголовок «Лукойл вырос» сам по себе ничего не объясняет.
    const article =
      '<article><p>' +
      'Лукойл вырос на фоне дорожающей нефти и ожиданий дивидендов, санкции ослабли. '.repeat(6) +
      '</p></article>';
    const registry = new NewsRegistry([
      {
        id: 'test-feed',
        topics: ['news'],
        supportsMatcherQuery: true,
        fetchNews: async () => [
          {
            id: 'news-1',
            title: 'Лукойл вырос',
            url: 'https://example.com/news/1',
            publishedAt: new Date().toISOString(),
            tags: [],
            source: 'test-feed',
          },
        ],
      },
    ]);
    const tools = createThematicTools({
      newsRegistry: registry,
      byName: new Map(),
      config: {
        ...config,
        tickerAliasesFile: join(import.meta.dirname, '..', '..', 'data', 'ticker-aliases.yaml'),
        fetchText: async () => article,
      },
    });

    const search = tools.find((tool) => tool.name === 'news__search');
    const answer = String(
      await search?.invoke({ ticker: 'LKOH', days: 7, limit: 5, fullText: true }),
    );

    expect(answer).toContain('¶');
    expect(answer).toContain('санкции ослабли');
  });

  it('добавляет публикации по факторам бумаги', async () => {
    // Причина роста Лукойла — в новостях про нефть, где сама бумага не названа.
    const registry = new NewsRegistry([
      {
        id: 'test-feed',
        topics: ['news'],
        supportsMatcherQuery: true,
        fetchNews: async (query) => {
          const byTicker = (query.tickers ?? []).length > 0;
          return byTicker
            ? [
                {
                  id: 'n1',
                  title: 'Лукойл отчитался за квартал',
                  publishedAt: new Date().toISOString(),
                  tags: [],
                  source: 'test-feed',
                },
              ]
            : [
                {
                  id: 'n2',
                  title: 'Brent поднялась выше 113 долларов за баррель',
                  summary: 'Нефть дорожает третью неделю подряд',
                  publishedAt: new Date().toISOString(),
                  tags: [],
                  source: 'test-feed',
                },
              ];
        },
      },
    ]);
    const tools = createThematicTools({
      newsRegistry: registry,
      byName: new Map(),
      config: {
        ...config,
        tickerAliasesFile: join(import.meta.dirname, '..', '..', 'data', 'ticker-aliases.yaml'),
        profilesFile: join(import.meta.dirname, '..', '..', 'data', 'company-profiles.yaml'),
      },
    });

    const search = tools.find((tool) => tool.name === 'news__search');
    const answer = String(
      await search?.invoke({ ticker: 'LKOH', days: 30, limit: 5, factors: true }),
    );

    expect(answer).toContain('Факторы (');
    expect(answer).toContain('нефть и газ');
    expect(answer).toContain('Brent поднялась выше 113');
  });

  it('дополняет выдачу историей из индекса', async () => {
    // Ленты отдают только последние дни: старые публикации берём из индекса.
    const index = new NewsIndex(':memory:');
    index.save([
      toStored({
        id: 'old',
        title: 'Лукойл: разбор отчёта за полугодие',
        publishedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
        tags: [],
        source: 'archive',
      }, { tickers: ['LKOH'] }),
    ]);
    const registry = new NewsRegistry([
      {
        id: 'test-feed',
        topics: ['news'],
        supportsMatcherQuery: true,
        fetchNews: async () => [
          {
            id: 'fresh',
            title: 'Лукойл отчитался за квартал',
            publishedAt: new Date().toISOString(),
            tags: [],
            source: 'test-feed',
          },
        ],
      },
    ]);
    const tools = createThematicTools({
      newsRegistry: registry,
      byName: new Map(),
      config: {
        ...config,
        tickerAliasesFile: join(import.meta.dirname, '..', '..', 'data', 'ticker-aliases.yaml'),
        index,
      },
    });

    const search = tools.find((tool) => tool.name === 'news__search');
    const answer = String(await search?.invoke({ ticker: 'LKOH', days: 90, limit: 5 }));

    expect(answer).toContain('Лукойл отчитался за квартал');
    expect(answer).toContain('Лукойл: разбор отчёта за полугодие');
    index.close();
  });
});

describe('сбор по теме вопроса', () => {
  it('без тикера фильтрует новости по теме из вопроса', async () => {
    // «Новости по биткоину» без темы превращались в общую повестку.
    const queries: { matchers?: string[] }[] = [];
    const registry = new NewsRegistry([
      {
        id: 'crypto-feed',
        topics: ['news'],
        supportsMatcherQuery: true,
        fetchNews: async (query) => {
          queries.push({ matchers: query.matchers });
          return [
            {
              id: 'btc-1',
              title: 'Биткоин вырос до 76 000 долларов',
              summary: 'Криптовалюты отскочили после оттока из ETF',
              publishedAt: new Date().toISOString(),
              tags: [],
              source: 'crypto-feed',
            },
          ];
        },
      },
    ]);
    const tools = createThematicTools({
      newsRegistry: registry,
      byName: new Map(),
      config: { ...config, profilesFile: join(import.meta.dirname, '..', '..', 'data', 'company-profiles.yaml') },
    });

    const search = tools.find((tool) => tool.name === 'news__search');
    const answer = String(
      await search?.invoke({ days: 7, limit: 5, focus: 'какие новости по биткоину?' }),
    );

    expect(queries[0]?.matchers).toEqual(expect.arrayContaining(['биткоин']));
    expect(answer).toContain('Биткоин вырос до 76 000 долларов');
  });
});


