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
