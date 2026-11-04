import { existsSync } from 'node:fs';
import { z } from 'zod';

export const SUPPORTED_LLM_PROVIDERS = ['gigachat', 'openai', 'openai-compatible'] as const;
export const SUPPORTED_STATE_BACKENDS = ['sqlite', 'memory'] as const;
export const APPROVAL_UNLISTED_POLICIES = ['require', 'allow'] as const;
export const MCP_TRANSPORTS = ['http', 'sse'] as const;
export const MCP_TLS_MODES = ['strict', 'extra-ca', 'insecure'] as const;

export type LlmProviderId = (typeof SUPPORTED_LLM_PROVIDERS)[number];
export type McpTransport = (typeof MCP_TRANSPORTS)[number];
export type StateBackend = (typeof SUPPORTED_STATE_BACKENDS)[number];
export type ApprovalUnlistedPolicy = (typeof APPROVAL_UNLISTED_POLICIES)[number];
export type McpTlsMode = (typeof MCP_TLS_MODES)[number];

/**
 * Торговые и денежные операции MCP: их нельзя ни разрешать агенту,
 * ни помечать в правилах подтверждений как «без подтверждения».
 */
export const FORBIDDEN_TOOL_PATTERNS: readonly RegExp[] = [
  /^invest_create_/,
  /^invest_post_/,
  /^invest_cancel_/,
  /^invest_replace_/,
  /^invest_deposit_/,
  /^invest_withdraw_/,
  /^invest_transfer_/,
  /^invest_sell/,
  /^invest_buy/,
  /^invest_close_/,
];

export const isForbiddenTool = (toolName: string): boolean =>
  FORBIDDEN_TOOL_PATTERNS.some((pattern) => pattern.test(toolName));

const flag = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? String(def) : value.trim()))
    .pipe(z.enum(['true', 'false'], { message: 'ожидается true или false' }))
    .transform((value) => value === 'true');

const csv = (field: string) =>
  z
    .string({ message: `${field} обязателен` })
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .refine((items) => items.length > 0, { message: `${field} не должен быть пустым` });

const url = (field: string) =>
  z.string().refine(
    (value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: `${field} должен быть корректным URL` },
  );

/** Переменные окружения, не зависящие от списка MCP-серверов. */
const scalarEnvObject = z
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
    RUN_TOOL_MAX_CALLS: z.coerce.number().int().positive().default(40),
    RUN_DEADLINE_MS: z.coerce.number().int().positive().default(90_000),
    RUN_PARALLELISM: z.coerce.number().int().positive().max(16).default(4),
    REVIEW_MAX_INSTRUMENTS: z.coerce.number().int().positive().default(15),
    MCP_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    /** Декларативный шаблон отчёта: состав и порядок секций задаются файлом. */
    REPORT_TEMPLATE_FILE: z.string().trim().min(1).default('reports/portfolio-review.yaml'),
    REVIEW_ENABLED: flag(true),

    STATE_BACKEND: z
      .enum(SUPPORTED_STATE_BACKENDS, {
        message: `допустимые значения: ${SUPPORTED_STATE_BACKENDS.join(', ')}`,
      })
      .default('sqlite'),
    STATE_SQLITE_PATH: z.string().trim().min(1).default('./data/state.sqlite'),
    STATE_TTL_DAYS: z.coerce.number().int().positive().default(30),

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
  });

export type ScalarEnv = z.infer<typeof scalarEnvObject>;

/** Полный перечень скалярных ключей окружения (используется в тесте `.env.example`). */
export const SCALAR_ENV_KEYS: string[] = Object.keys(scalarEnvObject.shape);

export interface McpServerConfig {
  name: string;
  url: string;
  transport: McpTransport;
  token?: string;
  allowedTools: string[];
  /** `strict` — проверять сертификат обычно, `extra-ca` — доверять указанному файлу, `insecure` — не проверять. */
  tlsMode: McpTlsMode;
  /** Путь к PEM-файлу с дополнительным CA (для `tlsMode: extra-ca`). */
  caFile?: string;
}

export interface McpServersParseResult {
  servers: McpServerConfig[];
  issues: string[];
}

const SERVER_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Разворачивает `MCP_SERVERS` в конфигурацию серверов, собирая все проблемы сразу. */
export const parseMcpServers = (
  raw: NodeJS.ProcessEnv,
  serverNames: readonly string[],
): McpServersParseResult => {
  const issues: string[] = [];
  const servers: McpServerConfig[] = [];
  const seen = new Set<string>();

  for (const rawName of serverNames) {
    const name = rawName.trim().toLowerCase();
    if (!SERVER_NAME_PATTERN.test(name)) {
      issues.push(
        `MCP_SERVERS: имя "${rawName}" должно соответствовать ${SERVER_NAME_PATTERN.source}`,
      );
      continue;
    }
    if (seen.has(name)) {
      issues.push(`MCP_SERVERS: сервер "${name}" указан дважды`);
      continue;
    }
    seen.add(name);

    const prefix = `MCP_${name.toUpperCase()}_`;
    const urlValue = raw[`${prefix}URL`]?.trim();
    if (!urlValue) {
      issues.push(`${prefix}URL: обязателен для сервера "${name}"`);
      continue;
    }
    try {
      new URL(urlValue);
    } catch {
      issues.push(`${prefix}URL: должен быть корректным URL`);
      continue;
    }

    const transportRaw = (raw[`${prefix}TRANSPORT`]?.trim() || 'http').toLowerCase();
    const transport = MCP_TRANSPORTS.find((item) => item === transportRaw);
    if (!transport) {
      issues.push(`${prefix}TRANSPORT: допустимые значения: ${MCP_TRANSPORTS.join(', ')}`);
      continue;
    }

    const tlsRaw = (raw[`${prefix}TLS_MODE`]?.trim() || 'strict').toLowerCase();
    const tlsMode = MCP_TLS_MODES.find((item) => item === tlsRaw);
    if (!tlsMode) {
      issues.push(`${prefix}TLS_MODE: допустимые значения: ${MCP_TLS_MODES.join(', ')}`);
      continue;
    }

    const caFile = raw[`${prefix}CA_FILE`]?.trim() || undefined;
    if (tlsMode === 'extra-ca' && !caFile) {
      issues.push(`${prefix}CA_FILE: обязателен при ${prefix}TLS_MODE=extra-ca`);
      continue;
    }
    if (caFile && !existsSync(caFile)) {
      issues.push(`${prefix}CA_FILE: файл не найден (${caFile})`);
      continue;
    }

    const allowedTools = (raw[`${prefix}ALLOWED_TOOLS`] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (allowedTools.length === 0) {
      issues.push(`${prefix}ALLOWED_TOOLS: должен перечислять хотя бы один инструмент`);
      continue;
    }
    const forbidden = allowedTools.filter((tool) => isForbiddenTool(tool));
    if (forbidden.length > 0) {
      issues.push(
        `${prefix}ALLOWED_TOOLS: торговые и денежные операции запрещены (${forbidden.join(', ')})`,
      );
      continue;
    }

    servers.push({
      name,
      url: urlValue,
      transport,
      token: raw[`${prefix}TOKEN`]?.trim() || undefined,
      allowedTools,
      tlsMode,
      caFile,
    });
  }

  if (servers.length === 0 && issues.length === 0) {
    issues.push('MCP_SERVERS: должен быть указан хотя бы один сервер');
  }

  return { servers, issues };
};


