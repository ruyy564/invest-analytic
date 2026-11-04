import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { ConfigError } from '../config/config.error.js';
import { ApprovalFlowService } from './approval-flow.service.js';
import { ApprovalPolicyService } from './approvals/approval-policy.service.js';
import { buildAgentGraph } from './graph/build-graph.js';
import { AppConfigService } from '../config/app-config.service.js';
import { loadConfiguration, type AppConfig } from '../config/configuration.js';
import { LlmRegistry } from '../llm/llm-registry.js';
import { MultiServerMcpFactory } from '../tools/mcp-client.factory.js';
import { McpProxyService } from '../tools/mcp-proxy.service.js';
import { McpRegistryService } from '../tools/mcp-registry.service.js';
import { resolveDefaultAccount } from '../tools/resolve-account.js';
import { knowledgeSources, loadAgentKnowledge } from '../knowledge/knowledge.js';

/**
 * Сборка рабочего агента вне NestJS: те же классы и тот же `.env`, что у сервиса
 * (`ConfigModule` → `LlmModule` → `ToolsModule` → `AgentModule`), но зависимости
 * создаются вручную. Нужна там, где контейнера нет — dev-сервер LangGraph
 * (`npm run studio`, LangSmith Studio).
 */

/** `AppConfigService` — тонкая обёртка над секциями конфигурации, её хватает без DI. */
const configServiceFor = (value: AppConfig): AppConfigService =>
  ({ value }) as unknown as AppConfigService;

/** Прокси нужен серверам с внешним URL: их ответ адаптер не дочитывает сам. */
const needsProxy = (server: { url: string }): boolean => {
  const { hostname } = new URL(server.url);
  return !['127.0.0.1', 'localhost', '::1'].includes(hostname);
};

export interface AgentRuntime {
  config: AppConfig;
  routerModel: BaseChatModel;
  answerModel: BaseChatModel;
  tools: DynamicStructuredTool[];
  accountId?: string;
  policy: ApprovalPolicyService;
  flow: ApprovalFlowService;
  /** Реестр нужен ветке разбора: инструменты, бюджет, источники. */
  registry: McpRegistryService;
  /** Для логов: какие MCP-серверы поднялись. */
  mcpServers: { name: string; status: string; tools: string[] }[];
}

/**
 * Конфигурация → модели → инструменты → правила подтверждений.
 * Ошибки не глотаются: Studio должна показать причину, а не пустой граф.
 */
export const createAgentRuntime = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentRuntime> => {
  // Та же zod-схема, что у NestJS: некорректный `.env` падает одинаково в обоих режимах.
  const config = loadConfiguration(env);
  const configService = configServiceFor(config);

  const llm = new LlmRegistry(configService);
  const mcpFactory = new MultiServerMcpFactory(new McpProxyService(configService), needsProxy);
  const registry = new McpRegistryService(configService, mcpFactory.create);
  await registry.ensureInitialized();

  const statuses = registry.serverStatuses;
  if (registry.tools.length === 0 || statuses.some((status) => status.status === 'down')) {
    // Studio работает без Nest: понятная причина важнее, чем падение внутри правил.
    const details = statuses.map(
      (status) =>
        `${status.name}: ${status.status === 'up' ? 'ok' : status.error ?? 'недоступен'}`,
    );
    throw new ConfigError([
      'MCP недоступен — без инструментов агент не соберётся',
      ...details,
      'Для T-Invest MCP нужны MCP_<NAME>_TLS_MODE=extra-ca и MCP_<NAME>_CA_FILE (см. scripts/fetch-mcp-ca.mjs)',
    ]);
  }

  const policy = new ApprovalPolicyService(configService);
  policy.assertKnownTools(registry.tools.map((tool) => tool.name));

  // Видно, что реально доступно агенту: allowlist и каталог MCP могут расходиться.
  console.log(
    `Агенту доступно инструментов: ${registry.tools.length} — ` +
      registry.tools.map((tool) => tool.name).join(', '),
  );
  const streaming = (llm.createChatModel('answer') as unknown as { streaming?: boolean }).streaming;
  console.log(`LLM: ${config.llm.provider}/${config.llm.model}, streaming=${String(streaming)}`);

  return {
    config,
    routerModel: llm.createChatModel('router'),
    answerModel: llm.createChatModel('answer'),
    tools: registry.tools,
    accountId: await resolveDefaultAccount(configService, registry),
    policy,
    flow: new ApprovalFlowService(configService),
    registry,
    mcpServers: registry.serverStatuses.map(({ name, status, tools }) => ({ name, status, tools })),
  };
};

/**
 * Точка входа для LangSmith Studio и `/runs/stream` dev-сервера, аналог
 * `investServer.ts` из примера курса. Чекпоинтер не передаётся: персистентность
 * треда хранит сам сервер, он же передаёт `configurable.thread_id`.
 */
let compiled: Promise<ReturnType<typeof buildAgentGraph>> | undefined;

export const graphForServer = (): Promise<ReturnType<typeof buildAgentGraph>> => {
  compiled ??= createAgentRuntime().then((runtime) => {
    const knowledge = loadAgentKnowledge(
      runtime.config.run.knowledgeEnabled,
      knowledgeSources(runtime.config.run),
      runtime.config.run.knowledgeMaxChars,
    );
    return buildAgentGraph({
      routerModel: runtime.routerModel,
      answerModel: runtime.answerModel,
      tools: runtime.tools,
      policy: runtime.policy,
      flow: runtime.flow,
      accountId: runtime.accountId,
      review: {
        config: configServiceFor(runtime.config),
        registry: runtime.registry,
        model: runtime.answerModel,
      },
      reviewEnabled: runtime.config.run.reviewEnabled,
      newsEnabled: runtime.config.sources.newsFeed.enabled,
      helpEnabled: runtime.config.run.agentHelpEnabled,
      knowledgeEnabled: knowledge.enabled,
      knowledge: knowledge.text,
    });
  });
  return compiled;
};
