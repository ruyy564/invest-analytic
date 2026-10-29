import { ConfigError } from './config.error.js';
import {
  ApprovalUnlistedPolicy,
  LlmProviderId,
  McpServerConfig,
  ScalarEnv,
  StateBackend,
  parseMcpServers,
  scalarEnvSchema,
} from './env.schema.js';

export type NodeEnv = 'development' | 'production' | 'test';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppConfig {
  app: {
    nodeEnv: NodeEnv;
    port: number;
    logLevel: LogLevel;
    logQuestionText: boolean;
    userId: string;
  };
  llm: {
    provider: LlmProviderId;
    model: string;
    routerModel: string;
    temperature: number;
    apiKey?: string;
    baseUrl?: string;
    gigachat: {
      credentials?: string;
      scope: string;
      authUrl: string;
    };
  };
  mcp: {
    servers: McpServerConfig[];
    accountId?: string;
  };
  state: {
    backend: StateBackend;
    sqlitePath: string;
    ttlDays: number;
  };
  approvals: {
    ttlMinutes: number;
    unlisted: ApprovalUnlistedPolicy;
    file?: string;
  };
  langsmith: {
    tracing: boolean;
    apiKey?: string;
    project: string;
    orgId?: string;
    hideInputs: boolean;
    traceUrlTemplate: string;
  };
}

const formatIssues = (issues: { path: PropertyKey[]; message: string }[]): string[] =>
  issues.map((issue) => `${issue.path.map(String).join('.') || '<env>'}: ${issue.message}`);

const toAppConfig = (env: ScalarEnv, servers: McpServerConfig[]): AppConfig => ({
  app: {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    logQuestionText: env.LOG_QUESTION_TEXT,
    userId: env.USER_ID,
  },
  llm: {
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    routerModel: env.LLM_ROUTER_MODEL || env.LLM_MODEL,
    temperature: env.LLM_TEMPERATURE,
    apiKey: env.LLM_API_KEY || undefined,
    baseUrl: env.LLM_BASE_URL || undefined,
    gigachat: {
      credentials: env.GIGACHAT_CREDENTIALS || undefined,
      scope: env.GIGACHAT_SCOPE,
      authUrl: env.GIGACHAT_AUTH_URL,
    },
  },
  mcp: {
    servers,
    accountId: env.TINKOFF_ACCOUNT_ID || undefined,
  },
  state: {
    backend: env.STATE_BACKEND,
    sqlitePath: env.STATE_SQLITE_PATH,
    ttlDays: env.STATE_TTL_DAYS,
  },
  approvals: {
    ttlMinutes: env.APPROVAL_TTL_MINUTES,
    unlisted: env.APPROVAL_UNLISTED,
    file: env.APPROVALS_FILE || undefined,
  },
  langsmith: {
    tracing: env.LANGSMITH_TRACING,
    apiKey: env.LANGSMITH_API_KEY || undefined,
    project: env.LANGSMITH_PROJECT,
    orgId: env.LANGSMITH_ORG_ID || undefined,
    hideInputs: env.LANGSMITH_HIDE_INPUTS,
    traceUrlTemplate: env.LANGSMITH_TRACE_URL_TEMPLATE,
  },
});

/**
 * Читает и валидирует окружение целиком. Любая проблема — `ConfigError`
 * со списком всех некорректных переменных (значения секретов не печатаются).
 */
export const loadConfiguration = (raw: NodeJS.ProcessEnv = process.env): AppConfig => {
  const issues: string[] = [];

  const parsed = scalarEnvSchema.safeParse(raw);
  if (!parsed.success) {
    issues.push(...formatIssues(parsed.error.issues));
  }

  const serverNames = parsed.success ? parsed.data.MCP_SERVERS : [];
  const mcp = parseMcpServers(raw, serverNames);
  issues.push(...mcp.issues);

  if (!parsed.success || issues.length > 0) {
    throw new ConfigError(issues);
  }

  return toAppConfig(parsed.data, mcp.servers);
};
