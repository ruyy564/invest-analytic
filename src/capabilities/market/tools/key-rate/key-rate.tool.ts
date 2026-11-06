import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import { toZodV3 } from '../../../../transports/mcp/tool-schema.js';
import type { KeyRateSource } from '../../key-rate/key-rate.types.js';
import { collectKeyRate, formatKeyRate, KEY_RATE_TOOL } from './key-rate.service.js';

/** Тонкая обёртка: текущая ставка ЦБ и история решений. */
export const createKeyRateTool = (source: KeyRateSource | undefined): DynamicStructuredTool =>
  new DynamicTool({
    name: KEY_RATE_TOOL,
    description:
      'Ключевая ставка ЦБ: текущее значение, дата решения и история изменений с указанием источника.',
    schema: toZodV3({ type: 'object', properties: {} }) as never,
    func: async () => formatKeyRate(await collectKeyRate(source)),
  } as never);
