import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import type { PlanGroup } from '../../collection/plan.js';
import { withTimeout } from '../../mcp/mcp-tool.adapter.js';
import { CAPABILITIES, capabilityByName, type Capability } from './capabilities.js';

/** Шаг плана: инструмент и аргументы. */
export const PlanStepSchema = z.object({
  tool: z.string().trim().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
});

/** Ответ модели-планировщика: только шаги, без пояснений. */
export const ModelPlanSchema = z.object({
  steps: z.array(PlanStepSchema).min(1).max(12),
});

export type ModelPlan = z.infer<typeof ModelPlanSchema>;

/** Шаг, готовый к исполнению: группа известна из каталога. */
export interface PlannedStep {
  tool: string;
  args: Record<string, unknown>;
  group: PlanGroup;
}

export interface PlannerResult {
  steps: PlannedStep[];
  source: 'model' | 'fallback';
  /** Почему не получилось использовать план модели. */
  reason?: string;
}

export const PLAN_TIMEOUT_MS = 10_000;

/** Разбирает ответ модели без исключений: нужен для повтора и фолбэка. */
export const parseModelPlan = (text: string): ModelPlan | undefined => {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) {
    return undefined;
  }
  try {
    const parsed = ModelPlanSchema.safeParse(JSON.parse(match[0]) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Валидация плана: инструменты берутся только из каталога, аргументы — из шага.
 * Неизвестные шаги отбрасываются; если не осталось ни одного, план невалиден.
 */
export const validatePlan = (
  plan: ModelPlan,
  capabilities: readonly Capability[] = CAPABILITIES,
): { steps: PlannedStep[]; dropped: string[] } => {
  const byName = capabilityByName(capabilities);
  const dropped: string[] = [];
  const steps: PlannedStep[] = [];

  for (const step of plan.steps) {
    const capability = byName.get(step.tool);
    if (!capability) {
      dropped.push(step.tool);
      continue;
    }
    steps.push({ tool: capability.tool, args: { ...capability.args, ...step.args }, group: capability.group });
  }

  return { steps, dropped };
};

const instructionsOf = (capabilities: readonly Capability[], maxSteps: number): string =>
  [
    'Ты планируешь сбор данных для инвестиционного ассистента.',
    'Выбери минимальный набор инструментов, который отвечает на вопрос.',
    `Не больше ${maxSteps} шагов. Не повторяй один инструмент ради одной цели.`,
    'Верни строго JSON: {"steps":[{"tool":"<имя>","args":{}}]}. Без текста вне JSON.',
    'Доступные инструменты:',
    ...capabilities.map((item) => `- ${item.tool}: ${item.description}`),
  ].join('\n');

/**
 * План силами модели: строгая схема, одна повторная попытка, затем — безопасный
 * детерминированный план. Слабый tool-calling провайдера не должен ломать прогон.
 */
export const planWithModel = async (options: {
  model: BaseChatModel;
  question: string;
  capabilities?: readonly Capability[];
  maxSteps?: number;
  timeoutMs?: number;
  fallback?: () => PlannerResult;
}): Promise<PlannerResult> => {
  const capabilities = options.capabilities ?? CAPABILITIES;
  const maxSteps = options.maxSteps ?? 8;
  const fallback =
    options.fallback ??
    (() => fallbackPlanFor('data_lookup', 'portfolio', capabilities));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await withTimeout(
        options.model.invoke([
          new SystemMessage(instructionsOf(capabilities, maxSteps)),
          new HumanMessage(options.question),
        ]),
        options.timeoutMs ?? PLAN_TIMEOUT_MS,
        () => new Error('llm timeout'),
      );
      const text = typeof response.content === 'string' ? response.content : '';
      const parsed = parseModelPlan(text);
      if (!parsed) {
        continue;
      }
      const { steps } = validatePlan(parsed, capabilities);
      if (steps.length > 0) {
        return { steps, source: 'model' };
      }
    } catch {
      // Провайдер недоступен: повтор бессмысленен, сразу безопасный план.
      return { ...fallback(), reason: 'планировщик недоступен' };
    }
  }

  return { ...fallback(), reason: 'план модели не прошёл валидацию' };
};

/** Безопасный план по сценарию: используется, когда модель не справилась. */
export const fallbackPlanFor = (
  intent: string,
  scope: 'portfolio' | 'account' | 'instrument',
  capabilities: readonly Capability[] = CAPABILITIES,
): PlannerResult => {
  const byName = capabilityByName(capabilities);
  const pick = (tools: string[]): PlannedStep[] =>
    tools.flatMap((tool) => {
      const capability = byName.get(tool);
      return capability
        ? [{ tool: capability.tool, args: { ...capability.args }, group: capability.group }]
        : [];
    });

  const steps =
    intent === 'market_news'
      ? pick(['news__search'])
      : intent === 'security_analysis'
        ? pick(['instruments__find', 'instruments__prices'])
        : scope === 'instrument'
          ? pick(['instruments__find'])
          : pick(['portfolio__snapshot']);

  return { steps, source: 'fallback' };
};
