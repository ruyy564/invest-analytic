import {
  McpUnauthorizedError,
  RunBudgetExceededError,
  mapMcpError,
} from '../../src/transports/mcp/errors.js';
import {
  missingAllowedTools,
  namespaceTool,
  selectAllowedTools,
  wrapTool,
} from '../../src/transports/mcp/mcp-tool.adapter.js';
import { ToolBudget } from '../../src/transports/mcp/tool-budget.js';
import { toolSchemaFrom, toZodV3 } from '../../src/transports/mcp/tool-schema.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

describe('JSON Schema -> zod 3', () => {
  it('делает обязательные поля обязательными, а остальные опциональными', () => {
    const schema = toZodV3(
      toolSchemaFrom(
        JSON.stringify({
          type: 'object',
          properties: {
            accountId: { type: 'string', description: 'Идентификатор счёта' },
            limit: { type: 'integer' },
          },
          required: ['accountId'],
        }),
      ),
    );

    expect(schema.safeParse({ accountId: 'acc-1' }).success).toBe(true);
    expect(schema.safeParse({ accountId: 'acc-1', limit: 5 }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ accountId: 42 }).success).toBe(false);
  });

  it('поддерживает enum, массивы, вложенные объекты и пустые схемы', () => {
    const schema = toZodV3({
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['OPEN', 'CLOSED'] },
        tags: { type: 'array', items: { type: 'string' } },
        filter: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
      required: ['status'],
    });

    expect(schema.safeParse({ status: 'OPEN', tags: ['a'], filter: { name: 'x' } }).success).toBe(true);
    expect(schema.safeParse({ status: 'OTHER' }).success).toBe(false);
    expect(schema.safeParse({ status: 'OPEN', filter: {} }).success).toBe(false);
    expect(toZodV3({ type: 'object' }).safeParse({ any: 'value' }).success).toBe(true);
  });

  it('разбирает схему из строки и переживает мусор', () => {
    expect(toolSchemaFrom('{"type":"object"}')).toEqual({ type: 'object' });
    expect(toolSchemaFrom('not json')).toEqual({ type: 'object', properties: {} });
    expect(toZodV3(undefined).safeParse({}).success).toBe(true);
  });

  it('принимает объединения через anyOf', () => {
    const schema = toZodV3({ anyOf: [{ type: 'string' }, { type: 'number' }] });

    expect(schema.safeParse('text').success).toBe(true);
    expect(schema.safeParse(1).success).toBe(true);
    expect(schema.safeParse(true).success).toBe(false);
  });
});

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

  it('ведёт отдельный бюджет на прогон по thread_id', async () => {
    const budgets = new Map<string, ToolBudget>();
    const tool = wrapTool(fakeTool('fast'), {
      server: 'tinkoff',
      timeoutMs: 1000,
      budgetFor: (sessionId) => (sessionId ? budgets.get(sessionId) : undefined),
    });
    budgets.set('s1', new ToolBudget({ maxCalls: 2, deadlineMs: 30_000 }));

    const config = { configurable: { thread_id: 's1' } } as never;
    await expect(tool.invoke({} as never, config)).resolves.toBe('ok');
    await expect(tool.invoke({} as never, config)).resolves.toBe('ok');
    await expect(tool.invoke({} as never, config)).rejects.toMatchObject({
      code: 'run_budget_exceeded',
    });

    // У другой сессии свой бюджет.
    budgets.set('s2', new ToolBudget({ maxCalls: 2, deadlineMs: 30_000 }));
    await expect(
      tool.invoke({} as never, { configurable: { thread_id: 's2' } } as never),
    ).resolves.toBe('ok');
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
