import { createThematicTools } from '../../src/mcp/local-tools.js';
import { createAllAccountsTool } from '../../src/tools/portfolio-snapshot/portfolio-snapshot.tool.js';
import { createPriceDynamicsTool } from '../../src/tools/price-dynamics/price-dynamics.tool.js';
import { NewsRegistry } from '../../src/news/news.registry.js';
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
});

