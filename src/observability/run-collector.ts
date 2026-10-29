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
 * Запоминает идентификатор корневого прогона из callback-событий LangChain,
 * чтобы собрать `traceUrl` без разбора внутренних структур LangSmith.
 */
export class RunCollector {
  readonly name = 'RunCollector';
  private rootRunId?: string;

  handleChainStart(_chain: unknown, _inputs: unknown, runId: string): void {
    if (!this.rootRunId) {
      this.rootRunId = runId;
    }
  }

  get runId(): string | undefined {
    return this.rootRunId;
  }
}
