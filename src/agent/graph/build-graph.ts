import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import type { ApprovalFlowService } from '../approval-flow.service.js';
import type { ApprovalPolicyService } from '../approvals/approval-policy.service.js';
import { createAgentNode } from '../nodes/agent.node.js';
import { createApproveNode } from '../nodes/approve.node.js';
import { createClassifyNode } from '../nodes/classify.node.js';
import { offTopicNode } from '../nodes/off-topic.node.js';
import {
  createCollectNode,
  createPlanNode,
  createReportNode,
  type ReviewDeps,
} from '../nodes/review.nodes.js';
import { afterClassify, createAfterAgent } from './routers.js';
import { AgentState } from './state.js';

export interface BuildAgentGraphDeps {
  routerModel: BaseChatModel;
  answerModel: BaseChatModel;
  tools: StructuredToolInterface[];
  policy: ApprovalPolicyService;
  flow: ApprovalFlowService;
  accountId?: string;
  checkpointer?: BaseCheckpointSaver;
  /** Зависимости ветки разбора: конфигурация, реестр инструментов, модель. */
  review: ReviewDeps;
  /** `false` — прежнее поведение: две метки и только узел ответа. */
  reviewEnabled?: boolean;
}

/** Топология: classify → (offTopic | agent ⇄ approve → tools | plan → approve → collect → report). */
export const buildAgentGraph = (deps: BuildAgentGraphDeps) => {
  const reviewEnabled = deps.reviewEnabled ?? true;

  const base = new StateGraph(AgentState)
    .addNode('classify', createClassifyNode(deps.routerModel))
    .addNode('offTopic', offTopicNode)
    .addNode('agent', createAgentNode(deps.answerModel, deps.tools, { accountId: deps.accountId }))
    .addNode('approve', createApproveNode(deps), {
      // В режиме без разбора узла `collect` нет: и список выходов короче.
      ends: (reviewEnabled ? ['tools', 'agent', 'collect'] : ['tools', 'agent']) as never,
    })
    .addNode('tools', new ToolNode(deps.tools));

  if (!reviewEnabled) {
    // Прежнее поведение: две метки, ветки разбора в графе нет вовсе.
    return base
      .addEdge(START, 'classify')
      .addConditionalEdges('classify', afterClassify(false), {
        offTopic: 'offTopic',
        agent: 'agent',
      })
      .addConditionalEdges('agent', createAfterAgent(deps.policy), {
        approve: 'approve',
        tools: 'tools',
        [END]: END,
      })
      .addEdge('offTopic', END)
      .addEdge('tools', 'agent')
      .compile({ checkpointer: deps.checkpointer });
  }

  const graph = base
    .addNode('plan', createPlanNode(deps.review))
    .addNode('collect', createCollectNode(deps.review))
    .addNode('report', createReportNode(deps.review))
    .addEdge(START, 'classify')
    .addConditionalEdges('classify', afterClassify(true), {
      offTopic: 'offTopic',
      agent: 'agent',
      plan: 'plan',
    })
    .addConditionalEdges('agent', createAfterAgent(deps.policy), {
      approve: 'approve',
      tools: 'tools',
      [END]: END,
    })
    .addEdge('offTopic', END)
    .addEdge('tools', 'agent')
    .addEdge('plan', 'approve')
    .addEdge('collect', 'report')
    .addEdge('report', END);

  // Узел `approve` сам выбирает ветку через `Command`: подтверждённый план идёт
  // в `collect`, подтверждённые вызовы инструментов — в `tools`, отказ — в `agent`.
  return graph.compile({ checkpointer: deps.checkpointer });
};

export type CompiledAgentGraph = ReturnType<typeof buildAgentGraph>;

