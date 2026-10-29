import { z } from 'zod';

export const SUPPORTED_LLM_PROVIDERS = ['gigachat', 'openai', 'openai-compatible'] as const;
export const SUPPORTED_STATE_BACKENDS = ['sqlite', 'memory'] as const;
export const APPROVAL_UNLISTED_POLICIES = ['require', 'allow'] as const;
export const MCP_TRANSPORTS = ['http', 'sse'] as const;

export type LlmProviderId = (typeof SUPPORTED_LLM_PROVIDERS)[number];
export type McpTransport = (typeof MCP_TRANSPORTS)[number];
export type StateBackend = (typeof SUPPORTED_STATE_BACKENDS)[number];
export type ApprovalUnlistedPolicy = (typeof APPROVAL_UNLISTED_POLICIES)[number];

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
    GIGACHAT_AUTH_URL: url('GIGACHAT_AUTH_URL').default(
      'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    ),

    MCP_SERVERS: csv('MCP_SERVERS'),
    TINKOFF_ACCOUNT_ID: z.string().trim().optional(),

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
    });
  }

  if (servers.length === 0 && issues.length === 0) {
    issues.push('MCP_SERVERS: должен быть указан хотя бы один сервер');
  }

  return { servers, issues };
};


