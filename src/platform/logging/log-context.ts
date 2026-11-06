import { AsyncLocalStorage } from 'node:async_hooks';

/** Поля прогона, которые автоматически попадают в каждую запись лога. */
export interface LogContext {
  runId?: string;
  requestId?: string;
  sessionId?: string;
  intent?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Текущий контекст прогона: пустой объект вне прогона. */
export const currentLogContext = (): LogContext => storage.getStore() ?? {};

/**
 * Выполняет функцию с контекстом прогона: все записи логов внутри (включая
 * `new Logger('Node')` из Nest и асинхронные вызовы графа) получают `runId`.
 */
export const withLogContext = <T>(fields: LogContext, fn: () => T): T =>
  storage.run({ ...currentLogContext(), ...fields }, fn);

/** Дополняет контекст без обёртки: используется при переходе между этапами. */
export const bindLogContext = (fields: LogContext): void => {
  storage.enterWith({ ...currentLogContext(), ...fields });
};
