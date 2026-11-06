export const SUPPORTED_LLM_PROVIDERS = ['gigachat', 'openai', 'openai-compatible'] as const;
export const SUPPORTED_STATE_BACKENDS = ['sqlite', 'memory'] as const;
export const APPROVAL_UNLISTED_POLICIES = ['require', 'allow'] as const;
export const MCP_TRANSPORTS = ['http', 'sse'] as const;
export const MCP_TLS_MODES = ['strict', 'extra-ca', 'insecure'] as const;
/** Режим получения ключевой ставки: live (SOAP ЦБ) → кэш → сид → HTML, только сид, выключено. */
export const KEY_RATE_SOURCE_MODES = ['live', 'seed', 'off'] as const;

export type LlmProviderId = (typeof SUPPORTED_LLM_PROVIDERS)[number];
export type McpTransport = (typeof MCP_TRANSPORTS)[number];
export type StateBackend = (typeof SUPPORTED_STATE_BACKENDS)[number];
export type ApprovalUnlistedPolicy = (typeof APPROVAL_UNLISTED_POLICIES)[number];
export type McpTlsMode = (typeof MCP_TLS_MODES)[number];
export type KeyRateSourceMode = (typeof KEY_RATE_SOURCE_MODES)[number];

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
