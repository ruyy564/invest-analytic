import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AIMessage } from '@langchain/core/messages';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { ApprovalFlowService } from '../../src/agent/approval-flow.service.js';
import { LLM_ANSWER_MODEL, LLM_ROUTER_MODEL } from '../../src/llm/llm.module.js';
import { MCP_CLIENT_FACTORY } from '../../src/tools/mcp-registry.service.js';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';
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
  SOURCES: 'tinkoff',
  NEWS_SOURCES: '',
  KEY_RATE_SOURCE_MODE: 'off',
};

const toolCall = (id = 'call-1') =>
  new AIMessage({
    content: '',
    tool_calls: [
      { id, name: 'tinkoff__invest_get_portfolio', args: { accountId: 'acc-1' } },
    ],
  });

/** Сценарий ответов с запасом: приложение в тестах общее, прогонов несколько. */
const answerScript = Array.from({ length: 10 }).flatMap((_, index) => [
  toolCall(`call-${index}`),
  'В портфеле: SBER 100 шт., итог 152345.67 RUB.',
]);

class CountingRouter extends ScriptedChatModel {
  calls = 0;

  override async _generate(
    messages: Parameters<ScriptedChatModel['_generate']>[0],
  ): ReturnType<ScriptedChatModel['_generate']> {
    this.calls += 1;
    const question =
      messages
        .filter((message) => (message as { _getType?: () => string })._getType?.() === 'human')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .at(-1) ?? '';
    const intent = /погода|политик/i.test(question) ? 'off_topic' : 'data_lookup';
    return { generations: [{ text: intent, message: new AIMessage(intent) }] };
  }
}

interface Harness {
  app: INestApplication;
  router: CountingRouter;
}

const createApp = async (factory: () => Promise<unknown>): Promise<Harness> => {
  const router = new CountingRouter([]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_ROUTER_MODEL)
    .useValue(router)
    .overrideProvider(LLM_ANSWER_MODEL)
    .useValue(new ScriptedChatModel(answerScript))
    .overrideProvider(MCP_CLIENT_FACTORY)
    .useValue(factory)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  return { app, router };
};

const toolsFactory = async () =>
  e2eToolCatalog({
    invest_list_accounts: async () => ACCOUNTS_FIXTURE,
    invest_get_portfolio: async () => PORTFOLIO_FIXTURE,
  });

describe('HTTP API', () => {
  let app: INestApplication;
  let router: CountingRouter;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    ({ app, router } = await createApp(toolsFactory));
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  it('отклоняет пустой и слишком длинный вопрос без вызова модели', async () => {
    const empty = await request(app.getHttpServer())
      .post('/api/v1/agent/chat')
      .send({ message: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(empty.body.error.requestId).toBeTruthy();

    const long = await request(app.getHttpServer())
      .post('/api/v1/agent/chat')
      .send({ message: 'а'.repeat(2001) });
    expect(long.status).toBe(400);
    expect(router.calls).toBe(0);
  });

  it('возвращает 202 и запрос подтверждения на вопрос о портфеле', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/agent/chat')
      .send({ message: 'что у меня в портфеле?' });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ status: 'awaiting_approval', intent: 'data_lookup' });
    expect(response.body.sessionId).toBeTruthy();
    expect(response.body.approval.actions[0]).toMatchObject({
      tool: 'portfolio_all_accounts',
    });
    expect(JSON.stringify(response.body)).not.toContain('test-key');
  });

  it('после подтверждения возвращает 200 с ответом', async () => {
    const local = await createApp(toolsFactory);

    const awaiting = await request(local.app.getHttpServer())
      .post('/api/v1/agent/chat')
      .send({ message: 'портфель?' });

    expect(awaiting.status).toBe(202);
    expect(local.app.get(ApprovalFlowService).hasPending(awaiting.body.sessionId)).toBe(true);

    const response = await request(local.app.getHttpServer())
      .post('/api/v1/agent/chat/approve')
      .send({ sessionId: awaiting.body.sessionId, approved: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'completed', intent: 'data_lookup' });
    expect(String(response.body.answer)).toContain('SBER');

    await local.app.close();
  });

  it('отвечает 409, если сессия не ждёт подтверждения', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/agent/chat/approve')
      .send({ sessionId: randomUUID(), approved: true });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NOT_AWAITING_APPROVAL');
  });

  it('после отказа данные не читаются и приходит 200', async () => {
    const local = await createApp(toolsFactory);

    const awaiting = await request(local.app.getHttpServer())
      .post('/api/v1/agent/chat')
      .send({ message: 'портфель?' });

    const response = await request(local.app.getHttpServer())
      .post('/api/v1/agent/chat/approve')
      .send({ sessionId: awaiting.body.sessionId, approved: false });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('completed');
    await local.app.close();
  });

  it('отвечает 410, если срок подтверждения истёк', async () => {
    const local = await createApp(toolsFactory);

    const awaiting = await request(local.app.getHttpServer())
      .post('/api/v1/agent/chat')
      .send({ message: 'портфель?' });

    local.app
      .get(ApprovalFlowService)
      .markRequested(awaiting.body.sessionId, new Date(Date.now() - 3_600_000));

    const response = await request(local.app.getHttpServer())
      .post('/api/v1/agent/chat/approve')
      .send({ sessionId: awaiting.body.sessionId, approved: true });

    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('APPROVAL_EXPIRED');
    expect(response.body.error).not.toHaveProperty('stack');

    await local.app.close();
  });

  it('отдаёт health со статусом компонентов', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.components['mcp:tinkoff']).toMatchObject({ status: 'up' });
    expect(response.body.components.llm).toMatchObject({ status: 'up' });
  });

  it('отдаёт 503, если MCP недоступен', async () => {
    const broken = await createApp(async () => {
      throw new Error('ECONNREFUSED');
    });

    const response = await request(broken.app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(503);
    expect(response.body.components['mcp:tinkoff']).toMatchObject({ status: 'down' });
    await broken.app.close();
  });

  it('пустой портфель: 202 с подтверждением, затем 200 с пустым составом', async () => {
    const emptyPortfolio = { ...PORTFOLIO_FIXTURE, positions: [], totalAmountPortfolio: undefined };
    const local = await createApp(async () =>
      e2eToolCatalog({
        invest_list_accounts: async () => ACCOUNTS_FIXTURE,
        invest_get_portfolio: async () => emptyPortfolio,
        invest_get_positions: async () => ({ securities: [], money: [] }),
      }),
    );

    const awaiting = await request(local.app.getHttpServer())
      .post('/api/v1/agent/chat')
      .send({ message: 'что у меня в портфеле?' });

    expect(awaiting.status).toBe(202);
    expect(awaiting.body.status).toBe('awaiting_approval');

    const response = await request(local.app.getHttpServer())
      .post('/api/v1/agent/chat/approve')
      .send({ sessionId: awaiting.body.sessionId, approved: true });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('completed');
    expect(String(response.body.answer)).toMatch(/позиций нет/i);
    await local.app.close();
  });

  it('off-topic: отвечает без подтверждения и без вызовов инструментов', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/agent/chat')
      .send({ message: 'какая погода в Москве?' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('completed');
    expect(response.body.approval).toBeUndefined();
    expect(String(response.body.answer).length).toBeGreaterThan(0);
  });

  it('невалидный JSON в теле отдаёт 400 без стектрейса', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/agent/chat')
      .set('content-type', 'application/json')
      .send('{"message": ');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(response.body.error).not.toHaveProperty('stack');
  });

  it('fail-open: падающий экспорт трейса не ломает ответ', async () => {
    const originalTracing = process.env.LANGSMITH_TRACING;
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_API_KEY = 'lsv2_invalid_key_for_test';
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const local = await createApp(toolsFactory);

    try {
      const awaiting = await request(local.app.getHttpServer())
        .post('/api/v1/agent/chat')
        .send({ message: 'портфель?' });

      expect(awaiting.status).toBe(202);

      const response = await request(local.app.getHttpServer())
        .post('/api/v1/agent/chat/approve')
        .send({ sessionId: awaiting.body.sessionId, approved: true });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('completed');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      process.env.LANGSMITH_TRACING = originalTracing;
      delete process.env.LANGSMITH_API_KEY;
      await local.app.close();
    }
  });
});

