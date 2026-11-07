import { Logger } from '@nestjs/common';

const logger = new Logger('Tracing');

/** Контекст ссылки на трейс: идентификаторы уже известны сервису. */
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
 * Id корневого прогона в LangSmith по нашей метке `runId`.
 *
 * Id корневого run создаёт SDK, поэтому ссылка на трейс по собственному `runId`
 * ведёт в никуда (`Run not found`). Метка `runId` пишется в metadata — по ней
 * прогон и находится. Ошибка поиска не ломает ответ: ссылка просто не строится.
 */
export const findRootRunId = async (options: {
  apiKey?: string;
  project: string;
  runId: string;
  timeoutMs?: number;
}): Promise<string | undefined> => {
  if (!options.apiKey) {
    return undefined;
  }
  const search = async (): Promise<string | undefined> => {
    const { Client } = await import('langsmith');
    const client = new Client({ apiKey: options.apiKey });
    const filter =
      `and(eq(is_root, true), eq(metadata_key, "runId"), eq(metadata_value, "${options.runId}"))`;
    let found: { id: string; start: string } | undefined;
    for await (const run of client.listRuns({ projectName: options.project, filter, limit: 20 })) {
      const metadata = (run.extra?.metadata ?? {}) as { runId?: string };
      // Корень дерева — только он годится для ссылки.
      if (String(run.parent_run_id ?? '') !== '' || metadata.runId !== options.runId) {
        continue;
      }
      const start = String(run.start_time ?? '');
      if (!found || start > found.start) {
        found = { id: String(run.id), start };
      }
    }
    return found?.id;
  };

  try {
    const timeoutMs = options.timeoutMs ?? 4_000;
    return await Promise.race([
      search(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
    ]);
  } catch (error) {
    logger.warn(`Поиск прогона в LangSmith не удался: ${(error as Error)?.message ?? 'ошибка'}`);
    return undefined;
  }
};

/** Организация для ссылки на трейс: из env, а если не задана — запрашиваем текущую
 *  у LangSmith. Один запрос на процесс: результат кэшируется модулем. */
let cachedOrgId: string | undefined;

export const resolveOrgId = async (apiKey?: string): Promise<string | undefined> => {
  if (!apiKey) {
    return undefined;
  }
  if (cachedOrgId) {
    return cachedOrgId;
  }
  try {
    const response = await fetch('https://api.smith.langchain.com/api/v1/orgs/current', {
      headers: { 'x-api-key': apiKey },
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { id?: string };
    cachedOrgId = body.id;
    return cachedOrgId;
  } catch (error) {
    logger.warn(`Организация LangSmith недоступна: ${(error as Error)?.message ?? String(error)}`);
    return undefined;
  }
};

/** Сброс кэша организации: нужен тестам и смене ключа без перезапуска. */
export const resetOrgIdCache = (): void => {
  cachedOrgId = undefined;
};

