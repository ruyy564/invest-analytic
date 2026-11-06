import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import { toZodV3 } from '../../mcp/tool-schema.js';
import { collectDynamics } from './price-dynamics.service.js';

/** Локальный инструмент: динамика цены бумаги за период по дневным свечам. */

/**
 * Тонкая обёртка тула: схема аргументов, описание для модели и вызов сервиса.
 * Сбор, маппинг и форматирование живут в `price-dynamics.service.ts`.
 */
export const createPriceDynamicsTool = (
  tools: DynamicStructuredTool[],
  name: string,
  timeoutMs: number,
): DynamicStructuredTool => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return new DynamicTool({
    name,
    description:
      'Динамика цены бумаги за период: изменение в валюте и процентах, минимум и максимум ' +
      'с датами. Используй для вопросов «почему упал/вырос X», «что с ценой за полгода».',
    schema: toZodV3({
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Тикер или название: PLZL, Полюс, SBER' },
        days: { type: 'number', description: 'Период в днях, по умолчанию 180' },
      },
      required: ['ticker'],
    }) as never,
    func: async (input: unknown) => {
      const args = (input ?? {}) as { ticker?: string; days?: number };
      const days = Number.isFinite(args.days) && Number(args.days) > 0 ? Number(args.days) : 180;
      return collectDynamics(
        { tool: (tool) => byName.get(tool), timeoutMs },
        args.ticker ?? '',
        days,
      );
    },
  } as never);
};
