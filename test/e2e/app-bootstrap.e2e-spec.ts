import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { AppConfigService } from '../../src/platform/config/app-config.service.js';

const TEST_ENV: NodeJS.ProcessEnv = {
  LLM_PROVIDER: 'openai',
  LLM_MODEL: 'gpt-4o-mini',
  LLM_API_KEY: 'test-key',
  MCP_SERVERS: 'tinkoff',
  MCP_TINKOFF_URL: 'https://mcp.example.com/mcp',
  MCP_TINKOFF_ALLOWED_TOOLS: 'invest_list_accounts,invest_get_portfolio,invest_get_positions',
  STATE_BACKEND: 'memory',
  LANGSMITH_TRACING: 'false',
};

describe('AppModule', () => {
  let app: INestApplication;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env = originalEnv;
  });

  it('инициализируется без обращений к внешним системам', () => {
    const config = app.get(AppConfigService).value;

    expect(config.llm.provider).toBe('openai');
    expect(config.mcp.servers.map((server) => server.name)).toEqual(['tinkoff']);
    expect(config.state.backend).toBe('memory');
  });

  it('не стартует при некорректной конфигурации', async () => {
    const brokenEnv = { ...TEST_ENV, LLM_PROVIDER: 'gigachat', LLM_API_KEY: '' };
    const saved = { ...process.env };
    Object.assign(process.env, { ...brokenEnv, GIGACHAT_CREDENTIALS: '' });

    await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow(
      /GIGACHAT_CREDENTIALS/,
    );

    process.env = saved;
  });
});
