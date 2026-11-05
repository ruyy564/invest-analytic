import { AIMessage } from '@langchain/core/messages';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { AgentRunnerService } from '../../src/agent/agent-runner.service.js';
import { LLM_ANSWER_MODEL, LLM_ROUTER_MODEL } from '../../src/llm/llm.module.js';
import { MCP_CLIENT_FACTORY } from '../../src/mcp/mcp-registry.service.js';
import { ReportStoreService } from '../../src/state/report-store.service.js';
import { ScriptedChatModel, type ScriptedStep } from '../fixtures/fake-chat-model.js';
import { e2eToolCatalog, E2E_ALLOWED_TOOLS } from '../fixtures/e2e-catalog.js';
import { ACCOUNTS_FIXTURE, PORTFOLIO_FIXTURE } from '../fixtures/mcp-test-server.js';

const TEST_ENV: NodeJS.ProcessEnv = {
  LLM_PROVIDER: 'openai',
  LLM_MODEL: 'gpt-test',
  LLM_API_KEY: 'test-key',
  MCP_SERVERS: 'tinkoff',
  MCP_TINKOFF_URL: 'https://mcp.example.com/mcp',
  MCP_TINKOFF_ALLOWED_TOOLS: E2E_ALLOWED_TOOLS,
  STATE_BACKEND: 'memory',
  LANGSMITH_TRACING: 'false',
  // Внешние источники выключены: e2e не должен ходить в сеть.
  SOURCES: 'tinkoff',
  NEWS_SOURCES: '',
  KEY_RATE_SOURCE_MODE: 'off',
};

const toolCall = (id: string) =>
  new AIMessage({
    content: '',
    tool_calls: [{ id, name: 'tinkoff__invest_get_portfolio', args: { accountId: 'acc-1' } }],
  });

/** Роутер в тесте: метка зависит от вопроса, поэтому число вызовов модели не важно. */
class IntentAwareModel extends ScriptedChatModel {
  override async _generate(
    messages: Parameters<ScriptedChatModel['_generate']>[0],
  ): ReturnType<ScriptedChatModel['_generate']> {
    const question =
      messages
        .filter((message) => (message as { _getType?: () => string })._getType?.() === 'human')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .at(-1) ?? '';
    const intent = /погода|политик/i.test(question)
      ? 'off_topic'
      : /проанализируй|разбер|диверсифик/i.test(question)
        ? 'portfolio_review'
        : 'data_lookup';
    return { generations: [{ text: intent, message: new AIMessage(intent) }] };
  }
}

/** Записывает входные сообщения, чтобы проверить, что модели приходят данные инструментов. */
class RecordingModel extends ScriptedChatModel {
  readonly inputs: string[] = [];

  override async _generate(
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
  moduleRef: Awaited<ReturnType<typeof Test.createTestingModule>['compile']>;
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
    .useValue(async () =>
      e2eToolCatalog({
        invest_get_portfolio: () => {
          calls += 1;
          return PORTFOLIO_FIXTURE;
        },
      }),
    )
    .compile();

  return {
    runner: moduleRef.get(AgentRunnerService),
    toolCalls: () => calls,
    modelInputs: () => answerModel.inputs,
    moduleRef,
  };
};

void ACCOUNTS_FIXTURE;


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
    expect(result.answer).toContain('вне моей компетенции');
    expect(toolCalls()).toBe(0);
  });

  it('вопрос о возможностях отвечает справкой без данных и подтверждения', async () => {
    const { runner, toolCalls } = await createHarness(['ответ модели не используется']);

    const result = await runner.run('что ты умеешь?', 's-help');

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('agent_help');
    expect(result.approval).toBeUndefined();
    expect(result.answer).toContain('Что умею');
    expect(result.answer).toContain('Портфель и счета');
    expect(result.answer).toContain('Новости рынка');
    // Справка не собирает данные и не создаёт отчёт.
    expect(result.report).toBeUndefined();
    expect(result.partial).toBe(false);
    expect(toolCalls()).toBe(0);
  });

  it('справочный вопрос о понятии отвечает из базы знаний без данных', async () => {
    const { runner, toolCalls } = await createHarness(['ответ модели не используется']);

    const result = await runner.run('что такое диверсификация?', 's-knowledge');

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('knowledge_question');
    expect(result.approval).toBeUndefined();
    expect(result.answer).toContain('Диверсификация');
    expect(result.answer).toContain('Источник:');
    // Данные брокера для справочного ответа не нужны, отчёт не создаётся.
    expect(result.report).toBeUndefined();
    expect(result.partial).toBe(false);
    expect(toolCalls()).toBe(0);
  });

  it('вопрос про новости рынка отвечает сводкой без подтверждения', async () => {
    const { runner, toolCalls } = await createHarness(['ответ модели не используется']);

    const result = await runner.run('какие последние новости в мире инвестиций?', 's-news');

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('market_news');
    // Подтверждение не запрашивается: публичные новости, не данные счёта.
    expect(result.approval).toBeUndefined();
    expect(result.answer).toContain('Новости инвестиционного рынка');
    // Пустые окна больше не печатаются: при одной нерелевантной новости ответ
    // честно говорит, что инвестиционных публикаций нет.
    expect(result.answer).toMatch(/Сегодня|За выбранный период/);
    expect(result.answer).toContain('Источники: tinkoff — получено');
    expect(result.report).toMatchObject({ type: 'market_news' });
    // Портфель не читается: ни одного вызова инструментов моделью.
    expect(toolCalls()).toBe(0);
  });

  it('портфель читается только после подтверждения', async () => {
    const { runner, toolCalls } = await createHarness([
      toolCall('call-1'),
      'В портфеле: SBER 100 шт., итог 152345.67 RUB.',
    ]);

    const awaiting = await runner.run('что у меня в портфеле?', 's-approve');
    expect(awaiting.status).toBe('awaiting_approval');
    // Сводку по всем счетам собирает локальный инструмент — одно подтверждение на прогон.
    expect(awaiting.approval?.actions[0]).toMatchObject({ tool: 'portfolio_all_accounts' });
    expect(toolCalls()).toBe(0);

    const result = await runner.resume('s-approve', { approved: true });
    expect(result.status).toBe('completed');
    expect(result.answer).toContain('SBER');
    // Цифры берутся из ответа брокера: 294.55 ₽ × 100 шт.
    expect(result.answer).toContain('294,55');
    expect(toolCalls()).toBe(1);
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

  it('повторный вопрос о разборе в той же сессии снова требует подтверждения', async () => {
    const { runner } = await createHarness([
      'macro: ставка 14 % (оценка).\nverdict: совет — добрать облигации.',
    ]);

    const first = await runner.run('проанализируй мой портфель', 's-strict');
    expect(first.status).toBe('awaiting_approval');
    await runner.resume('s-strict', { approved: true });

    const second = await runner.run('и ещё раз разбери портфель', 's-strict');
    expect(second.status).toBe('awaiting_approval');
  });

  it('разбор портфеля: один запрос подтверждения, отчёт по шаблону и сохранённый reportId', async () => {
    const { runner, moduleRef } = await createHarness([
      'macro: ставка 14 % (оценка).\nverdict: совет — добрать облигации.',
    ]);

    const awaiting = await runner.run('проанализируй мой портфель', 's-review');
    expect(awaiting.status).toBe('awaiting_approval');
    expect(awaiting.approval?.question).toContain('разбора портфеля');
    expect(awaiting.approval?.actions[0]?.args).toMatchObject({ requests: expect.any(Number) });

    const result = await runner.resume('s-review', { approved: true });

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('portfolio_review');
    expect(result.report?.type).toBe('deep_review');
    expect(result.report?.coverage.some((entry) => entry.status === 'ok')).toBe(true);
    expect(result.answer).toContain('## Состав портфеля');
    expect(result.answer).toContain('SBER');
    // Сектор взят из справочника активов, а не «не определён».
    expect(result.answer).toContain('финансы');
    expect(result.answer).toContain('совет — добрать облигации');

    const stored = moduleRef
      .get(ReportStoreService)
      .get(result.report && 'reportId' in result.report ? result.report.reportId : '', 'default');
    expect(stored?.markdown).toContain('## Итог: диверсификация и стратегия');
    expect(stored?.templateVersion).toBe(2);
  });

  it('«стоит ли покупать Сбер» — это разбор бумаги, а не динамика цены', async () => {
    const { runner, toolCalls } = await createHarness([
      'Сбер: цена и прогноз ниже; решение — оценка, не рекомендация.',
    ]);

    const awaiting = await runner.run('стоит ли покупать Сбер?', 's-decision');

    expect(awaiting.status).toBe('awaiting_approval');
    expect(awaiting.intent).toBe('portfolio_review');
    expect(awaiting.scope).toBe('instrument');
    expect(awaiting.scopeTarget).toBe('SBER');
    // Портфель не читается: подтверждение относится к разбору бумаги.
    expect(toolCalls()).toBe(0);

    const result = await runner.resume('s-decision', { approved: true });

    expect(result.status).toBe('completed');
    expect(result.answer).toContain('Разбор бумаги SBER');
    expect(result.answer).toContain('цена за 1 шт.');
    expect(result.answer).toContain('финансы');
    expect(result.answer).toContain('Справочный контекст');
    // Ответ не должен быть одной строкой динамики за период.
    expect(result.answer).not.toContain('Динамика SBER за');
  });
});
