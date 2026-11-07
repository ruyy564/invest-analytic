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
    /** Режим выбора данных: детерминированный план или план с добором моделью. */
    agentMode: 'legacy' | 'agent';
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
      /** Политика релевантности включена (флаг отката). */
      policyV2: boolean;
      /** Файл политики: правила отбраковки и привязки к бумаге. */
      policyFile: string;
      /** Дополнительные ленты: файл со списком источников (id, url, формат). */
      extraFeedsFile: string;
      /** Индекс собранных публикаций включён. */
      indexEnabled: boolean;
      /** Сколько дней хранить публикации и тексты статей в индексе. */
      indexTtlDays: number;
      /** Фоновый сбор новостей включён. */
      crawlerEnabled: boolean;
      /** Интервал фонового сбора в минутах. */
      crawlerIntervalMin: number;
      /** Сколько публикаций собирать за один проход фона. */
      crawlerMaxItems: number;
      /** Файл со списком бумаг для фонового сбора. */
      watchlistFile: string;
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
    /** Профили секторов и компаний: драйверы и внешнеэкономический профиль. */
    companyProfilesFile: string;
    /** План заседаний ЦБ: даты решений по ключевой ставке. */
    cbMeetingsFile: string;
  };
  state: {
    backend: StateBackend;
    sqlitePath: string;
    ttlDays: number;
    /** Каталог журналов прогонов (JSONL, по файлу на прогон). */
    runsDir: string;
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

