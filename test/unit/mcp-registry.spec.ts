import { AppConfigService } from '../../src/config/app-config.service.js';
import type { McpServerConfig } from '../../src/config/env.schema.js';
import { McpRegistryService } from '../../src/tools/mcp-registry.service.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

const server = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  name: 'tinkoff',
  url: 'https://mcp.example.com/mcp',
  transport: 'http',
  token: 'secret-token',
  allowedTools: ['invest_get_portfolio', 'invest_get_positions'],
  ...overrides,
});

const configStub = (servers: McpServerConfig[]): AppConfigService =>
  ({ value: { mcp: { servers } } }) as unknown as AppConfigService;

describe('реестр MCP-серверов', () => {
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

    expect(registry.tools).toEqual([]);
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

  it('выдаёт бюджет прогона на 8 вызовов и 30 секунд', () => {
    const registry = new McpRegistryService(configStub([server()]), async () => []);

    const budget = registry.createBudget();

    expect(budget.remainingMs()).toBeLessThanOrEqual(30_000);
    expect(budget.hasCallsLeft()).toBe(true);
  });
});
