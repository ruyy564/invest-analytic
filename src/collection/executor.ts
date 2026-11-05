import type { DynamicStructuredTool } from '@langchain/core/tools';
import { withTimeout } from '../mcp/mcp-tool.adapter.js';
import type { ToolBudget } from '../mcp/tool-budget.js';
import { planKey, type CollectionPlan, type PlanEntry } from './plan.js';
import type { CoverageEntry } from '../news/news.registry.js';

export interface ExecuteDeps {
  /** Инструмент по имени: MCP-инструменты и локальные живут в одном наборе. */
  tool: (name: string) => DynamicStructuredTool | undefined;
  budget: ToolBudget;
  parallelism: number;
  timeoutMs: number;
  /** Крючок трейсинга: имя записи и её вид данных. */
  onEntry?: (entry: PlanEntry, ok: boolean, durationMs: number) => void;
}

export interface CollectionResult {
  /** Результаты по ключу `planKey`: тексты инструментов как есть. */
  results: Map<string, string>;
  coverage: CoverageEntry[];
  /** Запросов не выполнено из-за бюджета или ошибок. */
  partial: boolean;
}

const isRateLimited = (message: string): boolean => /\b429\b|rate.?limit/i.test(message);

const runEntry = async (
  entry: PlanEntry,
  deps: ExecuteDeps,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> => {
  const tool = deps.tool(entry.tool);
  if (!tool) {
    return { ok: false, reason: 'инструмент недоступен' };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await withTimeout(
        tool.invoke(entry.args as never),
        deps.timeoutMs,
        () => new Error('таймаут'),
      );
      return { ok: true, text: typeof raw === 'string' ? raw : JSON.stringify(raw) };
    } catch (error) {
      const message = (error as Error)?.message ?? 'ошибка';
      // Один повтор на rate limit: остальные ошибки сразу уходят в покрытие.
      if (attempt === 0 && isRateLimited(message)) {
        continue;
      }
      return { ok: false, reason: message };
    }
  }
  return { ok: false, reason: 'превышен лимит запросов' };
};

/**
 * Исполнение плана: сначала обязательные записи, затем дополнительные, пачками
 * по `parallelism`. Бюджет общий на прогон, ошибки не прерывают сбор.
 */
export const executePlan = async (
  plan: CollectionPlan,
  deps: ExecuteDeps,
): Promise<CollectionResult> => {
  const results = new Map<string, string>();
  const coverage: CoverageEntry[] = [];
  const done = new Set<string>();
  let partial = false;

  const ordered = [...plan.entries].sort((left, right) =>
    left.priority === right.priority ? 0 : left.priority === 'mandatory' ? -1 : 1,
  );

  const batchSize = Math.max(1, deps.parallelism);
  for (let index = 0; index < ordered.length; index += batchSize) {
    const batch = ordered.slice(index, index + batchSize);

    await Promise.all(
      batch.map(async (entry) => {
        const key = planKey(entry);
        if (done.has(key)) {
          return;
        }
        done.add(key);

        if (!deps.budget.hasCallsLeft() || deps.budget.isExpired()) {
          partial = true;
          coverage.push({
            source: entry.tool,
            status: 'missing',
            reason: 'бюджет прогона исчерпан',
          });
          return;
        }

        deps.budget.registerCall();
        const startedAt = Date.now();
        const outcome = await runEntry(entry, deps);
        deps.onEntry?.(entry, outcome.ok, Date.now() - startedAt);

        if (outcome.ok) {
          results.set(key, outcome.text);
          coverage.push({ source: entry.tool, status: 'ok' });
        } else {
          partial = true;
          coverage.push({ source: entry.tool, status: 'missing', reason: outcome.reason });
        }
      }),
    );
  }

  return { results, coverage, partial };
};

/** Все результаты группы: нужно для разбора по бумагам. */
export const resultsInGroup = (
  plan: CollectionPlan,
  collected: CollectionResult,
  group: string,
): { entry: PlanEntry; text: string }[] =>
  plan.entries.flatMap((entry) => {
    if (entry.group !== group) {
      return [];
    }
    const text = collected.results.get(planKey(entry));
    return text === undefined ? [] : [{ entry, text }];
  });
