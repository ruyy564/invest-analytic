import { HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { ApprovalFlowService } from '../../src/agent/approval-flow.service.js';
import { ApprovalPolicyService } from '../../src/agent/approvals/approval-policy.service.js';
import { buildAgentGraph } from '../../src/agent/graph/build-graph.js';
import { OFF_TOPIC_ANSWER } from '../../src/agent/prompts/off-topic.js';
import { AppConfigService } from '../../src/config/app-config.service.js';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

const configStub = (): AppConfigService =>
  ({
    value: { approvals: { ttlMinutes: 15, unlisted: 'require' } },
  }) as unknown as AppConfigService;

const buildGraph = (routerSteps: string[], answerSteps: (string | ReturnType<typeof HumanMessage>)[]) => {
  const policy = new ApprovalPolicyService(configStub());
  const flow = new ApprovalFlowService(configStub());

  return buildAgentGraph({
    routerModel: new ScriptedChatModel(routerSteps),
    answerModel: new ScriptedChatModel(answerSteps),
    tools: [fakeTool('tinkoff__invest_get_portfolio')],
    policy,
    flow,
    checkpointer: new MemorySaver(),
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
});
