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
import { ApprovalPolicyService } from './approvals/approval-policy.service.js';
import { buildAgentGraph, type CompiledAgentGraph } from './graph/build-graph.js';
import type { AgentStateType } from './graph/state.js';

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
}

const extractInterrupt = (result: unknown): ApprovePayload | undefined => {
  const interrupts = (result as { __interrupt__?: { value?: unknown }[] }).__interrupt__;
  const value = interrupts?.[0]?.value;
  return value ? (value as ApprovePayload) : undefined;
};

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

  async run(message: string, sessionId: string): Promise<RunResult> {
    const graph = await this.graph();
    const config = this.configFor(sessionId);

    try {
      const result = await withTimeout(
        graph.invoke({ messages: [new HumanMessage(message)] }, config),
        RUN_DEADLINE_MS,
        () => new Error('deadline'),
      );
      return await this.toResult(graph, result as unknown, config);
    } catch (error) {
      this.logger.warn(`Прогон прерван: ${(error as Error).message}`);
      return this.partialResult(config, sessionId);
    }
  }

  async resume(sessionId: string, decision: ApproveDecision): Promise<RunResult> {
    const graph = await this.graph();
    this.flow.assertSessionNotExpired(sessionId);
    const config = this.configFor(sessionId);

    const result = await graph.invoke(new Command({ resume: decision }), config);
    return this.toResult(graph, result as unknown, config);
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
      partial: values?.partial ?? false,
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
