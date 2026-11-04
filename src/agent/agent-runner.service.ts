import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import { Command, type BaseCheckpointSaver } from '@langchain/langgraph';
import { AppConfigService } from '../config/app-config.service.js';
import { LLM_ANSWER_MODEL, LLM_ROUTER_MODEL } from '../llm/llm.module.js';
import { CHECKPOINTER } from '../state/state.module.js';
import { McpRegistryService } from '../tools/mcp-registry.service.js';
import { resolveDefaultAccount } from '../tools/resolve-account.js';
import { withTimeout } from '../tools/mcp-tool.adapter.js';
import {
  ApprovalFlowService,
  type ApproveDecision,
  type ApprovePayload,
} from './approval-flow.service.js';
import { NotAwaitingApprovalError } from './approval.errors.js';
import { NO_TOOLS_ANSWER } from './prompts/off-topic.js';
import { ApprovalPolicyService } from './approvals/approval-policy.service.js';
import { buildAgentGraph, type CompiledAgentGraph } from './graph/build-graph.js';
import { knowledgeSources, loadAgentKnowledge } from '../knowledge/knowledge.js';
import type { AgentStateType } from './graph/state.js';
import { buildTraceUrl, resolveOrgId, resolveRootRunId } from '../observability/run-collector.js';
import { ReportStoreService } from '../state/report-store.service.js';

/** Лимит шагов графа (учитывает шаги цикла «модель ⇄ инструменты»). */
export const RUN_RECURSION_LIMIT = 12;

export interface RunReport {
  reportId: string;
  type: 'data_answer' | 'portfolio_report' | 'deep_review' | 'market_news';
  asOf: string;
  coverage: { source: string; status: 'ok' | 'missing'; reason?: string }[];
}

/** Метаданные новостной сводки: без `reportId`, она не сохраняется как отчёт. */
export interface NewsReport {
  type: 'market_news';
  asOf: string;
  coverage: { source: string; status: 'ok' | 'missing'; reason?: string }[];
}

export interface RunResult {
  status: 'completed' | 'awaiting_approval';
  answer?: string;
  intent: AgentStateType['intent'];
  /** Область разбора: весь портфель, счёт или отдельная бумага. */
  scope?: AgentStateType['scope'];
  scopeTarget?: string;
  scopeLabel?: string;
  partial: boolean;
  approval?: ApprovePayload;
  /** Метаданные отчёта: идентификатор для выгрузки, вид, время данных и покрытие. */
  report?: RunReport | NewsReport;
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

  private defaultAccount?: string;

  constructor(
    private readonly config: AppConfigService,
    private readonly registry: McpRegistryService,
    private readonly policy: ApprovalPolicyService,
    private readonly flow: ApprovalFlowService,
    @Inject(LLM_ROUTER_MODEL) private readonly routerModel: BaseChatModel,
    @Inject(LLM_ANSWER_MODEL) private readonly answerModel: BaseChatModel,
    @Inject(CHECKPOINTER) private readonly checkpointer: BaseCheckpointSaver,
    private readonly reports: ReportStoreService,
  ) {}

  async run(message: string, sessionId: string, requestId?: string): Promise<RunResult> {
    const graph = await this.graph();
    if (!graph) {
      return { status: 'completed', answer: NO_TOOLS_ANSWER, intent: 'data_lookup', partial: true };
    }
    const config = { ...this.configFor(sessionId) };
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
        this.config.value.run.deadlineMs,
        () => new Error('deadline'),
      );
      const mapped = await this.toResultAndTrack(graph, result as unknown, config, sessionId);
      return { ...mapped, traceUrl: await this.traceUrlFor(requestId) };
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      this.logger.warn(`Прогон прерван: ${message}`);
      if (process.env.AGENT_DEBUG_ERRORS === '1') {
        this.logger.error((error as Error)?.stack ?? message);
      }
      return this.partialResult(config, sessionId);
    } finally {
      this.registry.endRun(sessionId);
    }
  }

  async resume(sessionId: string, decision: ApproveDecision, requestId?: string): Promise<RunResult> {
    const graph = await this.graph();
    if (!graph) {
      return { status: 'completed', answer: NO_TOOLS_ANSWER, intent: 'data_lookup', partial: true };
    }
    if (!this.flow.hasPending(sessionId) && !(await this.isAwaiting(graph, sessionId))) {
      throw new NotAwaitingApprovalError();
    }
    this.flow.assertSessionNotExpired(sessionId);
    const config = { ...this.configFor(sessionId) };
    this.registry.beginRun(sessionId);

    try {
      const result = await graph.invoke(new Command({ resume: decision }), {
        ...config,
        metadata: { requestId, sessionId },
      });
      const mapped = await this.toResultAndTrack(graph, result as unknown, config, sessionId);
      return { ...mapped, traceUrl: await this.traceUrlFor(requestId) };
    } finally {
      this.registry.endRun(sessionId);
    }
  }

  /** Ссылка на трейс: берём последний корневой run проекта (только при включённой трассировке). */
  private async traceUrlFor(requestId?: string): Promise<string | undefined> {
    const langsmith = this.config.value.langsmith;
    if (!langsmith.tracing) {
      return undefined;
    }
    const runId = await resolveRootRunId({ project: langsmith.project, requestId });
    this.logger.debug?.(`traceUrl: requestId=${requestId} runId=${runId}`);
    const orgId = langsmith.orgId ?? (await resolveOrgId(langsmith.apiKey));
    return buildTraceUrl(langsmith.traceUrlTemplate, {
      runId,
      orgId,
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

  private async graph(): Promise<CompiledAgentGraph | undefined> {
    if (this.compiled) {
      return this.compiled;
    }
    await this.registry.ensureInitialized();
    const tools = this.registry.tools;
    if (tools.length === 0) {
      // MCP недоступен: отвечаем частичным результатом, а не подсовываем модели пустой набор.
      this.logger.warn('MCP недоступен: инструменты не получены');
      return undefined;
    }
    this.policy.assertKnownTools(tools.map((tool) => tool.name));

    if (!this.defaultAccount) {
      this.defaultAccount = await resolveDefaultAccount(this.config, this.registry);
    }

    // База знаний читается один раз при сборке графа: она — данные, не состояние прогона.
    const knowledge = loadAgentKnowledge(
      this.config.value.run.knowledgeEnabled,
      knowledgeSources(this.config.value.run),
      this.config.value.run.knowledgeMaxChars,
    );

    this.compiled = buildAgentGraph({
      routerModel: this.routerModel,
      answerModel: this.answerModel,
      tools,
      policy: this.policy,
      flow: this.flow,
      accountId: this.defaultAccount,
      checkpointer: this.checkpointer,
      review: { config: this.config, registry: this.registry, model: this.answerModel },
      reviewEnabled: this.config.value.run.reviewEnabled,
      newsEnabled: this.config.value.sources.newsFeed.enabled,
      helpEnabled: this.config.value.run.agentHelpEnabled,
      knowledgeEnabled: knowledge.enabled,
      knowledge: knowledge.text,
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
        intent: values?.intent ?? 'data_lookup',
        scope: values?.scope,
        scopeTarget: values?.scopeTarget,
        scopeLabel: values?.scopeLabel,
        partial: false,
        approval,
      };
    }

    return {
      status: 'completed',
      answer: lastAnswer(values?.messages),
      intent: values?.intent ?? 'data_lookup',
      scope: values?.scope,
      scopeTarget: values?.scopeTarget,
      scopeLabel: values?.scopeLabel,
      partial: (values?.partial ?? false) || hasBudgetError(values?.messages),
      report: this.newsReportOf(values) ?? this.reportOf(values, lastAnswer(values?.messages)),
    };
  }

  /** Метаданные новостной сводки: вид ответа, время данных и покрытие источников. */
  private newsReportOf(values: AgentStateType | undefined): NewsReport | undefined {
    if (values?.reportType !== 'market_news') {
      return undefined;
    }
    return {
      type: 'market_news',
      asOf: values.dataAsOf ?? new Date().toISOString(),
      coverage: (values.collection?.coverage ?? []).map(({ source, status, reason }) => ({
        source,
        status,
        reason,
      })),
    };
  }

  /** Метаданные отчёта; сохранение — чтобы работала выгрузка по `reportId`. */
  private reportOf(
    values: AgentStateType | undefined,
    answer: string | undefined,
  ): RunReport | undefined {
    const reportId = values?.reportId;
    if (!reportId) {
      return undefined;
    }
    const coverage = (values?.collection?.coverage ?? []).map(({ source, status, reason }) => ({
      source,
      status,
      reason,
    }));
    const asOf = values?.dataAsOf ?? new Date().toISOString();
    const type = values?.reportType ?? 'deep_review';
    const report: RunReport = { reportId, type, asOf, coverage };

    if (answer) {
      this.reports.save({
        reportId,
        userId: this.config.value.app.userId,
        createdAt: new Date().toISOString(),
        templateVersion: values?.reportTemplateVersion ?? 0,
        markdown: answer,
        json: JSON.stringify({ report, answer }),
      });
    }
    return report;
  }

  private async partialResult(
    config: ReturnType<AgentRunnerService['configFor']>,
    _sessionId: string,
  ): Promise<RunResult> {
    const graph = await this.graph();
    if (!graph) {
      return { status: 'completed', answer: NO_TOOLS_ANSWER, intent: 'data_lookup', partial: true };
    }
    const snapshot = await graph.getState(config);
    const values = (snapshot.values ?? {}) as AgentStateType;

    return {
      status: 'completed',
      answer:
        lastAnswer(values.messages) ??
        'Не удалось подготовить ответ за отведённое время. Попробуйте уточнить вопрос.',
      intent: values.intent ?? 'data_lookup',
      partial: true,
    };
  }
}
