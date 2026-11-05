import type {
  ApprovalUnlistedPolicy,
  KeyRateSourceMode,
  LlmProviderId,
  McpServerConfig,
  StateBackend,
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
    knowledgeDir: string;
    knowledgeFile?: string;
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

