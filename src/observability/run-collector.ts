import { Logger } from '@nestjs/common';

/** Имя корневого прогона, которым LangGraph называет запуск графа в LangSmith. */
const GRAPH_RUN_NAME = 'LangGraph';

const logger = new Logger('Tracing');

/** Минимальные сведения о прогоне, нужные для сборки ссылки на трейс. */
export interface RunSummary {
  id?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceContext {
  runId?: string;
  orgId?: string;
  project: string;
}

/** Ссылка на трейс: без runId или orgId ссылка не строится. */
export const buildTraceUrl = (template: string, context: TraceContext): string | undefined => {
  if (!context.runId) {
    return undefined;
  }
  if (template.includes('{orgId}') && !context.orgId) {
    return undefined;
  }
  return template
    .replace('{orgId}', context.orgId ?? '')
    .replace('{project}', context.project)
    .replace('{runId}', context.runId);
};

/**
 * Организация для ссылки на трейс: из env, а если не задана — запрашиваем текущую
 * у LangSmith (ссылку можно собрать и без ручной настройки).
 */
export const resolveOrgId = async (apiKey?: string): Promise<string | undefined> => {
  if (!apiKey) {
    return undefined;
  }
  try {
    const response = await fetch('https://api.smith.langchain.com/api/v1/orgs/current', {
      headers: { 'x-api-key': apiKey },
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { id?: string };
    return body.id;
  } catch {
    return undefined;
  }
};

/**
 * Узнаёт идентификатор корневого прогона в LangSmith после запуска графа:
 * LangChain не отдаёт его в колбэках, поэтому читаем свежие трейсы проекта.
 * Ошибка трассировки не влияет на ответ (fail-open), но попадает в лог.
 */
export const resolveRootRunId = async (
  options: {
    project: string;
    /** Номер запроса: ссылка должна вести именно в его трейс, а не в соседний. */
    requestId?: string;
    maxAttempts?: number;
    delayMs?: number;
  },
  /**
   * Источник прогонов (по умолчанию — LangSmith SDK). Вынесен параметром, чтобы
   * тестировать логику выбора и повторов без сети и мока ESM-модулей.
   */
  listRuns: (project: string) => AsyncIterable<RunSummary> = listRunsViaLangsmith,
): Promise<string | undefined> => {
  const attempts = options.maxAttempts ?? 5;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      // Корневой run графа называется `LangGraph`; у вызовов инструментов своих родителей
      // в выдаче нет (они пишутся отдельными трейсами), поэтому фильтруем по имени.
      // Явный `isRoot` отсекает `__start__` (он тоже без родителя) и требует, чтобы
      // до старта корня уже были известны все дети — поэтому его не используем.
      for await (const run of listRuns(options.project)) {
        if (run.id && run.name === GRAPH_RUN_NAME && matchesRequest(run, options.requestId)) {
          return run.id;
        }
      }
    } catch (error) {
      // LangSmith недоступен — ответ отдаём без ссылки.
      logger.warn(`Ссылка на трейс недоступна: ${(error as Error)?.message ?? String(error)}`);
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 800));
  }
  return undefined;
};

/** Прогон относится к запросу: либо метаданных нет, либо номер совпадает. */
const matchesRequest = (run: RunSummary, requestId?: string): boolean => {
  if (!requestId) {
    return true;
  }
  const actual = run.metadata?.requestId;
  return actual === undefined || actual === requestId;
};

/** Прогоны проекта из LangSmith: идентификатор, имя и номер запроса. */
const listRunsViaLangsmith = (project: string): AsyncIterable<RunSummary> => {
  const iterator = async function* iterate(): AsyncGenerator<RunSummary> {
    const { Client } = await import('langsmith');
    const client = new Client();
    for await (const run of client.listRuns({ projectName: project, limit: 50 })) {
      yield {
        id: run.id ? String(run.id) : undefined,
        name: run.name,
        metadata: (run.extra?.metadata ?? {}) as Record<string, unknown>,
      };
    }
  };
  return iterator();
};
