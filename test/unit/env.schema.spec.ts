import { ConfigError } from '../../src/config/config.error.js';
import { loadConfiguration } from '../../src/config/configuration.js';

const baseEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  LLM_PROVIDER: 'openai',
  LLM_MODEL: 'gpt-4o-mini',
  LLM_API_KEY: 'test-key',
  MCP_SERVERS: 'tinkoff',
  MCP_TINKOFF_URL: 'https://mcp.example.com/mcp',
  MCP_TINKOFF_ALLOWED_TOOLS: 'invest_list_accounts,invest_get_portfolio',
  ...overrides,
});

const loadIssues = (env: NodeJS.ProcessEnv): string[] => {
  try {
    loadConfiguration(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues;
  }
  throw new Error('ожидалась ошибка конфигурации');
};

describe('конфигурация окружения', () => {
  it('разворачивает MCP_SERVERS и подставляет значения по умолчанию', () => {
    const config = loadConfiguration(baseEnv());

    expect(config.mcp.servers).toEqual([
      {
        name: 'tinkoff',
        url: 'https://mcp.example.com/mcp',
        transport: 'http',
        token: undefined,
        allowedTools: ['invest_list_accounts', 'invest_get_portfolio'],
        tlsMode: 'strict',
        caFile: undefined,
      },
    ]);
    expect(config.state).toEqual({
      backend: 'sqlite',
      sqlitePath: './data/state.sqlite',
      ttlDays: 30,
    });
    expect(config.approvals.unlisted).toBe('require');
    expect(config.approvals.ttlMinutes).toBe(15);
    expect(config.langsmith.tracing).toBe(false);
    expect(config.app.logQuestionText).toBe(false);
  });

  it('подставляет лимиты прогона и шаблон отчёта по умолчанию', () => {
    const config = loadConfiguration(baseEnv());

    expect(config.run).toEqual({
      toolMaxCalls: 120,
      deadlineMs: 90_000,
      parallelism: 4,
      reviewMaxInstruments: 15,
      mcpToolTimeoutMs: 15_000,
      reviewEnabled: true,
    });
    expect(config.report.templateFile).toBe('reports/portfolio-review.yaml');
  });

  it('берёт лимиты прогона из окружения', () => {
    const config = loadConfiguration(
      baseEnv({
        RUN_TOOL_MAX_CALLS: '12',
        RUN_DEADLINE_MS: '45000',
        RUN_PARALLELISM: '2',
        REVIEW_MAX_INSTRUMENTS: '5',
        MCP_TOOL_TIMEOUT_MS: '3000',
        REVIEW_ENABLED: 'false',
      }),
    );

    expect(config.run).toEqual({
      toolMaxCalls: 12,
      deadlineMs: 45_000,
      parallelism: 2,
      reviewMaxInstruments: 5,
      mcpToolTimeoutMs: 3_000,
      reviewEnabled: false,
    });
  });

  it('отклоняет нечисловой лимит прогона', () => {
    const issues = loadIssues(baseEnv({ RUN_TOOL_MAX_CALLS: 'много' }));
    expect(issues.some((issue) => issue.includes('RUN_TOOL_MAX_CALLS'))).toBe(true);
  });

  it('отклоняет несуществующий файл шаблона отчёта', () => {
    const issues = loadIssues(baseEnv({ REPORT_TEMPLATE_FILE: './reports/нет-такого.yaml' }));
    expect(issues.some((issue) => issue.includes('REPORT_TEMPLATE_FILE'))).toBe(true);
  });

  it('не требует файла шаблона, когда разбор выключен', () => {
    const config = loadConfiguration(
      baseEnv({ REVIEW_ENABLED: 'false', REPORT_TEMPLATE_FILE: './reports/нет-такого.yaml' }),
    );
    expect(config.run.reviewEnabled).toBe(false);
  });

  it('подставляет источники данных по умолчанию', () => {
    const config = loadConfiguration(baseEnv());

    expect(config.sources).toEqual({
      enabled: ['tinkoff'],
      keyRate: {
        mode: 'live',
        soapUrl: 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx',
        htmlUrl: 'https://www.cbr.ru/hd_base/KeyRate/',
        seedFile: 'data/key-rate-seed.json',
        cacheTtlHours: 24,
      },
      news: {
        ids: ['interfax', 'rbc', 'smartlab'],
        scanPages: 3,
        maxItems: 10,
      },
      taxKeywordsFile: 'data/tax-keywords.yaml',
    });
  });

  it('принимает список источников из окружения, включая пустой', () => {
    expect(
      loadConfiguration(baseEnv({ SOURCES: 'tinkoff, cbr , interfax' })).sources.enabled,
    ).toEqual(['tinkoff', 'cbr', 'interfax']);
    expect(loadConfiguration(baseEnv({ SOURCES: '' })).sources.enabled).toEqual([]);
  });

  it('отклоняет KEY_RATE_SOURCE_MODE=seed без файла истории ставки', () => {
    const issues = loadIssues(
      baseEnv({
        SOURCES: 'tinkoff,cbr',
        KEY_RATE_SOURCE_MODE: 'seed',
        KEY_RATE_SEED_FILE: './data/нет-такого-сида.json',
      }),
    );
    expect(issues.some((issue) => issue.includes('KEY_RATE_SEED_FILE'))).toBe(true);
  });

  it('не требует сида, когда ставка выключена', () => {
    const config = loadConfiguration(
      baseEnv({
        SOURCES: 'tinkoff,cbr',
        KEY_RATE_SOURCE_MODE: 'off',
        KEY_RATE_SEED_FILE: './data/нет-такого-сида.json',
      }),
    );
    expect(config.sources.keyRate.mode).toBe('off');
  });

  it('отклоняет недопустимый режим ставки', () => {
    const issues = loadIssues(baseEnv({ KEY_RATE_SOURCE_MODE: 'fast' }));
    expect(issues.some((issue) => issue.includes('KEY_RATE_SOURCE_MODE'))).toBe(true);
  });

  it('подставляет модель ответа как модель классификации', () => {
    expect(loadConfiguration(baseEnv()).llm.routerModel).toBe('gpt-4o-mini');
  });

  it('использует LLM_ROUTER_MODEL, если он задан', () => {
    const config = loadConfiguration(baseEnv({ LLM_ROUTER_MODEL: 'cheap-model' }));
    expect(config.llm.routerModel).toBe('cheap-model');
    expect(config.llm.model).toBe('gpt-4o-mini');
  });

  it('требует креденшелы GigaChat при LLM_PROVIDER=gigachat', () => {
    const issues = loadIssues(baseEnv({ LLM_PROVIDER: 'gigachat', LLM_API_KEY: undefined }));
    expect(issues.join('\n')).toContain('GIGACHAT_CREDENTIALS');
  });

  it('требует LLM_API_KEY при LLM_PROVIDER=openai', () => {
    const issues = loadIssues(baseEnv({ LLM_API_KEY: undefined }));
    expect(issues.join('\n')).toContain('LLM_API_KEY');
  });

  it('требует LLM_BASE_URL для openai-compatible', () => {
    const issues = loadIssues(baseEnv({ LLM_PROVIDER: 'openai-compatible' }));
    expect(issues.join('\n')).toContain('LLM_BASE_URL');
  });

  it('требует URL для каждого MCP-сервера', () => {
    const issues = loadIssues(baseEnv({ MCP_TINKOFF_URL: '' }));
    expect(issues.join('\n')).toContain('MCP_TINKOFF_URL');
  });

  it('запрещает пустой allowlist', () => {
    const issues = loadIssues(baseEnv({ MCP_TINKOFF_ALLOWED_TOOLS: ' , ' }));
    expect(issues.join('\n')).toContain('MCP_TINKOFF_ALLOWED_TOOLS');
  });

  it('запрещает торговые и денежные инструменты в allowlist', () => {
    const issues = loadIssues(
      baseEnv({ MCP_TINKOFF_ALLOWED_TOOLS: 'invest_get_portfolio,invest_create_order' }),
    );
    expect(issues.join('\n')).toContain('invest_create_order');
  });

  it('проверяет допустимые значения STATE_BACKEND и APPROVAL_UNLISTED', () => {
    const issues = loadIssues(baseEnv({ STATE_BACKEND: 'postgres', APPROVAL_UNLISTED: 'maybe' }));
    const text = issues.join('\n');
    expect(text).toContain('STATE_BACKEND');
    expect(text).toContain('APPROVAL_UNLISTED');
  });

  it('требует LANGSMITH_API_KEY при включённой трассировке', () => {
    const issues = loadIssues(baseEnv({ LANGSMITH_TRACING: 'true' }));
    expect(issues.join('\n')).toContain('LANGSMITH_API_KEY');
  });

  it('сообщает обо всех проблемах сразу', () => {
    const issues = loadIssues(
      baseEnv({ LLM_API_KEY: undefined, MCP_TINKOFF_URL: '', APPROVAL_TTL_MINUTES: '0' }),
    );
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('запрещает дубликат сервера в MCP_SERVERS', () => {
    const issues = loadIssues(baseEnv({ MCP_SERVERS: 'tinkoff,tinkoff' }));
    expect(issues.join('\n')).toContain('указан дважды');
  });

  it('не печатает значения секретов в тексте ошибки', () => {
    const env = baseEnv({ MCP_TINKOFF_URL: '', MCP_TINKOFF_TOKEN: 'super-secret-token' });
    let message = '';
    try {
      loadConfiguration(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('MCP_TINKOFF_URL');
    expect(message).not.toContain('super-secret-token');
  });
});
