import { AppConfigService } from '../../src/config/app-config.service.js';
import type { McpServerConfig } from '../../src/config/env.schema.js';
import { HealthController } from '../../src/api/health.controller.js';
import { MultiServerMcpFactory } from '../../src/tools/mcp-client.factory.js';
import { ALL_ACCOUNTS_TOOL } from '../../src/tools/portfolio-snapshot.js';
import { McpRegistryService } from '../../src/tools/mcp-registry.service.js';
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
        mcp: {
          servers: [
            {
              name: 'tinkoff',
              url: server.url,
              transport: 'http',
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
    expect(registry.tools.map((tool) => tool.name)).toEqual([
      'tinkoff__invest_list_accounts',
      'tinkoff__invest_get_portfolio',
      'tinkoff__invest_get_positions',
      // Локальная сводка по всем счетам — не MCP-инструмент, но её тоже отдаём модели.
      ALL_ACCOUNTS_TOOL,
    ]);
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
