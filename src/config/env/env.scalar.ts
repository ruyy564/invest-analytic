import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  APPROVAL_UNLISTED_POLICIES,
  KEY_RATE_SOURCE_MODES,
  SUPPORTED_LLM_PROVIDERS,
  SUPPORTED_STATE_BACKENDS,
} from './env.constants.js';
import { csv, csvList, flag, url } from './env.helpers.js';

/** Переменные окружения, не зависящие от списка MCP-серверов. */
export const scalarEnvObject = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    LOG_QUESTION_TEXT: flag(false),
    USER_ID: z.string().trim().min(1).default('default'),

    LLM_PROVIDER: z.enum(SUPPORTED_LLM_PROVIDERS, {
      message: `допустимые значения: ${SUPPORTED_LLM_PROVIDERS.join(', ')}`,
    }),
    LLM_MODEL: z.string().trim().min(1, 'LLM_MODEL обязателен'),
    LLM_ROUTER_MODEL: z.string().trim().optional(),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    LLM_API_KEY: z.string().trim().optional(),
    LLM_BASE_URL: z.string().trim().optional(),

    GIGACHAT_CREDENTIALS: z.string().trim().optional(),
    GIGACHAT_SCOPE: z.string().trim().default('GIGACHAT_API_PERS'),
    // Streaming у GigaChat иногда отдаёт обрезанный SSE-чанк («Unterminated string
    // in JSON»), и клиент минутами повторяет запрос. По умолчанию — обычный HTTP.
    GIGACHAT_STREAMING: flag(false),
    GIGACHAT_AUTH_URL: url('GIGACHAT_AUTH_URL').default(
      'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    ),

    MCP_SERVERS: csv('MCP_SERVERS'),
    TINKOFF_ACCOUNT_ID: z.string().trim().optional(),

    // Лимиты прогона: разбор портфеля требует заметно больше вызовов, чем точечный вопрос.
    RUN_TOOL_MAX_CALLS: z.coerce.number().int().positive().default(200),
    RUN_DEADLINE_MS: z.coerce.number().int().positive().default(240_000),
    RUN_PARALLELISM: z.coerce.number().int().positive().max(16).default(4),
    REVIEW_MAX_INSTRUMENTS: z.coerce.number().int().positive().default(15),
    MCP_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    /** Декларативный шаблон отчёта: состав и порядок секций задаются файлом. */
    REPORT_TEMPLATE_FILE: z.string().trim().min(1).default('reports/portfolio-review.yaml'),
    /** Промпт интерпретации: «макро» и «итог» формулирует модель. */
    REPORT_INTERPRETATION_PROMPT_FILE: z
      .string()
      .trim()
      .min(1)
      .default('reports/prompts/interpretation.md'),
    REVIEW_ENABLED: flag(true),
    /** Справка о возможностях агента отдельной веткой. */
    AGENT_HELP_ENABLED: flag(true),
    /**
     * База знаний по инвестициям: справочный контекст разбора, чек-лист в промпте
     * агента и ответы на вопросы о понятиях.
     */
    KNOWLEDGE_ENABLED: flag(true),
    /** Каталог файлов-тем: каждый файл — часть базы, порядок задаётся именем файла. */
    KNOWLEDGE_DIR: z.string().trim().min(1).default('data/knowledge'),
    /** Дополнительный файл-тема (необязательно): личные заметки поверх каталога. */
    KNOWLEDGE_FILE: z
      .string()
      .trim()
      .optional()
      // Пустое значение в `.env` — это «дополнительного файла нет», а не пустой путь.
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    /** Предел объёма справочного блока в символах: факты брифинга важнее. */
    KNOWLEDGE_MAX_CHARS: z.coerce.number().int().min(400).default(1_800),

    // Источники данных помимо брокера: ЦБ (ключевая ставка) и новостные ленты.
    SOURCES: csvList('tinkoff'),
    KEY_RATE_SOURCE_MODE: z
      .enum(KEY_RATE_SOURCE_MODES, {
        message: `допустимые значения: ${KEY_RATE_SOURCE_MODES.join(', ')}`,
      })
      .default('live'),
    KEY_RATE_SEED_FILE: z.string().trim().min(1).default('data/key-rate-seed.json'),
    KEY_RATE_SOAP_URL: url('KEY_RATE_SOAP_URL').default(
      'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx',
    ),
    KEY_RATE_HTML_URL: url('KEY_RATE_HTML_URL').default('https://www.cbr.ru/hd_base/KeyRate/'),
    KEY_RATE_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(24),
    NEWS_SOURCES: csvList('interfax,rbc,smartlab'),
    NEWS_SCAN_PAGES: z.coerce.number().int().positive().max(20).default(3),
    NEWS_DIGEST_MAX_ITEMS: z.coerce.number().int().positive().max(100).default(15),
    /** Сводка новостей рынка отдельной веткой графа. */
    NEWS_FEED_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    /** Окна периодов в днях: по умолчанию сегодня и неделя. */
    NEWS_FEED_PERIODS: z
      .string()
      .trim()
      .default('1,7')
      .refine(
        (value) =>
          value
            .split(',')
            .map((part) => Number(part.trim()))
            .every((days) => Number.isFinite(days) && days > 0),
        'NEWS_FEED_PERIODS: ожидается список положительных чисел, например 1,7',
      )
      .refine((value) => {
        const days = value.split(',').map((part) => Number(part.trim()));
        return days.every((day, index) => index === 0 || day > days[index - 1]);
      }, 'NEWS_FEED_PERIODS: периоды должны возрастать'),
    NEWS_FEED_MAX_PER_PERIOD: z.coerce.number().int().positive().max(50).default(8),
    TAX_KEYWORDS_FILE: z.string().trim().min(1).default('data/tax-keywords.yaml'),
    TICKER_ALIASES_FILE: z.string().trim().min(1).default('data/ticker-aliases.yaml'),
    /** Драйверы секторов и профили компаний: экспортёр / внутренний рынок. */
    COMPANY_PROFILES_FILE: z.string().trim().min(1).default('data/company-profiles.yaml'),

    STATE_BACKEND: z
      .enum(SUPPORTED_STATE_BACKENDS, {
        message: `допустимые значения: ${SUPPORTED_STATE_BACKENDS.join(', ')}`,
      })
      .default('sqlite'),
    STATE_SQLITE_PATH: z.string().trim().min(1).default('./.state/state.sqlite'),
    STATE_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /** Каталог журналов прогонов: по файлу JSONL на прогон. */
    STATE_RUNS_DIR: z.string().trim().min(1).default('./.state/runs'),

    APPROVAL_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    APPROVAL_UNLISTED: z
      .enum(APPROVAL_UNLISTED_POLICIES, {
        message: `допустимые значения: ${APPROVAL_UNLISTED_POLICIES.join(', ')}`,
      })
      .default('require'),
    APPROVALS_FILE: z.string().trim().optional(),

    LANGSMITH_TRACING: flag(false),
    LANGSMITH_API_KEY: z.string().trim().optional(),
    LANGSMITH_PROJECT: z.string().trim().default('invest-analytic'),
    LANGSMITH_ORG_ID: z.string().trim().optional(),
    LANGSMITH_HIDE_INPUTS: flag(false),
    LANGSMITH_TRACE_URL_TEMPLATE: z
      .string()
      .trim()
      .default('https://smith.langchain.com/o/{orgId}/projects/p/{project}/r/{runId}'),
  });

/** Схема окружения с условной проверкой креденшелов по выбранному провайдеру. */
export const scalarEnvSchema = scalarEnvObject.superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'gigachat' && !env.GIGACHAT_CREDENTIALS) {
      ctx.addIssue({
        code: 'custom',
        path: ['GIGACHAT_CREDENTIALS'],
        message: 'обязателен при LLM_PROVIDER=gigachat',
      });
    }
    if (env.LLM_PROVIDER === 'openai' && !env.LLM_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_API_KEY'],
        message: 'обязателен при LLM_PROVIDER=openai',
      });
    }
    if (env.LLM_PROVIDER === 'openai-compatible') {
      if (!env.LLM_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['LLM_API_KEY'],
          message: 'обязателен при LLM_PROVIDER=openai-compatible',
        });
      }
      if (!env.LLM_BASE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['LLM_BASE_URL'],
          message: 'обязателен при LLM_PROVIDER=openai-compatible',
        });
      }
    }
    if (env.LANGSMITH_TRACING && !env.LANGSMITH_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['LANGSMITH_API_KEY'],
        message: 'обязателен при LANGSMITH_TRACING=true',
      });
    }
    // Шаблон отчёта — файл данных: без него ветка разбора не соберётся, поэтому
    // проверяем существование на старте, пока разбор включён.
    if (env.REVIEW_ENABLED && !existsSync(env.REPORT_TEMPLATE_FILE)) {
      ctx.addIssue({
        code: 'custom',
        path: ['REPORT_TEMPLATE_FILE'],
        message: `файл шаблона отчёта не найден (${env.REPORT_TEMPLATE_FILE})`,
      });
    }
    // ЦБ в режиме сида: читать нечего без файла истории ставки.
    if (
      env.SOURCES.includes('cbr') &&
      env.KEY_RATE_SOURCE_MODE === 'seed' &&
      !existsSync(env.KEY_RATE_SEED_FILE)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['KEY_RATE_SEED_FILE'],
        message: `обязателен при KEY_RATE_SOURCE_MODE=seed (${env.KEY_RATE_SEED_FILE})`,
      });
    }
  });

export type ScalarEnv = z.infer<typeof scalarEnvObject>;

/** Полный перечень скалярных ключей окружения (используется в тесте `.env.example`). */
export const SCALAR_ENV_KEYS: string[] = Object.keys(scalarEnvObject.shape);
