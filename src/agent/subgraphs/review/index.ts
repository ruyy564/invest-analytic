import { END, StateGraph } from '@langchain/langgraph';
import type { ApprovalFlowService } from '../../approval-flow.service.js';
import type { ApprovalPolicyService } from '../../approvals/approval-policy.service.js';
import { AgentState } from '../../graph/state.js';
import { createApproveNode } from '../../nodes/approve/index.js';
import {
  createCollectNode,
  createPlanNode,
  createReportNode,
  type ReviewDeps,
} from '../../nodes/review/index.js';

export interface ReviewSubgraphDeps extends ReviewDeps {
  policy: ApprovalPolicyService;
  flow: ApprovalFlowService;
  accountId?: string;
}

/**
 * Подграф разбора: план → подтверждение → сбор → отчёт. Снаружи это один узел,
 * поэтому основная топология не разрастается, а ветка разбора живёт отдельно.
 *
 * `checkpointer: true` обязателен: `interrupt` внутри подграфа возобновляется
 * только из сохранённого состояния подграфа. Без наследования чекпоинтера
 * `Resume` из Studio перезапускал подграф с начала (план вызывал модель заново)
 * и подставлял решение к устаревшему id прерывания — пауза не снималась.
 */
export const buildReviewSubgraph = (deps: ReviewSubgraphDeps) =>
  new StateGraph(AgentState)
    .addNode('plan', createPlanNode(deps))
    .addNode(
      'approve',
      createApproveNode({ policy: deps.policy, flow: deps.flow, accountId: deps.accountId }),
      // Внутри подграфа подтверждённый план идёт в сбор, отказ завершает подграф.
      { ends: ['collect', END] as never },
    )
    .addNode('collect', createCollectNode(deps))
    .addNode('report', createReportNode(deps))
    .addEdge('__start__', 'plan')
    .addEdge('plan', 'approve')
    .addEdge('collect', 'report')
    .addEdge('report', END)
    .compile({ checkpointer: true });
