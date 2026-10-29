import { AIMessage } from '@langchain/core/messages';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { AgentRunnerService } from '../../src/agent/agent-runner.service.js';
import { LLM_ANSWER_MODEL, LLM_ROUTER_MODEL } from '../../src/llm/llm.module.js';
import { MCP_CLIENT_FACTORY } from '../../src/tools/mcp-registry.service.js';
import { ScriptedChatModel, type ScriptedStep } from '../fixtures/fake-chat-model.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';
import { ACCOUNTS_FIXTURE, PORTFOLIO_FIXTURE } from '../fixtures/mcp-test-server.js';

const TEST_ENV: NodeJS.ProcessEnv = {
  LLM_PROVIDER: 'openai',
  LLM_MODEL: 'gpt-test',
  LLM_API_KEY: 'test-key',
  MCP_SERVERS: 'tinkoff',
  MCP_TINKOFF_URL: 'https://mcp.example.com/mcp',
  MCP_TINKOFF_ALLOWED_TOOLS: 'invest_list_accounts,invest_get_portfolio,invest_get_positions',
  STATE_BACKEND: 'memory',
  LANGSMITH_TRACING: 'false',
};

const toolCall = (id: string) =>
  new AIMessage({
    content: '',
    tool_calls: [{ id, name: 'tinkoff__invest_get_portfolio', args: { accountId: 'acc-1' } }],
  });

/** Роутер в тесте: метка зависит от вопроса, поэтому число вызовов модели не важно. */
class IntentAwareModel extends ScriptedChatModel {
  protected override async _generate(
    messages: Parameters<ScriptedChatModel['_generate']>[0],
  ): ReturnType<ScriptedChatModel['_generate']> {
    const question =
      messages
        .filter((message) => (message as { _getType?: () => string })._getType?.() === 'human')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .at(-1) ?? '';
    const intent = /погода|налог|новост/i.test(question) ? 'off_topic' : 'portfolio';
    return { generations: [{ text: intent, message: new AIMessage(intent) }] };
  }
}

/** Записывает входные сообщения, чтобы проверить, что модели приходят данные инструментов. */
class RecordingModel extends ScriptedChatModel {
  readonly inputs: string[] = [];

  protected override async _generate(
    messages: Parameters<ScriptedChatModel['_generate']>[0],
  ): ReturnType<ScriptedChatModel['_generate']> {
    this.inputs.push(messages.map((message) => JSON.stringify(message.content)).join('\n'));
    return super._generate(messages);
  }
}

interface Harness {
  runner: AgentRunnerService;
  toolCalls: () => number;
  modelInputs: () => string[];
}

/** Каждый сценарий — своё приложение и свой сценарий ответов модели. */
const createHarness = async (answerSteps: ScriptedStep[]): Promise<Harness> => {
  let calls = 0;
  const answerModel = new RecordingModel(answerSteps);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_ROUTER_MODEL)
    .useValue(new IntentAwareModel([]))
    .overrideProvider(LLM_ANSWER_MODEL)
    .useValue(answerModel)
    .overrideProvider(MCP_CLIENT_FACTORY)
    .useValue(async () => [
      fakeTool('invest_list_accounts', async () => ACCOUNTS_FIXTURE),
      fakeTool('invest_get_portfolio', async () => {
        calls += 1;
        return PORTFOLIO_FIXTURE;
      }),
      fakeTool('invest_get_positions', async () => ({ positions: PORTFOLIO_FIXTURE.positions })),
    ])
    .compile();

  return { runner: moduleRef.get(AgentRunnerService), toolCalls: () => calls, modelInputs: () => answerModel.inputs };
};

describe('граф агента с подтверждением', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    Object.assign(process.env, TEST_ENV);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('вопрос не по теме завершается отказом без вызова инструментов', async () => {
    const { runner, toolCalls } = await createHarness(['ответ не используется']);

    const result = await runner.run('какая погода в Москве?', 's-off-topic');

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('off_topic');
    expect(result.answer).toContain('показываю только состав');
    expect(toolCalls()).toBe(0);
  });

  it('портфель читается только после подтверждения', async () => {
    const { runner, toolCalls, modelInputs } = await createHarness([
      toolCall('call-1'),
      'В портфеле: SBER 100 шт., итог 152345.67 RUB.',
    ]);

    const awaiting = await runner.run('что у меня в портфеле?', 's-approve');
    expect(awaiting.status).toBe('awaiting_approval');
    expect(awaiting.approval?.actions[0]).toMatchObject({ tool: 'tinkoff__invest_get_portfolio' });
    expect(toolCalls()).toBe(0);

    const result = await runner.resume('s-approve', { approved: true });
    expect(result.status).toBe('completed');
    expect(result.answer).toContain('SBER');
    expect(toolCalls()).toBe(1);

    // Модель получает данные инструмента, а не «свободный» ответ.
    const lastInput = modelInputs().at(-1) ?? '';
    expect(lastInput).toContain('294.55');
    expect(lastInput).toContain('152345.67');
  });

  it('при отказе данные не читаются', async () => {
    const { runner, toolCalls } = await createHarness([
      toolCall('call-1'),
      'Данные портфеля не читал: вы отклонили запрос.',
    ]);

    const awaiting = await runner.run('покажи портфель', 's-decline');
    expect(awaiting.status).toBe('awaiting_approval');

    const result = await runner.resume('s-decline', { approved: false });

    expect(result.status).toBe('completed');
    expect(result.answer).toContain('не читал');
    expect(toolCalls()).toBe(0);
  });

  it('повторный вопрос в той же сессии снова требует подтверждения', async () => {
    const { runner } = await createHarness([
      toolCall('call-1'),
      'Портфель: SBER.',
      toolCall('call-2'),
    ]);

    const first = await runner.run('портфель?', 's-strict');
    expect(first.status).toBe('awaiting_approval');
    await runner.resume('s-strict', { approved: true });

    const second = await runner.run('и ещё раз портфель', 's-strict');
    expect(second.status).toBe('awaiting_approval');
  });
});
