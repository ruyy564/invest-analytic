import type { LoggerService } from '@nestjs/common';
import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';
import { maskSecret, redactString } from './redact.js';
import { currentLogContext } from './log-context.js';

/** Токен DI: приложение получает pino-логгер, а не глобальный Nest Logger. */
export const APP_LOGGER = Symbol('APP_LOGGER');

export interface AppLoggerOptions {
  /** Уровень из конфигурации (`LOG_LEVEL`). */
  level: string;
  /** Имя сервиса в каждой записи. */
  service?: string;
  /** Окружение: помогает отличать локальные прогоны от продовых. */
  env?: string;
  /** Поток вывода: stdout в проде, буфер в тестах. */
  destination?: DestinationStream;
}

/**
 * Секретные поля, которые pino маскирует сам. Рекурсивная маска по имени поля
 * живёт в `redact.ts` — она применяется к данным перед записью.
 */
const SECRET_PATHS = [
  'token',
  'authorization',
  'apiKey',
  'api_key',
  'secret',
  'password',
  'credentials',
  '*.token',
  '*.authorization',
  '*.apiKey',
  '*.secret',
  '*.password',
  '*.credentials',
  'headers.authorization',
  'req.headers.authorization',
];

/** Логгер приложения: JSON-записи, ISO-время, маскирование секретов. */
export const createAppLogger = (options: AppLoggerOptions): PinoLogger =>
  pino(
    {
      level: options.level,
      // pid и hostname не нужны: контейнер сам знает, кто пишет.
      base: {
        service: options.service ?? 'invest-analytic',
        ...(options.env ? { env: options.env } : {}),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: SECRET_PATHS,
        // pino отдаёт значение как unknown: маскируем строки, остальное — заглушкой.
        censor: (value: unknown) => (typeof value === 'string' ? maskSecret(value) : '***'),
      },
      // Маска применяется и к тексту сообщения: pino сам чистит только поля по путям.
      hooks: {
        logMethod(inputArgs, method) {
          const masked = inputArgs.map((argument) =>
            typeof argument === 'string' ? redactString(argument) : argument,
          );
          return (method as (...args: unknown[]) => void).apply(this, masked);
        },
      },
      formatters: { level: (label) => ({ level: label }) },
    },
    options.destination,
  );

/** Текст сообщения независимо от типа: строка, объект, исключение. */
const textOf = (message: unknown): string => {
  if (typeof message === 'string') {
    return redactString(message);
  }
  if (message instanceof Error) {
    return redactString(message.message);
  }
  try {
    return redactString(JSON.stringify(message));
  } catch {
    return redactString(String(message));
  }
};

/** Последний строковый параметр Nest-логгера — это контекст (`new Logger('X')`). */
const contextOf = (params: unknown[]): string | undefined => {
  const last = params.at(-1);
  return typeof last === 'string' ? last : undefined;
};

/**
 * Мост к Nest: `app.useLogger(...)` направляет все `new Logger('X')` в pino,
 * поэтому существующие вызовы логирования не нужно переписывать.
 */
export const toNestLogger = (logger: PinoLogger): LoggerService => {
  // Контекст прогона берётся из AsyncLocalStorage: узлы логируют без runId в коде.
  const fields = (context?: string): Record<string, unknown> => ({
    ...currentLogContext(),
    ...(context ? { context } : {}),
  });

  return {
    log: (message: unknown, ...params: unknown[]) =>
      logger.info(fields(contextOf(params)), textOf(message)),
    error: (message: unknown, ...params: unknown[]) =>
      logger.error(
        { ...fields(contextOf(params)), ...(typeof params[0] === 'string' ? { stack: params[0] } : {}) },
        textOf(message),
      ),
    warn: (message: unknown, ...params: unknown[]) =>
      logger.warn(fields(contextOf(params)), textOf(message)),
    debug: (message: unknown, ...params: unknown[]) =>
      logger.debug(fields(contextOf(params)), textOf(message)),
    verbose: (message: unknown, ...params: unknown[]) =>
      logger.debug(fields(contextOf(params)), textOf(message)),
    fatal: (message: unknown, ...params: unknown[]) =>
      logger.fatal(fields(contextOf(params)), textOf(message)),
  };
};

/** Дочерний логгер прогона: все записи получают `runId` и, если есть, `sessionId`. */
export const runLogger = (
  logger: PinoLogger,
  context: { runId: string; requestId?: string; sessionId?: string },
): PinoLogger =>
  logger.child({
    runId: context.runId,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
  });
