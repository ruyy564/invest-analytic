import { DynamicStructuredTool } from '@langchain/core/tools';
import { toZodV3 } from '../../../../transports/mcp/tool-schema.js';
import { collectFactors, FACTORS_TOOL, formatFactors, type FactorsDeps } from './factors.service.js';

/**
 * Рыночные факторы числами: нефть Brent, курс доллара и юаня, ключевая ставка.
 * Нужны вопросам о причинах: «нефть −4 % за месяц» — довод, «возможно, нефть
 * выросла» — догадка.
 */
export const createFactorsTool = (deps: FactorsDeps): DynamicStructuredTool =>
  new DynamicStructuredTool({
    name: FACTORS_TOOL,
    description:
      'Рыночные факторы числами: нефть Brent, курс доллара и юаня, ключевая ставка ЦБ — ' +
      'значение и изменение за период. Для вопросов «почему упал/вырос», «что с рынком».',
    schema: toZodV3({
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Период в днях, по умолчанию 30' },
      },
    }) as never,
    func: async (input: unknown) => {
      const args = (input ?? {}) as { days?: number };
      const days = Number.isFinite(args.days) && Number(args.days) > 0 ? Number(args.days) : 30;
      return formatFactors(await collectFactors(deps, days));
    },
  } as never);
