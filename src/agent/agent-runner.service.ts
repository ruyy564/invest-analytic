import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import { Command, type BaseCheckpointSaver } from '@langchain/langgraph';
import { AppConfigService } from '../config/app-config.service.js';
import { LLM_ANSWER_MODEL, LLM_ROUTER_MODEL } from '../llm/llm.module.js';
import { CHECKPOINTER } from '../state/state.module.js';
import { McpRegistryService } from '../tools/mcp-registry.service.js';
import { withTimeout } from '../tools/mcp-tool.adapter.js';
import {
  ApprovalFlowService,
  type ApproveDecision,
  type ApprovePayload,
} from './approval-flow.service.js';
import { NotAwaitingApprovalError } from './approval.errors.js';
import { ApprovalPolicyService } from './approvals/approval-policy.service.js';
import { buildAgentGraph, type CompiledAgentGraph } from './graph/build-graph.js';
import type { AgentStateType } from './graph/state.js';
import { RunCollector, buildTraceUrl } from '../observability/run-collector.js';

/** Лимит шагов графа (учитывает шаги цикла «модель ⇄ инструменты»). */
export const RUN_RECURSION_LIMIT = 12;
/** Дедлайн прогона: по истечении отдаём частичный ответ. */
export const RUN_DEADLINE_MS = 30_000;

export interface RunResult {
  status: 'completed' | 'awaiting_approval';
  answer?: string;
  intent: AgentStateType['intent'];
  partial: boolean;
  approval?: ApprovePayload;
  /** Ссылка на трейс LangSmith, если трассировка включена. */
  traceUrl?: string;
}

const extractInterrupt = (result: unknown): ApprovePayload | undefined => {
  const interrupts = (result as { __interrupt__?: { value?: unknown }[] }).__interrupt__;
  const value = interrupts?.[0]?.value;
  return value ? (value as ApprovePayload) : undefined;
};

/** Ответ помечается частичным, если инструмент упёрся в бюджет прогона. */
const hasBudgetError = (messages: AgentStateType['messages'] | undefined): boolean =>
  (messages ?? []).some(
    (message) =>
      (message as { _getType?: () => string })._getType?.() === 'tool' &&
      typeof message.content === 'string' &&
      /run_budget_exceeded|Лимит вызовов|Лимит времени/.test(message.content),
  );

const lastAnswer = (messages: AgentStateType['messages'] | undefined): string | undefined => {
  const list = messages ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    const type = (message as { _getType?: () => string })._getType?.();
    if (type === 'ai' && typeof message.content === 'string' && message.content.trim() !== '') {
      return message.content;
    }
  }
  return undefined;
};

/**
 * Запуск и продолжение прогонов: ленивая сборка графа (сеть не нужна до первого вопроса),
 * лимиты шагов и времени, изоляция сессий по `thread_id`.
 */
@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);
  private compiled?: CompiledAgentGraph;

  constructor(
    private readonly config: AppConfigService,
    private readonly registry: McpRegistryService,
    private readonly policy: ApprovalPolicyService,
    private readonly flow: ApprovalFlowService,
    @Inject(LLM_ROUTER_MODEL) private readonly routerModel: BaseChatModel,
    @Inject(LLM_ANSWER_MODEL) private readonly answerModel: BaseChatModel,
    @Inject(CHECKPOINTER) private readonly checkpointer: BaseCheckpointSaver,
  ) {}

  async run(message: string, sessionId: string, requestId?: string): Promise<RunResult> {
    const graph = await this.graph();
    const collector = new RunCollector();
    const config = { ...this.configFor(sessionId), callbacks: [collector] };
    this.registry.beginRun(sessionId);

    try {
      const result = await withTimeout(
        graph.invoke(
          { messages: [new HumanMessage(message)] },
          {
            ...config,
            metadata: { requestId, sessionId },
          },
        ),
        RUN_DEADLINE_MS,
        () => new Error('deadline'),
      );
      const mapped = await this.toResultAndTrack(graph, result as unknown, config, sessionId);
      return { ...mapped, traceUrl: this.traceUrlFor(collector) };
    } catch (error) {
      this.logger.warn(`Прогон прерван: ${(error as Error).message}`);
      return this.partialResult(config, sessionId);
    } finally {
      this.registry.endRun(sessionId);
    }
  }

  async resume(sessionId: string, decision: ApproveDecision): Promise<RunResult> {
    const graph = await this.graph();
    if (!this.flow.hasPending(sessionId) && !(await this.isAwaiting(graph, sessionId))) {
      throw new NotAwaitingApprovalError();
    }
    this.flow.assertSessionNotExpired(sessionId);
    const collector = new RunCollector();
    const config = { ...this.configFor(sessionId), callbacks: [collector] };
    this.registry.beginRun(sessionId);

    try {
      const result = await graph.invoke(new Command({ resume: decision }), config);
      const mapped = await this.toResultAndTrack(graph, result as unknown, config, sessionId);
      return { ...mapped, traceUrl: this.traceUrlFor(collector) };
    } finally {
      this.registry.endRun(sessionId);
    }
  }

  private traceUrlFor(collector: RunCollector): string | undefined {
    const langsmith = this.config.value.langsmith;
    if (!langsmith.tracing) {
      return undefined;
    }
    return buildTraceUrl(langsmith.traceUrlTemplate, {
      runId: collector.runId,
      orgId: langsmith.orgId,
      project: langsmith.project,
    });
  }

  /** Отмечает сессию как ожидающую решения (для 409 на повторное подтверждение). */
  private async toResultAndTrack(
    graph: CompiledAgentGraph,
    result: unknown,
    config: ReturnType<AgentRunnerService['configFor']>,
    sessionId: string,
  ): Promise<RunResult> {
    const mapped = await this.toResult(graph, result, config);
    if (mapped.status === 'awaiting_approval') {
      this.flow.markPending(sessionId);
    } else {
      this.flow.clearPending(sessionId);
    }
    return mapped;
  }

  private async graph(): Promise<CompiledAgentGraph> {
    if (this.compiled) {
      return this.compiled;
    }
    await this.registry.ensureInitialized();
    const tools = this.registry.tools;
    if (tools.length === 0) {
      throw new Error('Ни один MCP-инструмент не доступен: проверьте MCP_<NAME>_URL и подключение');
    }
    this.policy.assertKnownTools(tools.map((tool) => tool.name));

    this.compiled = buildAgentGraph({
      routerModel: this.routerModel,
      answerModel: this.answerModel,
      tools,
      policy: this.policy,
      flow: this.flow,
      accountId: this.config.value.mcp.accountId,
      checkpointer: this.checkpointer,
    });
    return this.compiled;
  }

  /** Проверка по чекпоинту: прогон реально стоит на подтверждении. */
  private async isAwaiting(
    graph: CompiledAgentGraph,
    sessionId: string,
  ): Promise<boolean> {
    const snapshot = (await graph.getState(this.configFor(sessionId))) as {
      next?: string[];
      tasks?: { interrupts?: unknown[] }[];
    };
    const next = snapshot.next ?? [];
    const tasks = snapshot.tasks ?? [];
    return next.length > 0 || tasks.some((task) => (task.interrupts?.length ?? 0) > 0);
  }

  private configFor(sessionId: string) {
    return {
      configurable: { thread_id: sessionId },
      recursionLimit: RUN_RECURSION_LIMIT,
    };
  }

  private async toResult(
    graph: CompiledAgentGraph,
    result: unknown,
    config: ReturnType<AgentRunnerService['configFor']>,
  ): Promise<RunResult> {
    const inlineValues = (result as { values?: AgentStateType }).values;
    const values =
      inlineValues && inlineValues.messages ? inlineValues : (await graph.getState(config)).values;
    const approval = extractInterrupt(result);

    if (approval) {
      return {
        status: 'awaiting_approval',
        intent: values?.intent ?? 'portfolio',
        partial: false,
        approval,
      };
    }

    return {
      status: 'completed',
      answer: lastAnswer(values?.messages),
      intent: values?.intent ?? 'portfolio',
      partial: (values?.partial ?? false) || hasBudgetError(values?.messages),
    };
  }

  private async partialResult(
    config: ReturnType<AgentRunnerService['configFor']>,
    _sessionId: string,
  ): Promise<RunResult> {
    const graph = await this.graph();
    const snapshot = await graph.getState(config);
    const values = (snapshot.values ?? {}) as AgentStateType;

    return {
      status: 'completed',
      answer:
        lastAnswer(values.messages) ??
        'Не удалось подготовить ответ за отведённое время. Попробуйте уточнить вопрос.',
      intent: values.intent ?? 'portfolio',
      partial: true,
    };
  }
}
