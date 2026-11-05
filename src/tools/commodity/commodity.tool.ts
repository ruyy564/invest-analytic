import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import type { CommoditySource } from '../../commodities/commodity.types.js';
import { toZodV3 } from '../../mcp/tool-schema.js';
import { collectCommodities, formatCommodities, COMMODITY_TOOL } from './commodity.service.js';

/** Тонкая обёртка: учётные цены драгметаллов ЦБ. */
export const createCommodityTool = (
  source: CommoditySource | undefined,
): DynamicStructuredTool =>
  new DynamicTool({
    name: COMMODITY_TOOL,
    description:
      'Учётные цены драгметаллов ЦБ (золото, серебро, платина, палладий) в рублях за грамм.',
    schema: toZodV3({ type: 'object', properties: {} }) as never,
    func: async () => formatCommodities(await collectCommodities(source)),
  } as never);
