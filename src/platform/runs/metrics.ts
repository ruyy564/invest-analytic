/** Запись прогона для метрик: берётся из журнала (`run_finished`). */
export interface RunMetricEvent {
  intent?: string;
  partial?: boolean;
  stopReason?: string;
  durationMs?: number;
  /** Отказы модели при формировании разделов. */
  refusals?: number;
  /** Инструменты прогона: строка или запись со статусом. */
  tools?: (string | { name?: string; ok?: boolean })[];
  usage?: { inputTokens?: number; outputTokens?: number };
  costUsd?: number;
  coverage?: { source?: string; status?: string }[];
}

export interface IntentMetrics {
  runs: number;
  partialRate: number;
  refusalRate: number;
  toolErrorRate: number;
  costUsd: number;
  p50Ms: number;
  p95Ms: number;
}

const rate = (part: number, total: number): number => (total === 0 ? 0 : part / total);

/** Перцентиль по ближайшему рангу: для десятков прогонов достаточно. */
const percentile = (values: number[], share: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1);
  return sorted[Math.max(0, index)];
};

const toolErrors = (event: RunMetricEvent): number => {
  const tools = event.tools ?? [];
  const failed = tools.filter((tool) => typeof tool !== 'string' && tool.ok === false).length;
  const missing = (event.coverage ?? []).filter((entry) => entry.status === 'missing').length;
  return failed + missing;
};

const toolCalls = (event: RunMetricEvent): number =>
  (event.tools ?? []).length + (event.coverage ?? []).length;

/** Агрегация журналов по интентам: без сети и без внешних сервисов. */
export const summarizeRuns = (
  events: readonly RunMetricEvent[],
): { byIntent: Record<string, IntentMetrics>; total: IntentMetrics } => {
  const groups = new Map<string, RunMetricEvent[]>();
  for (const event of events) {
    const intent = event.intent ?? 'unknown';
    groups.set(intent, [...(groups.get(intent) ?? []), event]);
  }

  const summarize = (list: readonly RunMetricEvent[]): IntentMetrics => {
    const durations = list
      .map((event) => event.durationMs)
      .filter((value): value is number => typeof value === 'number' && value >= 0);
    const errors = list.reduce((sum, event) => sum + toolErrors(event), 0);
    const calls = list.reduce((sum, event) => sum + toolCalls(event), 0);
    const refusals = list.reduce((sum, event) => sum + (event.refusals ?? 0), 0);

    return {
      runs: list.length,
      partialRate: rate(list.filter((event) => event.partial === true).length, list.length),
      refusalRate: rate(refusals, list.length),
      toolErrorRate: rate(errors, calls),
      costUsd: list.reduce((sum, event) => sum + (event.costUsd ?? 0), 0),
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
    };
  };

  return {
    byIntent: Object.fromEntries(
      [...groups.entries()].map(([intent, list]) => [intent, summarize(list)]),
    ),
    total: summarize(events),
  };
};
