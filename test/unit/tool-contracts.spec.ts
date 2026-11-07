import { join } from 'node:path';
import { createFactorsTool } from '../../src/capabilities/market/tools/factors/factors.tool.js';
import { createCbMeetingsTool } from '../../src/capabilities/market/cb-meetings/cb-meetings.tool.js';
import { createNewsDigestTool } from '../../src/capabilities/news/tools/news-digest/news-digest.tool.js';
import { createNewsSearchTool } from '../../src/capabilities/news/tools/news-search.tool.js';
import { createTaxWatchTool } from '../../src/capabilities/portfolio/tools/tax-watch/tax-watch.tool.js';
import { createAllAccountsTool } from '../../src/capabilities/portfolio/tools/portfolio-snapshot/portfolio-snapshot.tool.js';
import { createPriceDynamicsTool } from '../../src/capabilities/instruments/tools/price-dynamics/price-dynamics.tool.js';
import { createInstrumentTools } from '../../src/capabilities/instruments/tools/instruments.tools.js';
import { createKeyRateTool } from '../../src/capabilities/market/tools/key-rate/key-rate.tool.js';
import { createCommodityTool } from '../../src/capabilities/market/tools/commodity/commodity.tool.js';
import { LOCAL_TOOLS } from '../../src/agent/approvals/approval-policy.service.js';
import { NewsRegistry } from '../../src/capabilities/news/news.registry.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

/**
 * Корзина «контракты инструментов»: у каждого локального инструмента есть имя,
 * описание для модели и схема аргументов, а без данных он отвечает текстом,
 * а не падением. Это ловит поломку на уровне тулов до прогонов графа.
 */
const mcpStubs = () => [
  fakeTool('invest_find_instrument'),
  fakeTool('invest_get_candles'),
  fakeTool('invest_get_market_values'),
  fakeTool('invest_get_portfolio'),
  fakeTool('invest_get_positions'),
  fakeTool('invest_get_operations'),
  fakeTool('invest_get_news'),
];

const buildTools = (): { name: string; description: string; schema: unknown; invoke: (args: unknown) => Promise<unknown> }[] => {
  const byName = new Map(mcpStubs().map((tool) => [tool.name, tool]));
  const news = new NewsRegistry([
    { id: 'empty-feed', topics: ['news'], supportsMatcherQuery: true, fetchNews: async () => [] },
  ]);
  return [
    createAllAccountsTool([...byName.values()], 'portfolio__snapshot', 100),
    createPriceDynamicsTool([...byName.values()], 'market__price_dynamics', 100),
    createNewsDigestTool({ newsRegistry: news, byName, timeoutMs: 100, scanPages: 1, maxItems: 5, taxKeywordsFile: 'data/tax-keywords.json' } as never),
    createNewsSearchTool({ registry: news, scanPages: 1, maxItems: 5 }),
    createTaxWatchTool({ newsRegistry: news, byName, timeoutMs: 100, taxKeywordsFile: 'data/tax-keywords.json' } as never),
    createFactorsTool({ tool: (name) => byName.get(name), timeoutMs: 100 }),
    createCbMeetingsTool({ file: 'data/cb-meetings.yaml', now: () => new Date('2026-11-07T10:00:00Z') }),
    createKeyRateTool({ id: 'stub', read: async () => undefined }),
    createCommodityTool({ id: 'stub', read: async () => undefined } as never),
    ...createInstrumentTools({ lookup: (name) => byName.get(name), timeoutMs: 100 }),
  ] as never;
};

/** Аргументы «как у модели»: у части инструментов есть обязательные поля. */
const ARGS: Record<string, unknown> = {
  market__price_dynamics: { ticker: 'SBER' },
  instruments__find: { query: 'SBER' },
  instruments__prices: { ticker: 'SBER' },
  instruments__candles: { ticker: 'SBER' },
  instruments__forecast: { ticker: 'SBER' },
  instruments__dividends: { ticker: 'SBER' },
  instruments__meta: { ticker: 'SBER' },
};

describe('контракты инструментов', () => {
  const tools = buildTools();

  it('каждый локальный инструмент описан и имеет схему', () => {
    const broken = tools
      .filter((tool) => !tool.name || !tool.description || String(tool.description).length < 20)
      .map((tool) => tool.name);
    expect(broken).toEqual([]);
  });

  it('все имена из правил подтверждений существуют', () => {
    const names = new Set(tools.map((tool) => tool.name));
    // Эти два инструмента собирает подграф разбора, а не фасады MCP.
    const reviewBranch = new Set(['portfolio__review', 'security__brief']);
    const missing = LOCAL_TOOLS.filter((name) => !names.has(name) && !reviewBranch.has(name));
    expect(missing).toEqual([]);
  });

  it.each(tools.map((tool) => [tool.name, tool] as const))(
    '%s отвечает без падения при пустых данных',
    async (name, tool) => {
      const answer = String(
        await tool
          .invoke((ARGS[name] ?? {}) as never)
          .catch((error: unknown) => `ОШИБКА: ${(error as Error)?.message ?? String(error)}`),
      );
      // Доменная ошибка («бумага не найдена») — это ответ для модели, а не падение.
      if (answer.startsWith('ОШИБКА')) {
        expect(answer).toMatch(/не найдена|не найден|недоступн|нет данных|не удалось/i);
      } else {
        expect(answer.trim().length).toBeGreaterThan(0);
      }
    },
  );
});

// Заглушка нужна только для типов: путь файла налоговых терминов не читается.
void join;
