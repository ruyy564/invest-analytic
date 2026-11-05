import { AppConfigService } from '../../src/config/app-config.service.js';
import type { McpServerConfig } from '../../src/config/env.schema.js';
import { HealthController } from '../../src/api/controllers/health.controller.js';
import { MultiServerMcpFactory } from '../../src/mcp/mcp-client.factory.js';
import { ALL_ACCOUNTS_TOOL } from '../../src/tools/portfolio-snapshot/portfolio-snapshot.service.js';
import { McpRegistryService } from '../../src/mcp/mcp-registry.service.js';
import { startTestMcpServer, type TestMcpServer } from '../fixtures/mcp-test-server.js';

describe('интеграция с MCP-сервером', () => {
  let server: TestMcpServer;
  let factory: MultiServerMcpFactory;
  let registry: McpRegistryService;
  let configService: AppConfigService;

  beforeAll(async () => {
    server = await startTestMcpServer();
    factory = new MultiServerMcpFactory();

    configService = {
      value: {
        llm: { provider: 'openai', model: 'gpt-4o-mini' },
        run: { toolMaxCalls: 40, deadlineMs: 90_000, mcpToolTimeoutMs: 15_000 },
        sources: {
          enabled: ['tinkoff'],
          keyRate: {
            mode: 'off',
            soapUrl: 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx',
            htmlUrl: 'https://www.cbr.ru/hd_base/KeyRate/',
            seedFile: 'data/key-rate-seed.json',
            cacheTtlHours: 24,
          },
          news: { ids: [], scanPages: 3, maxItems: 10 },
          taxKeywordsFile: 'data/tax-keywords.yaml',
        },
        state: { backend: 'memory', sqlitePath: ':memory:', ttlDays: 30 },
        mcp: {
          servers: [
            {
              name: 'tinkoff',
              url: server.url,
              transport: 'http',
              tlsMode: 'strict',
              allowedTools: [
                'invest_list_accounts',
                'invest_get_portfolio',
                'invest_get_positions',
              ],
            } satisfies McpServerConfig,
          ],
        },
      },
    } as unknown as AppConfigService;

    registry = new McpRegistryService(configService, factory.create);
    await registry.ensureInitialized();
  });

  afterAll(async () => {
    await factory.close();
    await server.close();
  });

  it('обнаруживает инструменты, отсекает торговые и добавляет неймспейс', () => {
    const names = registry.tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'tinkoff__invest_list_accounts',
        'tinkoff__invest_get_portfolio',
        'tinkoff__invest_get_positions',
        // Локальные инструменты приложения тоже отдаём модели.
        ALL_ACCOUNTS_TOOL,
        'portfolio__snapshot',
        'market__price_dynamics',
        'market__news_digest',
        'market__tax_watch',
      ]),
    );
    // Торговый инструмент из каталога не попадает в набор.
    expect(names).not.toContain('tinkoff__invest_create_order');
    expect(registry.serverStatuses[0]).toMatchObject({
      status: 'up',
      missingTools: [],
      unlistedTools: [],
    });
    expect(registry.isHealthy()).toBe(true);
  });

  it('отдаёт покрытие каталога в health', async () => {
    const health = new HealthController(registry, configService);
    const response = { status: () => undefined } as unknown as {
      status: (code: number) => void;
    };

    const body = await health.check(response as never);

    expect(body.status).toBe('ok');
    expect(body.components['mcp:tinkoff']).toEqual({
      status: 'up',
      details: 'инструментов: 3',
    });
  });

  it('вызывает инструмент портфеля через MCP и получает фикстуру', async () => {
    const tool = registry.tools.find((item) => item.name === 'tinkoff__invest_get_portfolio');
    expect(tool).toBeDefined();

    const result = await tool?.invoke({ accountId: 'acc-1' } as never);

    expect(JSON.stringify(result)).toContain('SBER');
  });

  it('возвращает доменную ошибку, если инструмент торговый', async () => {
    const names = registry.tools.map((tool) => tool.name);
    expect(names).not.toContain('tinkoff__invest_create_order');
  });
});
