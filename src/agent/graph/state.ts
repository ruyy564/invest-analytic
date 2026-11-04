import { MessagesValue, StateSchema } from '@langchain/langgraph';
import * as z from 'zod';

/** Сценарий вопроса: от него зависит ветка графа и вид ответа. */
export const INTENTS = [
  'data_lookup',
  'security_analysis',
  'portfolio_review',
  'off_topic',
] as const;
export type Intent = (typeof INTENTS)[number];

/** План сбора в состоянии: сериализуемые записи (см. src/collection/plan.ts). */
export const PlanEntrySchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  group: z.string(),
  priority: z.enum(['mandatory', 'optional']),
  target: z.string().optional(),
});

export const CollectionSchema = z.object({
  results: z.record(z.string(), z.string()).default({}),
  coverage: z
    .array(
      z.object({
        source: z.string(),
        status: z.enum(['ok', 'missing']),
        items: z.number().optional(),
        reason: z.string().optional(),
      }),
    )
    .default([]),
  partial: z.boolean().default(false),
});

/** Состояние прогона: история, интент, план сбора, результаты и отчёт. */
export const AgentState = new StateSchema({
  messages: MessagesValue,
  intent: z.enum(INTENTS).default('off_topic'),
  partial: z.boolean().default(false),
  dataAsOf: z.string().optional(),
  /** Время постановки в `interrupt` — для проверки срока подтверждения. */
  approvalRequestedAt: z.string().optional(),
  /** План чтений: подтверждается целиком и исполняется в ветке разбора. */
  readingPlan: z.array(PlanEntrySchema).default([]),
  /** Результаты сбора: тексты инструментов по ключу плана. */
  collection: CollectionSchema.optional(),
  /** Идентификатор сохранённого отчёта для выгрузки. */
  reportId: z.string().optional(),
  /** Версия шаблона, по которому собран отчёт. */
  reportTemplateVersion: z.number().optional(),
  reportType: z.enum(['data_answer', 'portfolio_report', 'deep_review']).optional(),
});

export type AgentStateType = typeof AgentState.State;

