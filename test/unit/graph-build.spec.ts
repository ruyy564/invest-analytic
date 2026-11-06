import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { ApprovalFlowService } from '../../src/agent/approval-flow.service.js';
import { withToolResults } from '../../src/agent/nodes/agent/index.js';
import { ApprovalPolicyService } from '../../src/agent/approvals/approval-policy.service.js';
import { buildAgentGraph } from '../../src/agent/graph/build-graph.js';
import { OFF_TOPIC_ANSWER } from '../../src/agent/nodes/off-topic/prompt.js';
import { AppConfigService } from '../../src/config/app-config.service.js';
import type { McpRegistryService } from '../../src/mcp/mcp-registry.service.js';
import { KnowledgeRepository, KnowledgeService } from '../../src/knowledge/index.js';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

const configStub = (): AppConfigService =>
  ({
    value: {
      approvals: { ttlMinutes: 15, unlisted: 'require' },
      app: { userId: 'test-user' },
      run: {
        toolMaxCalls: 40,
        deadlineMs: 90_000,
        parallelism: 4,
        reviewMaxInstruments: 15,
        mcpToolTimeoutMs: 15_000,
        reviewEnabled: true,
        knowledgeEnabled: true,
        knowledgeDir: 'data/knowledge',
        knowledgeFile: undefined,
        knowledgeMaxChars: 1_800,
      },
      report: {
        templateFile: 'reports/portfolio-review.yaml',
        interpretationPromptFile: 'reports/prompts/interpretation.md',
      },
    },
  }) as unknown as AppConfigService;

/** В этих тестах ветка разбора не вызывает инструменты: реестр пустой. */
const registryStub = { toolByName: () => undefined } as unknown as McpRegistryService;

const buildGraph = (
  routerSteps: string[],
  answerSteps: (string | ReturnType<typeof HumanMessage>)[],
  reviewEnabled = true,
) => {
  const policy = new ApprovalPolicyService(configStub());
  const flow = new ApprovalFlowService(configStub());

  return buildAgentGraph({
    routerModel: new ScriptedChatModel(routerSteps),
    answerModel: new ScriptedChatModel(answerSteps),
    tools: [fakeTool('tinkoff__invest_get_portfolio')],
    policy,
    flow,
    checkpointer: new MemorySaver(),
    review: {
      config: configStub(),
      registry: registryStub,
      knowledge: new KnowledgeService(new KnowledgeRepository(configStub())),
    },
    reviewEnabled,
  });
};

describe('граф агента', () => {
  it('уводит вопрос не по теме в детерминированный отказ', async () => {
    const graph = buildGraph(['off_topic', 'off_topic'], ['ответ не должен использоваться']);

    const result = await graph.invoke(
      { messages: [new HumanMessage('какая погода?')] },
      { configurable: { thread_id: 'unit-off-topic' } },
    );

    expect(result.intent).toBe('off_topic');
    expect(String(result.messages.at(-1)?.content)).toBe(OFF_TOPIC_ANSWER);
  });

  it('не смешивает историю двух сессий', async () => {
    const graph = buildGraph(['off_topic', 'off_topic'], ['ответ не должен использоваться']);

    await graph.invoke(
      { messages: [new HumanMessage('сессия А')] },
      { configurable: { thread_id: 'unit-a' } },
    );
    const sessionB = await graph.invoke(
      { messages: [new HumanMessage('сессия Б')] },
      { configurable: { thread_id: 'unit-b' } },
    );

    expect(sessionB.messages).toHaveLength(2);
    expect(String(sessionB.messages[0]?.content)).toBe('сессия Б');
  });

  it('просьбу разобрать портфель уводит в подграф разбора и останавливает на подтверждении', async () => {
    const graph = buildGraph(['portfolio_review'], ['ответ агента не используется']);

    const result = (await graph.invoke(
      { messages: [new HumanMessage('проанализируй мой портфель')] },
      { configurable: { thread_id: 'unit-review' } },
    )) as { __interrupt__?: { value?: { question?: string; actions?: unknown[] } }[] };

    // План подтверждается внутри подграфа: снаружи видно payload подтверждения.
    const approval = result.__interrupt__?.[0]?.value;
    expect(approval?.question).toContain('разбора портфеля');
    expect(approval?.actions?.length).toBeGreaterThan(0);
  });

  it('при выключенной ветке разбора вопрос о портфеле идёт прежним путём', async () => {
    const graph = buildGraph(['portfolio_review'], ['Ответ по данным.'], false);

    const result = (await graph.invoke(
      { messages: [new HumanMessage('проанализируй мой портфель')] },
      { configurable: { thread_id: 'unit-review-off' } },
    )) as {
      readingPlan?: unknown[];
      reportId?: string;
      __interrupt__?: { value?: unknown }[];
    };

    // Плана и отчёта нет: прогон просит подтверждение на чтение сводки, как раньше.
    expect(result.readingPlan ?? []).toHaveLength(0);
    expect(result.reportId).toBeUndefined();
    expect(result.__interrupt__?.length).toBe(1);
  });
});

describe('история для модели', () => {
  const call = new AIMessage({
    content: '',
    tool_calls: [{ id: 'call-1', name: 'tinkoff__invest_get_portfolio', args: {} }],
  });

  it('достраивает ответ на вызов инструмента, прерванный подтверждением', () => {
    // Провайдер (GigaChat) отвечает 422, если у assistant есть tool_call без ответа tool:
    // именно так выглядит тред, который продолжили новым вопросом вместо подтверждения.
    const fixed = withToolResults([new HumanMessage('вопрос'), call, new HumanMessage('ещё вопрос')]);

    expect(fixed.map((message) => message.getType())).toEqual(['human', 'ai', 'tool', 'human']);
    expect((fixed[2] as ToolMessage).tool_call_id).toBe('call-1');
  });

  it('готовую историю не меняет', () => {
    const history = [
      new HumanMessage('вопрос'),
      call,
      new ToolMessage({ tool_call_id: 'call-1', content: 'данные' }),
    ];

    expect(withToolResults(history)).toHaveLength(3);
  });
});
