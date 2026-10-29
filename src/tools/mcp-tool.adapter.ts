import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import { McpUnavailableError, mapMcpError } from './errors.js';
import type { ToolBudget } from './tool-budget.js';

export interface ToolCallEvent {
  tool: string;
  durationMs: number;
  ok: boolean;
}

export interface ToolWrapperOptions {
  server: string;
  timeoutMs: number;
  budget?: ToolBudget;
  /** Бюджет конкретного прогона: сессия берётся из `config.configurable.thread_id`. */
  budgetFor?: (sessionId: string | undefined) => ToolBudget | undefined;
  /** Крючок для трейсинга и логов. */
  onCall?: (event: ToolCallEvent) => void;
}

/** Имя инструмента для агента: `<server>__<tool>`. */
export const namespaceTool = (server: string, toolName: string): string =>
  `${server}__${toolName}`;

/** Оставляет только инструменты из allowlist (политика «разрешено только перечисленное»). */
export const selectAllowedTools = (
  tools: DynamicStructuredTool[],
  allowedTools: readonly string[],
): DynamicStructuredTool[] => tools.filter((tool) => allowedTools.includes(tool.name));

/** Разница между allowlist и каталогом сервера — повод для предупреждения в логах. */
export const missingAllowedTools = (
  tools: DynamicStructuredTool[],
  allowedTools: readonly string[],
): string[] => allowedTools.filter((name) => !tools.some((tool) => tool.name === name));

export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  void promise.catch(() => undefined);
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

/**
 * Оборачивает инструмент MCP: неймспейсинг имени, бюджет, таймаут,
 * маппинг ошибок в доменные коды и событие вызова для трейсинга.
 */
export const wrapTool = (
  tool: DynamicStructuredTool,
  options: ToolWrapperOptions,
): DynamicStructuredTool => {
  const wrappedName = namespaceTool(options.server, tool.name);

  const call = async (
    input: unknown,
    config?: { configurable?: Record<string, unknown> },
  ): Promise<unknown> => {
    const sessionId =
      typeof config?.configurable?.thread_id === 'string'
        ? config.configurable.thread_id
        : undefined;
    const budget = options.budgetFor?.(sessionId) ?? options.budget;
    budget?.assertAvailable(wrappedName);
    budget?.registerCall();
    const startedAt = Date.now();
    try {
      const result = await withTimeout(
        tool.invoke(input as never),
        options.timeoutMs,
        () =>
          new McpUnavailableError(
            `Инструмент ${wrappedName} не ответил за ${options.timeoutMs} мс`,
          ),
      );
      options.onCall?.({ tool: wrappedName, durationMs: Date.now() - startedAt, ok: true });
      return result;
    } catch (error) {
      const mapped = mapMcpError(error);
      options.onCall?.({ tool: wrappedName, durationMs: Date.now() - startedAt, ok: false });
      throw mapped;
    }
  };

  return new DynamicTool({
    name: wrappedName,
    description: tool.description,
    schema: tool.schema,
    func: (input: unknown, _runManager: unknown, config: unknown) =>
      call(input, config as { configurable?: Record<string, unknown> }),
  } as never);
};
