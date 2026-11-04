import { ConfigError } from './config.error.js';
import {
  ApprovalUnlistedPolicy,
  KeyRateSourceMode,
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
      /** `false` — обычный HTTP-запрос вместо SSE-потока (см. провайдер). */
      streaming: boolean;
    };
  };
  mcp: {
    servers: McpServerConfig[];
    accountId?: string;
  };
  /** Лимиты прогона: вызовы инструментов, время, параллельность, глубина разбора. */
  run: {
    toolMaxCalls: number;
    deadlineMs: number;
    parallelism: number;
    reviewMaxInstruments: number;
    mcpToolTimeoutMs: number;
    /** Глубокий разбор портфеля отдельной веткой. */
    reviewEnabled: boolean;
    /** Ветка справки о возможностях. */
    agentHelpEnabled: boolean;
    /** База знаний по инвестициям: справочный контекст и справка по понятиям. */
    knowledgeEnabled: boolean;
    knowledgeFile: string;
    knowledgeMaxChars: number;
  };
  report: {
    /** Файл декларативного шаблона отчёта (секции, пороги, периоды). */
    templateFile: string;
    /** Файл промпта интерпретации: им модель пишет «макро» и «итог». */
    interpretationPromptFile: string;
  };
  /** Источники данных помимо брокера: реестр подключается по списку `SOURCES`. */
  sources: {
    enabled: string[];
    keyRate: {
      mode: KeyRateSourceMode;
      soapUrl: string;
      htmlUrl: string;
      seedFile: string;
      cacheTtlHours: number;
    };
    news: {
      ids: string[];
      scanPages: number;
      maxItems: number;
    };
    /** Сводка новостей рынка по периодам (ветка `news`). */
    newsFeed: {
      enabled: boolean;
      periodDays: number[];
      maxPerPeriod: number;
    };
    taxKeywordsFile: string;
    /** Алиасы тикеров: подстроки для поиска новостей по эмитенту. */
    tickerAliasesFile: string;
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
      streaming: env.GIGACHAT_STREAMING,
    },
  },
  mcp: {
    servers,
    accountId: env.TINKOFF_ACCOUNT_ID || undefined,
  },
  run: {
    toolMaxCalls: env.RUN_TOOL_MAX_CALLS,
    deadlineMs: env.RUN_DEADLINE_MS,
    parallelism: env.RUN_PARALLELISM,
    reviewMaxInstruments: env.REVIEW_MAX_INSTRUMENTS,
    mcpToolTimeoutMs: env.MCP_TOOL_TIMEOUT_MS,
    reviewEnabled: env.REVIEW_ENABLED,
    agentHelpEnabled: env.AGENT_HELP_ENABLED,
    knowledgeEnabled: env.KNOWLEDGE_ENABLED,
    knowledgeFile: env.KNOWLEDGE_FILE,
    knowledgeMaxChars: env.KNOWLEDGE_MAX_CHARS,
  },
  report: {
    templateFile: env.REPORT_TEMPLATE_FILE,
    interpretationPromptFile: env.REPORT_INTERPRETATION_PROMPT_FILE,
  },
  sources: {
    enabled: env.SOURCES,
    keyRate: {
      mode: env.KEY_RATE_SOURCE_MODE,
      soapUrl: env.KEY_RATE_SOAP_URL,
      htmlUrl: env.KEY_RATE_HTML_URL,
      seedFile: env.KEY_RATE_SEED_FILE,
      cacheTtlHours: env.KEY_RATE_CACHE_TTL_HOURS,
    },
    news: {
      ids: env.NEWS_SOURCES,
      scanPages: env.NEWS_SCAN_PAGES,
      maxItems: env.NEWS_DIGEST_MAX_ITEMS,
    },
    newsFeed: {
      enabled: env.NEWS_FEED_ENABLED,
      periodDays: env.NEWS_FEED_PERIODS.split(',').map((part) => Number(part.trim())),
      maxPerPeriod: env.NEWS_FEED_MAX_PER_PERIOD,
    },
    taxKeywordsFile: env.TAX_KEYWORDS_FILE,
    tickerAliasesFile: env.TICKER_ALIASES_FILE,
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
