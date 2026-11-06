import { MessagesValue, StateSchema } from '@langchain/langgraph';
import * as z from 'zod';
import { NodeResultSchema } from '../results/node-result.js';

/** Сценарий вопроса: от него зависит ветка графа и вид ответа. */
export const INTENTS = [
  'data_lookup',
  'security_analysis',
  'portfolio_review',
  'market_news',
  'agent_help',
  'knowledge_question',
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
  /** Область разбора: весь портфель, счёт или отдельная бумага. */
  scope: z.enum(['portfolio', 'account', 'instrument']).default('portfolio'),
  /** Тикер для бумаги, идентификатор счёта для счёта. */
  scopeTarget: z.string().optional(),
  /** Подпись области для отчёта и запроса подтверждения («бумаги SBER»). */
  scopeLabel: z.string().optional(),
  /** Откуда взят сценарий: правило, модель, безопасный вариант или guard. */
  routeSource: z.enum(['rule', 'model', 'fallback', 'guard']).optional(),
  /** Ответ guardrail: текст возвращается без обращения к модели. */
  guardAnswer: z.string().optional(),
  /** Нужны данные состава портфеля: решает правило маршрутизации. */
  dataNeed: z.enum(['portfolio']).optional(),
  /** Типизированный результат узла: отчёт, факты или анализ. */
  lastResult: NodeResultSchema.optional(),
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
  reportType: z
    .enum(['data_answer', 'portfolio_report', 'deep_review', 'market_news'])
    .optional(),
});

export type AgentStateType = typeof AgentState.State;

