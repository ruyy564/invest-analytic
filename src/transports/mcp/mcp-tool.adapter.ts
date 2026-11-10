import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import { toolSchemaFrom, toZodV3 } from './tool-schema.js';
import { McpUnavailableError, mapMcpError } from './errors.js';
import type { ToolBudget } from './tool-budget.js';

export interface ToolCallEvent {
  tool: string;
  durationMs: number;
  ok: boolean;
  /** Сколько попыток потребовалось: больше одной — был повтор после 429. */
  attempts?: number;
}

export interface ToolWrapperOptions {
  server: string;
  timeoutMs: number;
  budget?: ToolBudget;
  /** Бюджет конкретного прогона: сессия берётся из `config.configurable.thread_id`. */
  budgetFor?: (sessionId: string | undefined) => ToolBudget | undefined;
  /** Крючок для трейсинга и логов. */
  onCall?: (event: ToolCallEvent) => void;
  /** Паузы перед повтором при ограничении частоты (429). */
  rateLimitDelaysMs?: readonly number[];
  /** Подмена паузы в тестах: иначе повтор делает тест медленным. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Повтор при 429: лимит брокера — скользящее окно, короткая пауза обычно
 * возвращает ответ. Две попытки, дальше честная ошибка: ждать дольше, чем
 * идёт сам разбор, бессмысленно.
 */
export const RATE_LIMIT_DELAYS_MS: readonly number[] = [400, 1_200];

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
    const delays = options.rateLimitDelaysMs ?? RATE_LIMIT_DELAYS_MS;
    const sleep = options.sleep ?? defaultSleep;
    let attempts = 0;

    // Повтор только на 429: остальные ошибки (таймаут, токен, неверный ответ)
    // повтором не лечатся и только тратят дедлайн прогона.
    for (;;) {
      try {
        const result = await withTimeout(
          tool.invoke(input as never),
          options.timeoutMs,
          () =>
            new McpUnavailableError(
              `Инструмент ${wrappedName} не ответил за ${options.timeoutMs} мс`,
            ),
        );
        options.onCall?.({
          tool: wrappedName,
          durationMs: Date.now() - startedAt,
          ok: true,
          attempts: attempts + 1,
        });
        return result;
      } catch (error) {
        const mapped = mapMcpError(error);
        if (mapped.code === 'mcp_rate_limited' && attempts < delays.length) {
          await sleep(delays[attempts] ?? 0);
          attempts += 1;
          continue;
        }
        options.onCall?.({
          tool: wrappedName,
          durationMs: Date.now() - startedAt,
          ok: false,
          attempts: attempts + 1,
        });
        throw mapped;
      }
    }
  };

  const inputSchema = toZodV3(toolSchemaFrom(tool.schema));
  return new DynamicTool({
    name: wrappedName,
    description: tool.description,
    // GigaChat конвертирует схемы инструментов через zod-to-json-schema (только zod 3),
    // а адаптер MCP отдаёт zod 4. Строим zod-3 схему из JSON Schema MCP, чтобы модель
    // видела обязательные аргументы (например, accountId) и не звала инструмент с {}.
    // `lessSafeParse` не валидирует вход: защита от неполной аргументации остаётся в MCP.
    schema: inputSchema as never,
    func: (input: unknown, _runManager: unknown, config: unknown) =>
      call(input, config as { configurable?: Record<string, unknown> }),
  } as never);
};
