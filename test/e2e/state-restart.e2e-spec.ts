import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { AIMessage } from '@langchain/core/messages';
import { AppModule } from '../../src/app.module.js';
import { AgentRunnerService } from '../../src/agent/agent-runner.service.js';
import { LLM_ANSWER_MODEL, LLM_ROUTER_MODEL } from '../../src/llm/llm.module.js';
import { MCP_CLIENT_FACTORY } from '../../src/tools/mcp-registry.service.js';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';
import { ACCOUNTS_FIXTURE, PORTFOLIO_FIXTURE } from '../fixtures/mcp-test-server.js';

const toolCall = () =>
  new AIMessage({
    content: '',
    tool_calls: [
      { id: 'restart-call', name: 'tinkoff__invest_get_portfolio', args: { accountId: 'acc-1' } },
    ],
  });

const createRunner = async (
  answerSteps: (string | AIMessage)[],
): Promise<{ runner: AgentRunnerService; close: () => Promise<void> }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_ROUTER_MODEL)
    .useValue(new ScriptedChatModel(['portfolio', 'portfolio']))
    .overrideProvider(LLM_ANSWER_MODEL)
    .useValue(new ScriptedChatModel(answerSteps))
    .overrideProvider(MCP_CLIENT_FACTORY)
    .useValue(async () => [
      fakeTool('invest_list_accounts', async () => ACCOUNTS_FIXTURE),
      fakeTool('invest_get_portfolio', async () => PORTFOLIO_FIXTURE),
      fakeTool('invest_get_positions', async () => ({ positions: PORTFOLIO_FIXTURE.positions })),
    ])
    .compile();

  return { runner: moduleRef.get(AgentRunnerService), close: () => moduleRef.close() };
};

describe('состояние переживает перезапуск', () => {
  const originalEnv = { ...process.env };
  const sqlitePath = join(mkdtempSync(join(tmpdir(), 'restart-')), 'state.sqlite');

  beforeAll(() => {
    Object.assign(process.env, {
      LLM_PROVIDER: 'openai',
      LLM_MODEL: 'gpt-test',
      LLM_API_KEY: 'test-key',
      MCP_SERVERS: 'tinkoff',
      MCP_TINKOFF_URL: 'https://mcp.example.com/mcp',
      MCP_TINKOFF_ALLOWED_TOOLS: 'invest_list_accounts,invest_get_portfolio,invest_get_positions',
      STATE_BACKEND: 'sqlite',
      STATE_SQLITE_PATH: sqlitePath,
      LANGSMITH_TRACING: 'false',
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('подтверждение, отправленное после рестарта, продолжает прогон', async () => {
    const first = await createRunner([toolCall(), 'Портфель: SBER после перезапуска.']);
    const awaiting = await first.runner.run('что у меня в портфеле?', 'restart-session');
    expect(awaiting.status).toBe('awaiting_approval');
    await first.close();

    const second = await createRunner(['Портфель: SBER после перезапуска.']);
    const result = await second.runner.resume('restart-session', { approved: true });

    expect(result.status).toBe('completed');
    expect(String(result.answer)).toContain('SBER');
    await second.close();
  });
});
