import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Logger as PinoLogger } from 'pino';
import { APP_LOGGER, createAppLogger, runLogger, withLogContext } from '../platform/logging/index.js';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import { Command, type BaseCheckpointSaver } from '@langchain/langgraph';
import { AppConfigService } from '../config/app-config.service.js';
import { LLM_ANSWER_MODEL, LLM_ROUTER_MODEL } from '../llm/llm.module.js';
import { CHECKPOINTER } from '../state/state.module.js';
import { McpRegistryService } from '../mcp/mcp-registry.service.js';
import { resolveDefaultAccount } from '../accounts/resolve-account.js';
import { withTimeout } from '../mcp/mcp-tool.adapter.js';
import {
  ApprovalFlowService,
  type ApproveDecision,
} from './approval-flow.service.js';
import { NotAwaitingApprovalError } from './approval.errors.js';
import { NO_TOOLS_ANSWER } from './nodes/off-topic/prompt.js';
import { ApprovalPolicyService } from './approvals/approval-policy.service.js';
import { buildAgentGraph, type CompiledAgentGraph } from './graph/build-graph.js';
import { KnowledgeService } from '../knowledge/index.js';
import type { AgentStateType } from './graph/state.js';
import { buildTraceUrl, resolveOrgId } from '../observability/run-collector.js';
import { ReportStoreService } from '../state/report-store.service.js';
import { newsReportOf, reportOf } from './runner/report-builder.js';
import { RunJournal } from '../platform/runs/index.js';
import { stopReasonOf, toolsOf, usageOf } from './runner/journal-summary.js';
import {
  extractInterrupt,
  hasBudgetError,
  lastAnswer,
} from './runner/runner.helpers.js';
import {
  RUN_RECURSION_LIMIT,
  type RunResult,
} from './runner/runner.types.js';

export { RUN_RECURSION_LIMIT } from './runner/runner.types.js';
export type { NewsReport, RunReport, RunResult } from './runner/runner.types.js';

/**
 * Запуск и продолжение прогонов: ленивая сборка графа (сеть не нужна до первого вопроса),
 * лимиты шагов и времени, изоляция сессий по `thread_id`.
 */
@Injectable()
export class AgentRunnerService {
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
    // База знаний — обычный Nest-провайдер: файлы и кэш живут в модуле знаний.
    private readonly knowledge: KnowledgeService,
    // Логгер опционален: ручная сборка в тестах может его не передавать.
    @Optional() @Inject(APP_LOGGER) logger?: PinoLogger,
  ) {
    this.logger = logger ?? createAppLogger({ level: 'silent' });
  }

  private readonly logger: PinoLogger;

  async run(message: string, sessionId: string, requestId?: string): Promise<RunResult> {
    // runId создаётся до графа: узлы и вызовы инструментов логируют с ним же.
    const runId = randomUUID();
    const startedAt = Date.now();
    const log = runLogger(this.logger, { runId, requestId, sessionId });
    log.info('Прогон начат');
    const journal = this.journalFor(runId);
    journal?.append({ type: 'run_started', sessionId, requestId });

    return withLogContext({ runId, requestId, sessionId }, async () => {
      const graph = await this.graph();
      if (!graph) {
        return {
          runId,
          status: 'completed',
          answer: NO_TOOLS_ANSWER,
          intent: 'data_lookup',
          partial: true,
        };
      }
      const config = { ...this.configFor(sessionId) };
      this.registry.beginRun(sessionId);

      try {
        const result = await withTimeout(
          graph.invoke(
            { messages: [new HumanMessage(message)] },
            {
              ...config,
              metadata: { requestId, sessionId, runId },
            },
          ),
          this.config.value.run.deadlineMs,
          () => new Error('deadline'),
        );
        const mapped = await this.toResultAndTrack(graph, result as unknown, config, sessionId, runId);
        log.info({ intent: mapped.intent, partial: mapped.partial }, 'Прогон завершён');
        await this.appendFinished(journal, graph, config, mapped, startedAt);
        return { ...mapped, traceUrl: await this.traceUrlFor(runId) };
      } catch (error) {
        const message = (error as Error)?.message ?? String(error);
        log.warn({ err: message }, 'Прогон прерван');
        journal?.append({ type: 'run_finished', status: 'failed', stopReason: 'error', error: message });
        if (process.env.AGENT_DEBUG_ERRORS === '1') {
          log.error({ stack: (error as Error)?.stack }, 'Причина прерывания');
        }
        return this.partialResult(config, sessionId, runId);
      } finally {
        this.registry.endRun(sessionId);
      }
    });
  }

  async resume(sessionId: string, decision: ApproveDecision, requestId?: string): Promise<RunResult> {
    const runId = randomUUID();
    const startedAt = Date.now();
    const log = runLogger(this.logger, { runId, requestId, sessionId });
    log.info('Прогон продолжен после подтверждения');
    const journal = this.journalFor(runId);
    journal?.append({ type: 'run_started', sessionId, requestId, resumed: true });

    return withLogContext({ runId, requestId, sessionId }, async () => {
      const graph = await this.graph();
      if (!graph) {
        return {
          runId,
          status: 'completed',
          answer: NO_TOOLS_ANSWER,
          intent: 'data_lookup',
          partial: true,
        };
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
          metadata: { requestId, sessionId, runId },
        });
        const mapped = await this.toResultAndTrack(graph, result as unknown, config, sessionId, runId);
        log.info({ intent: mapped.intent, partial: mapped.partial }, 'Прогон завершён');
        await this.appendFinished(journal, graph, config, mapped, startedAt);
        return { ...mapped, traceUrl: await this.traceUrlFor(runId) };
      } finally {
        this.registry.endRun(sessionId);
      }
    });
  }

  /** Журнал прогона: ошибка файловой системы не ломает прогон. */
  private journalFor(runId: string): RunJournal | undefined {
    try {
      return new RunJournal({
        dir: this.config.value.state.runsDir,
        runId,
        onError: (error) => this.logger.warn({ err: error.message }, 'Журнал прогона недоступен'),
      });
    } catch (error) {
      this.logger.warn({ err: (error as Error).message }, 'Журнал прогона не создан');
      return undefined;
    }
  }

  /** Итог прогона в журнале: инструменты, покрытие, расход и причина остановки. */
  private async appendFinished(
    journal: RunJournal | undefined,
    graph: CompiledAgentGraph,
    config: ReturnType<AgentRunnerService['configFor']>,
    result: RunResult,
    startedAt: number,
  ): Promise<void> {
    if (!journal) {
      return;
    }
    try {
      const snapshot = await graph.getState(config);
      const values = (snapshot.values ?? {}) as AgentStateType;
      journal.append({
        type: 'run_finished',
        intent: result.intent,
        status: result.status,
        partial: result.partial,
        tools: toolsOf(values.messages),
        coverage: result.report?.coverage,
        stopReason: stopReasonOf(result, values.messages),
        usage: usageOf(values.messages),
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.logger.warn({ err: (error as Error).message }, 'Журнал: состояние недоступно');
    }
  }

  /** Ссылка на трейс: собирается из собственного `runId`, без опроса LangSmith. */
  private async traceUrlFor(runId: string): Promise<string | undefined> {
    const langsmith = this.config.value.langsmith;
    if (!langsmith.tracing) {
      return undefined;
    }
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
    runId: string,
  ): Promise<RunResult> {
    const mapped = await this.toResult(graph, result, config, runId);
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
    const knowledge = this.knowledge;

    this.compiled = buildAgentGraph({
      routerModel: this.routerModel,
      answerModel: this.answerModel,
      tools,
      policy: this.policy,
      flow: this.flow,
      accountId: this.defaultAccount,
      checkpointer: this.checkpointer,
      review: {
        config: this.config,
        registry: this.registry,
        model: this.answerModel,
        knowledge,
      },
      reviewEnabled: this.config.value.run.reviewEnabled,
      newsEnabled: this.config.value.sources.newsFeed.enabled,
      helpEnabled: this.config.value.run.agentHelpEnabled,
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
    runId: string,
  ): Promise<RunResult> {
    const inlineValues = (result as { values?: AgentStateType }).values;
    const values =
      inlineValues && inlineValues.messages ? inlineValues : (await graph.getState(config)).values;
    const approval = extractInterrupt(result);

    if (approval) {
      return {
        runId,
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
      runId,
      status: 'completed',
      answer: lastAnswer(values?.messages),
      intent: values?.intent ?? 'data_lookup',
      scope: values?.scope,
      scopeTarget: values?.scopeTarget,
      scopeLabel: values?.scopeLabel,
      partial: (values?.partial ?? false) || hasBudgetError(values?.messages),
      report: newsReportOf(values) ?? reportOf(values, lastAnswer(values?.messages), { reports: this.reports, userId: this.config.value.app.userId }),
    };
  }

  /** Метаданные новостной сводки: вид ответа, время данных и покрытие источников. */
  private async partialResult(
    config: ReturnType<AgentRunnerService['configFor']>,
    _sessionId: string,
    runId: string,
  ): Promise<RunResult> {
    const graph = await this.graph();
    if (!graph) {
      return {
        runId,
        status: 'completed',
        answer: NO_TOOLS_ANSWER,
        intent: 'data_lookup',
        partial: true,
      };
    }
    const snapshot = await graph.getState(config);
    const values = (snapshot.values ?? {}) as AgentStateType;

    return {
      runId,
      status: 'completed',
      answer:
        lastAnswer(values.messages) ??
        'Не удалось подготовить ответ за отведённое время. Попробуйте уточнить вопрос.',
      intent: values.intent ?? 'data_lookup',
      partial: true,
    };
  }
}
