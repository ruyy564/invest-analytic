import { z } from 'zod';

/** Виды результата узла: факты, текст модели или готовый отчёт. */
export const RESULT_KINDS = ['facts', 'analysis', 'report'] as const;

export const CoverageEntrySchema = z.object({
  source: z.string(),
  status: z.enum(['ok', 'missing']),
  items: z.number().optional(),
  reason: z.string().optional(),
});

export const STOP_REASONS = ['answered', 'approval', 'budget', 'guard', 'no_data', 'error'] as const;

/**
 * Типизированный результат узла: смысл передаётся полем `kind`, а не префиксом
 * строки. Раньше отчёт опознавался по `startsWith('Портфель по счетам брокера:')` —
 * любая правка формулировки ломала поведение незаметно.
 */
export const NodeResultSchema = z.object({
  kind: z.enum(RESULT_KINDS),
  /** Полезная нагрузка: markdown для отчёта, факты или текст анализа. */
  payload: z.string(),
  coverage: z.array(CoverageEntrySchema).default([]),
  partial: z.boolean().default(false),
  stopReason: z.enum(STOP_REASONS).optional(),
});

export type NodeResult = z.infer<typeof NodeResultSchema>;

/** Готовый отчёт: единственное место, где выставляется `kind: 'report'`. */
export const reportResult = (
  markdown: string,
  options: { coverage?: NodeResult['coverage']; partial?: boolean } = {},
): NodeResult => ({
  kind: 'report',
  payload: markdown,
  coverage: options.coverage ?? [],
  partial: options.partial ?? false,
  stopReason: options.partial ? 'no_data' : 'answered',
});

/** Текст модели без данных: не подменяет отчёт и не считается фактами. */
export const analysisResult = (text: string): NodeResult => ({
  kind: 'analysis',
  payload: text,
  coverage: [],
  partial: false,
});

/** Отчёт из состояния: используется узлом ответа вместо разбора текста. */
export const reportOfState = (state: { lastResult?: NodeResult }): NodeResult | undefined =>
  state.lastResult?.kind === 'report' ? state.lastResult : undefined;
