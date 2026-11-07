import { AIMessage } from '@langchain/core/messages';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { AgentRunnerService } from '../../src/agent/agent-runner.service.js';
import { LLM_ANSWER_MODEL, LLM_ROUTER_MODEL } from '../../src/platform/llm/llm.module.js';
import { MCP_CLIENT_FACTORY } from '../../src/transports/mcp/mcp-registry.service.js';
import { ScriptedChatModel, type ScriptedStep } from './fake-chat-model.js';
import { e2eToolCatalog, E2E_ALLOWED_TOOLS, NEWS_JSON } from './e2e-catalog.js';
import { PORTFOLIO_FIXTURE } from './mcp-test-server.js';

/**
 * Общий стенд e2e: приложение на фейковом MCP и скриптовой модели.
 * Один и тот же стенд используют корзины графа и корзины поведения,
 * чтобы сценарии проверяли продукт, а не тестовую обвязку.
 */
export const HARNESS_ENV: NodeJS.ProcessEnv = {
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

export const toolCall = (id: string): AIMessage =>
  new AIMessage({
    content: '',
    tool_calls: [{ id, name: 'tinkoff__invest_get_portfolio', args: { accountId: 'acc-1' } }],
  });

/** Роутер в тесте: метка зависит от вопроса, поэтому число вызовов модели не важно. */
export class IntentAwareModel extends ScriptedChatModel {
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
        : /новост|news/i.test(question)
          ? 'market_news'
          : 'data_lookup';
    return { generations: [{ text: intent, message: new AIMessage(intent) }] };
  }
}

/** Записывает входные сообщения, чтобы проверить, что модели приходят данные инструментов. */
export class RecordingModel extends ScriptedChatModel {
  readonly inputs: string[] = [];

  override async _generate(
    messages: Parameters<ScriptedChatModel['_generate']>[0],
  ): ReturnType<ScriptedChatModel['_generate']> {
    this.inputs.push(messages.map((message) => JSON.stringify(message.content)).join('\n'));
    return super._generate(messages);
  }
}

export interface Harness {
  runner: AgentRunnerService;
  toolCalls: () => number;
  newsCalls: () => number;
  modelInputs: () => string[];
  moduleRef: Awaited<ReturnType<typeof Test.createTestingModule>['compile']>;
}

/** Настройки стенда: сценарий может подменить новостную ленту брокера. */
export interface HarnessOptions {
  /** Что вернёт `invest_get_news`: по умолчанию фикстура новостей. */
  news?: () => unknown;
}

/** Каждый сценарий — своё приложение и свой сценарий ответов модели. */
export const createHarness = async (
  answerSteps: ScriptedStep[],
  options: HarnessOptions = {},
): Promise<Harness> => {
  let calls = 0;
  let news = 0;
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
        // Новостной фасад ходит в ленту через брокера: считаем эти запросы.
        invest_get_news: () => {
          news += 1;
          return options.news ? options.news() : NEWS_JSON;
        },
      }),
    )
    .compile();

  return {
    runner: moduleRef.get(AgentRunnerService),
    toolCalls: () => calls,
    newsCalls: () => news,
    modelInputs: () => answerModel.inputs,
    moduleRef,
  };
};
