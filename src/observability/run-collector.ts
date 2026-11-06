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
 * Организация для ссылки на трейс: из env, а если не задана — запрашиваем текущую
 * у LangSmith. Один запрос на процесс: результат кэшируется модулем.
 */
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

