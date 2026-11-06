import { createThematicTools } from '../../src/mcp/local-tools.js';
import { createAllAccountsTool } from '../../src/tools/portfolio-snapshot/portfolio-snapshot.tool.js';
import { createPriceDynamicsTool } from '../../src/tools/price-dynamics/price-dynamics.tool.js';
import { NewsRegistry } from '../../src/news/news.registry.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

const config = { timeoutMs: 100, scanPages: 1, maxItems: 5, taxKeywordsFile: 'data/tax-keywords.yaml' };

describe('каталог инструментов и совместимость имён', () => {
  it('содержит фасады бумаг и новостей рядом со старыми именами', () => {
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
  });

  it('старые имена snapshot и динамики остаются рабочими', async () => {
    const source = [fakeTool('invest_get_portfolio', async () => 'portfolio')];
    const snapshot = createAllAccountsTool(source, 'portfolio__snapshot', 100);
    const legacySnapshot = createAllAccountsTool(source, 'portfolio_all_accounts', 100);

    expect(await snapshot.invoke({})).toBeTruthy();
    expect(await legacySnapshot.invoke({})).toBeTruthy();
    expect(snapshot.name).not.toBe(legacySnapshot.name);
  });

  it('старое имя динамики цены сохранено как отдельный инструмент', () => {
    const source = [fakeTool('invest_get_candles', async () => ({ candles: [] }))];
    const legacy = createPriceDynamicsTool(source, 'price_dynamics', 100);

    expect(legacy.name).toBe('price_dynamics');
  });
});
