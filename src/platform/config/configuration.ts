import { ConfigError } from './config.error.js';
import {
  McpServerConfig,
  ScalarEnv,
  parseMcpServers,
  scalarEnvSchema,
} from './env.schema.js';

import type { AppConfig } from './app-config.types.js';

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
    agentMode: env.AGENT_MODE,
    agentHelpEnabled: env.AGENT_HELP_ENABLED,
    knowledgeEnabled: env.KNOWLEDGE_ENABLED,
    knowledgeDir: env.KNOWLEDGE_DIR,
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
      policyV2: env.NEWS_POLICY_V2,
      policyFile: env.NEWS_POLICY_FILE,
      extraFeedsFile: env.NEWS_EXTRA_FEEDS_FILE,
      indexEnabled: env.NEWS_INDEX_ENABLED,
      indexTtlDays: env.NEWS_INDEX_TTL_DAYS,
      crawlerEnabled: env.NEWS_CRAWLER_ENABLED,
      crawlerIntervalMin: env.NEWS_CRAWLER_INTERVAL_MIN,
      crawlerMaxItems: env.NEWS_CRAWLER_MAX_ITEMS,
      watchlistFile: env.NEWS_WATCHLIST_FILE,
    },
    newsFeed: {
      enabled: env.NEWS_FEED_ENABLED,
      periodDays: env.NEWS_FEED_PERIODS.split(',').map((part) => Number(part.trim())),
      maxPerPeriod: env.NEWS_FEED_MAX_PER_PERIOD,
    },
    taxKeywordsFile: env.TAX_KEYWORDS_FILE,
    tickerAliasesFile: env.TICKER_ALIASES_FILE,
    companyProfilesFile: env.COMPANY_PROFILES_FILE,
    cbMeetingsFile: env.CB_MEETINGS_FILE,
  },
  state: {
    backend: env.STATE_BACKEND,
    sqlitePath: env.STATE_SQLITE_PATH,
    ttlDays: env.STATE_TTL_DAYS,
    runsDir: env.STATE_RUNS_DIR,
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
 * ╨з╨╕╤В╨░╨╡╤В ╨╕ ╨▓╨░╨╗╨╕╨┤╨╕╤А╤Г╨╡╤В ╨╛╨║╤А╤Г╨╢╨╡╨╜╨╕╨╡ ╤Ж╨╡╨╗╨╕╨║╨╛╨╝. ╨Ы╤О╨▒╨░╤П ╨┐╤А╨╛╨▒╨╗╨╡╨╝╨░ тАФ `ConfigError`
 * ╤Б╨╛ ╤Б╨┐╨╕╤Б╨║╨╛╨╝ ╨▓╤Б╨╡╤Е ╨╜╨╡╨║╨╛╤А╤А╨╡╨║╤В╨╜╤Л╤Е ╨┐╨╡╤А╨╡╨╝╨╡╨╜╨╜╤Л╤Е (╨╖╨╜╨░╤З╨╡╨╜╨╕╤П ╤Б╨╡╨║╤А╨╡╤В╨╛╨▓ ╨╜╨╡ ╨┐╨╡╤З╨░╤В╨░╤О╤В╤Б╤П).
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

export type { AppConfig, LogLevel, NodeEnv } from './app-config.types.js';
