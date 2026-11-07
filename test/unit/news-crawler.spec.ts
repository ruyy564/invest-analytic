import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NewsRegistry } from '../../src/capabilities/news/news.registry.js';
import { NewsIndex } from '../../src/capabilities/news/store/news-index.js';
import { NewsCrawlerService } from '../../src/transports/mcp/news-crawler.service.js';

const NOW = new Date('2026-11-07T10:00:00Z');

/** Источник-лента: одна свежая публикация про нефть — типичная причина роста. */
const feed = () => ({
  id: 'test-feed',
  topics: ['news'],
  supportsMatcherQuery: true,
  fetchNews: async () => [
    {
      id: '1',
      title: 'Нефть Brent подорожала на фоне снятия санкций',
      summary: 'Цены на нефть выросли третью неделю подряд',
      publishedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      tags: [],
      source: 'test-feed',
    },
  ],
});

const build = (enabled = true, watchlistFile?: string) => {
  const index = new NewsIndex(':memory:');
  const registry = new NewsRegistry([feed() as never]);
  const config = {
    value: {
      sources: {
        news: {
          scanPages: 1,
          crawlerMaxItems: 10,
          indexTtlDays: 30,
          crawlerEnabled: enabled,
          crawlerIntervalMin: 15,
          watchlistFile,
        },
        companyProfilesFile: 'data/company-profiles.yaml',
        tickerAliasesFile: 'data/ticker-aliases.yaml',
      },
    },
  };
  const service = new NewsCrawlerService(config as never, {
    ensureInitialized: async () => undefined,
    index,
    news: registry,
  } as never);
  return { service, index };
};

describe('фоновый сбор новостей', () => {
  it('складывает общую повестку и факторы в индекс', async () => {
    const { service, index } = build();

    const saved = await service.collectOnce(NOW);

    expect(saved).toBeGreaterThan(0);
    expect(index.size()).toBe(1);
    expect(index.search({ keywords: ['нефть'] }, NOW)).toHaveLength(1);
    index.close();
  });

  it('собирает новости по бумагам из watchlist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crawler-'));
    const file = join(dir, 'watchlist.yaml');
    writeFileSync(file, '- LKOH\n');
    const { service, index } = build(true, file);

    await service.collectOnce(NOW);

    const byTicker = index.search({ tickers: ['LKOH'] }, NOW);
    expect(byTicker).toHaveLength(1);
    expect(byTicker[0].tickers).toContain('LKOH');
    index.close();
  });

  it('без индекса и источников ничего не делает', async () => {
    const service = new NewsCrawlerService(
      { value: { sources: { news: {} } } } as never,
      { ensureInitialized: async () => undefined, index: undefined, news: undefined } as never,
    );

    expect(await service.collectOnce(NOW)).toBe(0);
  });

  it('по флагу не запускает сбор', () => {
    const { service, index } = build(false);

    service.onModuleInit();
    service.onModuleDestroy();

    expect(index.size()).toBe(0);
    index.close();
  });
});
