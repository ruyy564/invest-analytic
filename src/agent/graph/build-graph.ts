import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import type { ApprovalFlowService } from '../approval-flow.service.js';
import type { ApprovalPolicyService } from '../approvals/approval-policy.service.js';
import { createAgentNode } from '../nodes/agent/index.js';
import { createApproveNode } from '../nodes/approve/index.js';
import { createClassifyNode } from '../nodes/classify/index.js';
import { offTopicNode } from '../nodes/off-topic/index.js';
import { createNewsNode } from '../nodes/news/index.js';
import { createHelpNode } from '../nodes/help/index.js';
import { createKnowledgeNode } from '../nodes/knowledge/index.js';
import {
  type ReviewDeps,
} from '../nodes/review/index.js';
import { buildReviewSubgraph } from '../subgraphs/review/index.js';
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
  /** `false` — новостной вопрос уходит прежним маршрутом (`data_lookup`). */
  newsEnabled?: boolean;
  /** `false` — вопрос о возможностях уходит прежним маршрутом. */
  helpEnabled?: boolean;
}

/** Топология: classify → (offTopic | news | agent ⇄ approve → tools | plan → approve → collect → report). */
export const buildAgentGraph = (deps: BuildAgentGraphDeps) => {
  const reviewEnabled = deps.reviewEnabled ?? true;
  const newsEnabled = deps.newsEnabled ?? true;
  const helpEnabled = deps.helpEnabled ?? true;
  // Знания приходят сервисом: ветка активна, если каталог тем загрузился.
  const knowledge = deps.review.knowledge;
  const knowledgeEnabled = !knowledge.isEmpty;
  // Чек-лист решений для системного промпта агента: только он, без остальных тем.
  const knowledgeText = knowledge.promptBlock({
    section: 'verdict',
    required: ['decision-checklist'],
    limit: 1,
    maxChars: deps.review.config.value.run.knowledgeMaxChars,
  });

  const base = new StateGraph(AgentState)
    .addNode(
      'classify',
      createClassifyNode(deps.routerModel, knowledge, {
        aliasesPath: deps.review.config.value.sources?.tickerAliasesFile,
        helpEnabled,
        newsEnabled,
      }),
    )
    .addNode('offTopic', offTopicNode)
    .addNode('help', createHelpNode({ config: deps.review.config }))
    .addNode('knowledge', createKnowledgeNode({ knowledge }))
    .addNode(
      'news',
      createNewsNode({ config: deps.review.config, registry: deps.review.registry }),
    )
    .addNode(
      'agent',
      createAgentNode(deps.answerModel, deps.tools, {
        accountId: deps.accountId,
        knowledge: knowledgeText,
      }),
    )
    .addNode('approve', createApproveNode(deps), {
      // Подтверждение в свободной ветке ведёт только в инструменты или обратно к модели:
      // план разбора подтверждается внутри подграфа `review`.
      ends: ['tools', 'agent'] as never,
    })
    .addNode('tools', new ToolNode(deps.tools));

  if (!reviewEnabled) {
    // Прежнее поведение: две метки, ветки разбора в графе нет вовсе.
    return base
      .addEdge(START, 'classify')
      .addConditionalEdges('classify', afterClassify(false, newsEnabled, helpEnabled, knowledgeEnabled), {
        offTopic: 'offTopic',
        agent: 'agent',
        news: 'news',
        help: 'help',
        knowledge: 'knowledge',
      })
      .addConditionalEdges('agent', createAfterAgent(deps.policy), {
        approve: 'approve',
        tools: 'tools',
        [END]: END,
      })
      .addEdge('offTopic', END)
      .addEdge('news', END)
      .addEdge('help', END)
      .addEdge('knowledge', END)
      .addEdge('tools', 'agent')
      .compile({ checkpointer: deps.checkpointer });
  }

  const graph = base
    // Ветка разбора — отдельный подграф: снаружи один узел, внутри план → подтверждение → сбор → отчёт.
    .addNode(
      'review',
      buildReviewSubgraph({
        ...deps.review,
        policy: deps.policy,
        flow: deps.flow,
        accountId: deps.accountId,
      }),
    )
    .addEdge(START, 'classify')
    .addConditionalEdges('classify', afterClassify(true, newsEnabled, helpEnabled, knowledgeEnabled), {
      offTopic: 'offTopic',
      agent: 'agent',
      review: 'review',
      news: 'news',
      help: 'help',
      knowledge: 'knowledge',
    })
    .addConditionalEdges('agent', createAfterAgent(deps.policy), {
      approve: 'approve',
      tools: 'tools',
      [END]: END,
    })
    .addEdge('offTopic', END)
    .addEdge('news', END)
    .addEdge('help', END)
    .addEdge('knowledge', END)
    .addEdge('tools', 'agent')
    .addEdge('review', END);

  // Узел `approve` сам выбирает ветку через `Command`: подтверждённые вызовы
  // инструментов идут в `tools`, отказ — в `agent`. План разбора подтверждается
  // внутри подграфа `review`.
  return graph.compile({ checkpointer: deps.checkpointer });
};

export type CompiledAgentGraph = ReturnType<typeof buildAgentGraph>;

