import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Logger as PinoLogger } from 'pino';
import { APP_LOGGER, createAppLogger, runLogger, withLogContext } from '../platform/logging/index.js';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { AppConfigService } from '../platform/config/app-config.service.js';
import { LLM_ANSWER_MODEL, LLM_ROUTER_MODEL } from '../platform/llm/llm.module.js';
import { CHECKPOINTER } from '../platform/state/state.module.js';
import { McpRegistryService } from '../transports/mcp/mcp-registry.service.js';
import { resolveDefaultAccount } from '../capabilities/portfolio/resolve-account.js';
import { withTimeout } from '../transports/mcp/mcp-tool.adapter.js';
import {
  ApprovalFlowService,
  type ApproveDecision,
  type ApprovePayload,
} from './approval-flow.service.js';
import { NotAwaitingApprovalError } from './approval.errors.js';
import { NO_TOOLS_ANSWER } from './nodes/off-topic/prompt.js';
import { ApprovalPolicyService } from './approvals/approval-policy.service.js';
import { buildAgentGraph, type CompiledAgentGraph } from './graph/build-graph.js';
import { KnowledgeService } from '../capabilities/knowledge/index.js';
import type { AgentStateType } from './graph/state.js';
import { buildTraceUrl, findRootRunId, resolveOrgId } from '../platform/observability/run-collector.js';
import { ReportStoreService } from '../platform/state/report-store.service.js';
import { newsReportOf, reportOf } from './runner/report-builder.js';
import { RunJournal } from '../platform/runs/index.js';
import { stopReasonOf, toolsOf, usageOf } from './runner/journal-summary.js';
import {
  describeError,
  extractInterrupt,
  lastAnswer,
} from './runner/runner.helpers.js';
import {
  RUN_RECURSION_LIMIT,
  type RunResult,
} from './runner/runner.types.js';
import { runEventOf, type RunEvent, type StreamEventLike } from './runner/run-events.js';

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
              // Свой `runId` уходит в LangSmith как id корневого прогона: ссылка на
              // трейс и `npm run trace -- <runId>` ведут на существующий прогон.
              runId,
              metadata: { requestId, sessionId, runId },
            } as typeof config,
          ),
          this.config.value.run.deadlineMs,
          () => new Error('deadline'),
        );
        const mapped = await this.toResultAndTrack(graph, result as unknown, config, sessionId, runId);
        log.info({ intent: mapped.intent, partial: mapped.partial }, 'Прогон завершён');
        await this.appendFinished(journal, graph, config, mapped, startedAt, sessionId);
        return { ...mapped, traceUrl: await this.traceUrlFor(runId) };
      } catch (error) {
        const message = describeError(error);
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
        // Статический breakpoint перед `approve`: значение Resume не передаём,
        // решение идёт конфигом. Так кнопка Resume в Studio работает пустой,
        // а HTTP-путь различает согласие и отказ.
        const result = await graph.invoke(null, {
          ...config,
          configurable: {
            ...config.configurable,
            approvalDecision: decision.approved ? 'approve' : 'reject',
          },
          metadata: { requestId, sessionId, runId },
        } as typeof config);
        const mapped = await this.toResultAndTrack(graph, result as unknown, config, sessionId, runId);
        log.info({ intent: mapped.intent, partial: mapped.partial }, 'Прогон завершён');
        await this.appendFinished(journal, graph, config, mapped, startedAt, sessionId);
        return { ...mapped, traceUrl: await this.traceUrlFor(runId) };
      } finally {
        this.registry.endRun(sessionId);
      }
    });
  }

  /** Активные прогоны: нужны для отмены по `runId`. */
  private readonly active = new Map<string, { sessionId: string; controller: AbortController }>();

  /**
   * Поток событий прогона: клиент видит этапы до итогового ответа. Обычный
   * `run` остаётся прежним — поток не заменяет его, а дополняет.
   */
  async *stream(message: string, sessionId: string, requestId?: string): AsyncGenerator<RunEvent> {
    const runId = randomUUID();
    const controller = new AbortController();
    this.active.set(runId, { sessionId, controller });
    const log = runLogger(this.logger, { runId, requestId, sessionId });
    log.info('Прогон (поток) начат');

    yield { type: 'run_started', runId };

    const graph = await this.graph();
    if (!graph) {
      this.active.delete(runId);
      yield { type: 'failed', error: 'инструменты недоступны' };
      return;
    }

    const config = this.configFor(sessionId);
    this.registry.beginRun(sessionId);
    try {
      const events = await graph.streamEvents(
        { messages: [new HumanMessage(message)] },
        { ...config, metadata: { requestId, sessionId, runId }, version: 'v2', signal: controller.signal },
      );
      for await (const streamEvent of events) {
        if (controller.signal.aborted) {
          break;
        }
        const event = runEventOf(streamEvent as unknown as StreamEventLike);
        if (event) {
          yield event;
        }
      }

      if (controller.signal.aborted) {
        yield { type: 'cancelled' };
        return;
      }

      const snapshot = await graph.getState(config);
      const result = await this.toResultAndTrack(
        graph,
        { values: snapshot.values },
        config,
        sessionId,
        runId,
      );
      if (result.approval) {
        yield { type: 'approval', approval: result.approval };
      }
      log.info({ intent: result.intent, partial: result.partial }, 'Прогон (поток) завершён');
      yield { type: 'completed', result: { ...result, traceUrl: await this.traceUrlFor(runId) } };
    } catch (error) {
      if (controller.signal.aborted) {
        yield { type: 'cancelled' };
        return;
      }
      const text = describeError(error);
      log.warn({ err: text }, 'Прогон (поток) прерван');
      yield { type: 'failed', error: text };
    } finally {
      this.registry.endRun(sessionId);
      this.active.delete(runId);
    }
  }

  /**
   * Отмена прогона по `runId`: прерывает поток и освобождает бюджет сессии.
   * Повторная отмена идемпотентна — возвращает `false`, состояние не меняется.
   */
  cancel(runId: string): boolean {
    const active = this.active.get(runId);
    if (!active) {
      return false;
    }
    active.controller.abort();
    this.registry.endRun(active.sessionId);
    this.active.delete(runId);
    return true;
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
    sessionId: string,
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
        routeSource: values.routeSource,
        tools: toolsOf(values.messages),
        coverage: result.report?.coverage,
        stopReason: stopReasonOf(result, { budgetExhausted: this.registry.isBudgetExhausted(sessionId) }),
        usage: usageOf(values.messages),
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.logger.warn({ err: (error as Error).message }, 'Журнал: состояние недоступно');
    }
  }

  /**
   * Ссылка на трейс.
   *
   * Id корневого прогона создаёт LangSmith SDK, поэтому сначала находим его по
   * нашей метке `runId` в metadata: иначе ссылка ведёт на несуществующий прогон.
   * Если трассировка выключена или поиск не удался — ссылка не строится.
   */
  private async traceUrlFor(runId: string): Promise<string | undefined> {
    const langsmith = this.config.value.langsmith;
    if (!langsmith.tracing) {
      return undefined;
    }
    const [orgId, rootId] = await Promise.all([
      langsmith.orgId ? Promise.resolve(langsmith.orgId) : resolveOrgId(langsmith.apiKey),
      findRootRunId({ apiKey: langsmith.apiKey, project: langsmith.project, runId }),
    ]);
    return buildTraceUrl(langsmith.traceUrlTemplate, {
      runId: rootId ?? runId,
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
    const mapped = await this.toResult(graph, result, config, runId, sessionId);
    if (mapped.status === 'awaiting_approval') {
      this.flow.markPending(sessionId);
      // Момент остановки: по нему проверяется TTL при подтверждении.
      this.flow.markRequested(sessionId);
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

  /**
   * Payload подтверждения по состоянию прогона.
   *
   * При статическом breakpoint LangGraph не возвращает `__interrupt__`, поэтому
   * запрос для API строится из `readingPlan` (ветка разбора) или из последних
   * `tool_calls` модели (свободная ветка).
   */
  private approvalPayloadFor(values: AgentStateType): ApprovePayload | undefined {
    const plan = values.readingPlan ?? [];
    // План строится внутри подграфа, и при паузе там обновления ещё не подняты
    // наверх: ориентируемся на сценарий, а не на чтение состояния подграфа.
    if (values.intent === 'portfolio_review' || plan.length > 0) {
      const rule = this.policy.ruleFor('portfolio__review') ?? {
        tool: 'portfolio__review',
        label: 'Разбор портфеля',
        question: 'Прочитать данные для разбора портфеля?',
        requiresApproval: true,
      };
      const scopeLabel =
        values.scopeLabel ??
        (values.scopeTarget ? `бумаги ${values.scopeTarget}` : 'портфеля');
      return this.flow.buildPayload(
        [
          {
            rule: { ...rule, question: `Прочитать данные для разбора ${scopeLabel}?` },
            args: { requests: plan.length, groups: [], accounts: [] },
          },
        ],
        this.defaultAccount,
      );
    }

    const calls = (values.messages.at(-1) as AIMessage | undefined)?.tool_calls ?? [];
    const items = calls
      .filter((call) => this.policy.requiresApproval(call.name))
      .map((call) => ({
        rule: this.policy.ruleFor(call.name) ?? {
          tool: call.name,
          label: call.name,
          question: 'Подтвердить чтение данных?',
          requiresApproval: true,
        },
        args: (call.args ?? {}) as Record<string, unknown>,
      }));
    return items.length > 0 ? this.flow.buildPayload(items, this.defaultAccount) : undefined;
  }

  private async toResult(
    graph: CompiledAgentGraph,
    result: unknown,
    config: ReturnType<AgentRunnerService['configFor']>,
    runId: string,
    sessionId: string,
  ): Promise<RunResult> {
    const snapshot = await graph.getState(config);
    const inlineValues = (result as { values?: AgentStateType }).values;
    const values =
      inlineValues && inlineValues.messages ? inlineValues : snapshot.values;
    // Пауза статическая (breakpoint перед `approve`), поэтому `__interrupt__`
    // может отсутствовать: остановку видно по `next` в состоянии.
    const stopped = (snapshot.next?.length ?? 0) > 0;
    const approval =
      extractInterrupt(result) ?? (stopped ? this.approvalPayloadFor(values) : undefined);

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
      partial: (values?.partial ?? false) || this.registry.isBudgetExhausted(sessionId),
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
