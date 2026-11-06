/** Доменные ошибки доступа к данным MCP: наружу уходит только код, не текст библиотеки. */
export class ToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

export class McpUnavailableError extends ToolError {
  constructor(message = 'MCP-сервер недоступен') {
    super('mcp_unavailable', message);
  }
}

export class McpUnauthorizedError extends ToolError {
  constructor(message = 'MCP-сервер отклонил токен') {
    super('mcp_unauthorized', message);
  }
}

export class McpRateLimitedError extends ToolError {
  constructor(message = 'MCP-сервер ограничил частоту запросов') {
    super('mcp_rate_limited', message);
  }
}

export class McpInvalidResponseError extends ToolError {
  constructor(message = 'MCP-сервер вернул некорректный ответ') {
    super('mcp_invalid_response', message);
  }
}

export class ForbiddenToolError extends ToolError {
  constructor(toolName: string) {
    super('forbidden_tool', `Инструмент "${toolName}" не разрешён`);
  }
}

export class RunBudgetExceededError extends ToolError {
  constructor(message: string) {
    super('run_budget_exceeded', message);
  }
}

const STATUS_UNAUTHORIZED = [401, 403];
const STATUS_RATE_LIMITED = [429];

/** Приводит любую ошибку вызова инструмента к доменному коду. */
export const mapMcpError = (error: unknown): ToolError => {
  if (error instanceof ToolError) {
    return error;
  }
  const source = error as { message?: string; status?: number; code?: string | number };
  const message = source?.message ?? String(error);
  const status = typeof source?.status === 'number' ? source.status : undefined;
  const codeText = `${source?.code ?? ''}`;

  if (status !== undefined && STATUS_UNAUTHORIZED.includes(status)) {
    return new McpUnauthorizedError();
  }
  if (status !== undefined && STATUS_RATE_LIMITED.includes(status)) {
    return new McpRateLimitedError();
  }
  if (status === 429 || codeText === '429') {
    return new McpRateLimitedError();
  }
  if (
    /timeout|timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed|socket hang up/i.test(
      message,
    )
  ) {
    return new McpUnavailableError();
  }
  if (/401|403|unauthorized|forbidden|invalid token/i.test(message)) {
    return new McpUnauthorizedError();
  }
  if (/429|rate limit|too many requests/i.test(message)) {
    return new McpRateLimitedError();
  }
  return new McpInvalidResponseError(message);
};
