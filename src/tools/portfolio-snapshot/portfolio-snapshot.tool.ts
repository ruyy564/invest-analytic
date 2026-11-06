import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import { toZodV3 } from '../../mcp/tool-schema.js';
import { collectAllAccounts } from './portfolio-snapshot.service.js';

/**
 * Тонкая обёртка тула: сводка по всем открытым счетам одним вызовом, чтобы
 * модель не перебирала счета вручную. Сбор и рендер — в сервисе.
 */
export const createAllAccountsTool = (
  tools: DynamicStructuredTool[],
  name: string,
  timeoutMs: number,
): DynamicStructuredTool => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return new DynamicTool({
    name,
    description:
      'Состав и стоимость портфеля по ВСЕМ открытым счетам брокера: ' +
      'по каждому счёту — бумаги и количество, итоговая стоимость, доходность.',
    schema: toZodV3({ type: 'object', properties: {} }) as never,
    func: async () => collectAllAccounts({ tool: (tool) => byName.get(tool), timeoutMs }),
  } as never);
};
