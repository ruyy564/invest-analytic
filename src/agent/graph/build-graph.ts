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
}

/** Топология: classify → (offTopic → END | agent ⇄ approve → tools → agent). */
export const buildAgentGraph = (deps: BuildAgentGraphDeps) => {
  const graph = new StateGraph(AgentState)
    .addNode('classify', createClassifyNode(deps.routerModel))
    .addNode('offTopic', offTopicNode)
    .addNode('agent', createAgentNode(deps.answerModel, deps.tools, { accountId: deps.accountId }))
    .addNode('approve', createApproveNode(deps), { ends: ['tools', 'agent'] })
    .addNode('tools', new ToolNode(deps.tools))
    .addEdge(START, 'classify')
    .addConditionalEdges('classify', afterClassify, { offTopic: 'offTopic', agent: 'agent' })
    .addConditionalEdges('agent', createAfterAgent(deps.policy), {
      approve: 'approve',
      tools: 'tools',
      [END]: END,
    })
    .addEdge('offTopic', END)
    .addEdge('tools', 'agent');

  return graph.compile({ checkpointer: deps.checkpointer });
};

export type CompiledAgentGraph = ReturnType<typeof buildAgentGraph>;
