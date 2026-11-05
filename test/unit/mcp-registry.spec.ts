import { AppConfigService } from '../../src/config/app-config.service.js';
import type { McpServerConfig } from '../../src/config/env.schema.js';
import {
  MARKET_DYNAMICS_TOOL,
  McpRegistryService,
  PORTFOLIO_SNAPSHOT_TOOL,
} from '../../src/mcp/mcp-registry.service.js';
import { ALL_ACCOUNTS_TOOL } from '../../src/tools/portfolio-snapshot/portfolio-snapshot.service.js';
import { NEWS_DIGEST_TOOL } from '../../src/tools/news-digest/news-digest.service.js';
import { PRICE_DYNAMICS_TOOL } from '../../src/tools/price-dynamics/price-dynamics.tool.js';
import { TAX_WATCH_TOOL } from '../../src/tools/tax-watch/tax-watch.service.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

/** Локальные инструменты, которые всегда добавляются к каталогу сервера. */
const LOCAL_TOOLS_EXPECTED = [
  PORTFOLIO_SNAPSHOT_TOOL,
  ALL_ACCOUNTS_TOOL,
  MARKET_DYNAMICS_TOOL,
  PRICE_DYNAMICS_TOOL,
  NEWS_DIGEST_TOOL,
  TAX_WATCH_TOOL,
];

const server = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  name: 'tinkoff',
  url: 'https://mcp.example.com/mcp',
  transport: 'http',
  token: 'secret-token',
  allowedTools: ['invest_get_portfolio', 'invest_get_positions'],
  ...overrides,
});

const configStub = (
  servers: McpServerConfig[],
  run: Partial<{ toolMaxCalls: number; deadlineMs: number; mcpToolTimeoutMs: number }> = {},
  sources: Partial<{ enabled: string[]; keyRateMode: 'live' | 'seed' | 'off'; newsIds: string[] }> = {},
): AppConfigService =>
  ({
    value: {
      mcp: { servers },
      run: { toolMaxCalls: 40, deadlineMs: 90_000, mcpToolTimeoutMs: 15_000, ...run },
      sources: {
        enabled: sources.enabled ?? ['tinkoff'],
        keyRate: {
          mode: sources.keyRateMode ?? 'off',
          soapUrl: 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx',
          htmlUrl: 'https://www.cbr.ru/hd_base/KeyRate/',
          seedFile: 'data/key-rate-seed.json',
          cacheTtlHours: 24,
        },
        news: { ids: sources.newsIds ?? [], scanPages: 3, maxItems: 10 },
        taxKeywordsFile: 'data/tax-keywords.yaml',
      },
      state: { backend: 'memory', sqlitePath: ':memory:', ttlDays: 30 },
    },
  }) as unknown as AppConfigService;

describe('реестр MCP-серверов', () => {
  it('берёт лимиты бюджета прогона из конфигурации', () => {
    const registry = new McpRegistryService(
      configStub([server()], { toolMaxCalls: 2, deadlineMs: 60_000 }),
      async () => [],
    );

    const budget = registry.createBudget();
    expect(budget.hasCallsLeft()).toBe(true);
    budget.registerCall();
    budget.registerCall();
    expect(budget.hasCallsLeft()).toBe(false);
    expect(budget.isExpired()).toBe(false);
  });

  it('оставляет только разрешённые инструменты и добавляет неймспейс', async () => {
    const registry = new McpRegistryService(configStub([server()]), async () => [
      fakeTool('invest_get_portfolio'),
      fakeTool('invest_get_positions'),
      fakeTool('invest_create_order'),
    ]);

    await registry.ensureInitialized();

    expect(registry.tools.map((tool) => tool.name)).toEqual([
      'tinkoff__invest_get_portfolio',
      'tinkoff__invest_get_positions',
      ...LOCAL_TOOLS_EXPECTED,
    ]);
    expect(registry.serverStatuses).toEqual([
      {
        name: 'tinkoff',
        status: 'up',
        tools: ['invest_get_portfolio', 'invest_get_positions'],
        missingTools: [],
        unlistedTools: [],
      },
    ]);
    expect(registry.isHealthy()).toBe(true);
  });

  it('сообщает о read-only инструментах каталога, не попавших в allowlist', async () => {
    const registry = new McpRegistryService(configStub([server()]), async () => [
      fakeTool('invest_get_portfolio'),
      fakeTool('invest_get_positions'),
      fakeTool('invest_get_news'),
      fakeTool('invest_create_order'),
    ]);

    await registry.ensureInitialized();

    // Новости — read-only, но в allowlist их нет; торговую заявку не считаем.
    expect(registry.serverStatuses[0]).toMatchObject({
      missingTools: [],
      unlistedTools: ['invest_get_news'],
    });
  });

  it('помечает недоступный сервер как down и не отдаёт его инструменты', async () => {
    const registry = new McpRegistryService(configStub([server()]), async () => {
      throw new Error('ECONNREFUSED');
    });

    await registry.ensureInitialized();

    // Инструментов MCP нет: остаются только локальные (сводка, динамика, тематические).
    expect(registry.tools.map((tool) => tool.name)).toEqual([...LOCAL_TOOLS_EXPECTED]);
    expect(registry.serverStatuses[0]).toMatchObject({ name: 'tinkoff', status: 'down' });
    expect(registry.isHealthy()).toBe(false);
  });

  it('запоминает инструменты из allowlist, которых нет в каталоге', async () => {
    const registry = new McpRegistryService(configStub([server()]), async () => [
      fakeTool('invest_get_portfolio'),
    ]);

    await registry.ensureInitialized();

    expect(registry.serverStatuses[0]?.missingTools).toEqual(['invest_get_positions']);
  });

  it('подключает несколько серверов независимо', async () => {
    const registry = new McpRegistryService(
      configStub([
        server(),
        server({ name: 'news', url: 'https://news.example.com/mcp', allowedTools: ['search'] }),
      ]),
      async (item) => {
        if (item.name === 'news') {
          throw new Error('timeout');
        }
        return [fakeTool('invest_get_portfolio'), fakeTool('invest_get_positions')];
      },
    );

    await registry.ensureInitialized();

    expect(registry.tools.map((tool) => tool.name)).toContain('tinkoff__invest_get_portfolio');
    expect(registry.serverStatuses.map((status) => status.status)).toEqual(['up', 'down']);
    expect(registry.isHealthy()).toBe(false);
  });

  it('выдаёт бюджет прогона из конфигурации', () => {
    const registry = new McpRegistryService(configStub([server()]), async () => []);

    const budget = registry.createBudget();

    expect(budget.remainingMs()).toBeLessThanOrEqual(90_000);
    expect(budget.hasCallsLeft()).toBe(true);
  });
});
