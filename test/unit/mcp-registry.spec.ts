import { AppConfigService } from '../../src/config/app-config.service.js';
import type { McpServerConfig } from '../../src/config/env.schema.js';
import { McpRegistryService } from '../../src/tools/mcp-registry.service.js';
import { ALL_ACCOUNTS_TOOL } from '../../src/tools/portfolio-snapshot.js';
import { PRICE_DYNAMICS_TOOL } from '../../src/tools/price-dynamics.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

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
): AppConfigService =>
  ({
    value: {
      mcp: { servers },
      run: { toolMaxCalls: 40, deadlineMs: 90_000, mcpToolTimeoutMs: 15_000, ...run },
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
      ALL_ACCOUNTS_TOOL,
      PRICE_DYNAMICS_TOOL,
    ]);
    expect(registry.serverStatuses).toEqual([
      {
        name: 'tinkoff',
        status: 'up',
        tools: ['invest_get_portfolio', 'invest_get_positions'],
        missingTools: [],
      },
    ]);
    expect(registry.isHealthy()).toBe(true);
  });

  it('помечает недоступный сервер как down и не отдаёт его инструменты', async () => {
    const registry = new McpRegistryService(configStub([server()]), async () => {
      throw new Error('ECONNREFUSED');
    });

    await registry.ensureInitialized();

    // Инструментов MCP нет: остаются только локальные (сводка и динамика).
    expect(registry.tools.map((tool) => tool.name)).toEqual([ALL_ACCOUNTS_TOOL, PRICE_DYNAMICS_TOOL]);
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
