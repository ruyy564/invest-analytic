import {
  McpUnauthorizedError,
  RunBudgetExceededError,
  mapMcpError,
} from '../../src/tools/errors.js';
import {
  missingAllowedTools,
  namespaceTool,
  selectAllowedTools,
  wrapTool,
} from '../../src/tools/mcp-tool.adapter.js';
import { ToolBudget } from '../../src/tools/tool-budget.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

describe('адаптер инструментов MCP', () => {
  it('добавляет неймспейс сервера в имя', () => {
    expect(namespaceTool('tinkoff', 'invest_get_portfolio')).toBe(
      'tinkoff__invest_get_portfolio',
    );
  });

  it('фильтрует инструменты по allowlist и показывает отсутствующие', () => {
    const tools = [fakeTool('invest_get_portfolio'), fakeTool('invest_create_order')];

    expect(selectAllowedTools(tools, ['invest_get_portfolio']).map((tool) => tool.name)).toEqual([
      'invest_get_portfolio',
    ]);
    expect(
      missingAllowedTools(tools, ['invest_get_portfolio', 'invest_get_positions']),
    ).toEqual(['invest_get_positions']);
  });

  it('переназывает инструмент и передаёт вызов внутрь', async () => {
    const calls: unknown[] = [];
    const tool = fakeTool('invest_get_portfolio', async (input) => {
      calls.push(input);
      return 'портфель';
    });

    const wrapped = wrapTool(tool, { server: 'tinkoff', timeoutMs: 1000 });

    expect(wrapped.name).toBe('tinkoff__invest_get_portfolio');
    await expect(wrapped.invoke({ accountId: 'acc-1' } as never)).resolves.toBe('портфель');
    expect(calls).toHaveLength(1);
  });

  it('обрывает вызов по таймауту доменной ошибкой', async () => {
    const tool = fakeTool(
      'slow',
      () => new Promise((resolve) => setTimeout(() => resolve('поздно'), 50)),
    );
    const wrapped = wrapTool(tool, { server: 'tinkoff', timeoutMs: 5 });

    await expect(wrapped.invoke({} as never)).rejects.toMatchObject({ code: 'mcp_unavailable' });
  });

  it('маппит ошибку авторизации инструмента', async () => {
    const tool = fakeTool('secure', async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 });
    });
    const wrapped = wrapTool(tool, { server: 'tinkoff', timeoutMs: 1000 });

    await expect(wrapped.invoke({} as never)).rejects.toBeInstanceOf(McpUnauthorizedError);
  });

  it('учитывает бюджет вызовов и время прогона', async () => {
    const tool = wrapTool(fakeTool('fast'), {
      server: 'tinkoff',
      timeoutMs: 1000,
      budget: new ToolBudget({ maxCalls: 1, deadlineMs: 30_000 }),
    });

    await expect(tool.invoke({} as never)).resolves.toBe('ok');
    await expect(tool.invoke({} as never)).rejects.toBeInstanceOf(RunBudgetExceededError);

    const expired = wrapTool(fakeTool('fast'), {
      server: 'tinkoff',
      timeoutMs: 1000,
      budget: new ToolBudget({ maxCalls: 5, deadlineMs: 0 }),
    });
    await expect(expired.invoke({} as never)).rejects.toMatchObject({ code: 'run_budget_exceeded' });
  });

  it('сообщает о вызове для трейсинга', async () => {
    const events: unknown[] = [];
    const tool = wrapTool(fakeTool('fast'), {
      server: 'tinkoff',
      timeoutMs: 1000,
      onCall: (event) => events.push(event),
    });

    await tool.invoke({} as never);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tool: 'tinkoff__fast', ok: true });
  });
});

describe('маппинг ошибок MCP', () => {
  it('различает лимит запросов, авторизацию и недоступность', () => {
    expect(mapMcpError({ status: 429 }).code).toBe('mcp_rate_limited');
    expect(mapMcpError({ status: 401 }).code).toBe('mcp_unauthorized');
    expect(mapMcpError(new Error('fetch failed')).code).toBe('mcp_unavailable');
    expect(mapMcpError(new Error('что-то странное')).code).toBe('mcp_invalid_response');
  });

  it('не переупаковывает доменную ошибку', () => {
    const error = new McpUnauthorizedError();
    expect(mapMcpError(error)).toBe(error);
  });
});
