import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import { toZodV3 } from '../../../../transports/mcp/tool-schema.js';
import { openAccountIds } from './tax-watch.service.js';
import type { NewsRegistry } from '../../../news/index.js';
import { loadTaxKeywords } from '../../../market/index.js';
import {
  collectTaxFacts,
  formatTaxFacts,
  TAX_WATCH_TOOL,
} from './tax-watch.service.js';

/** Параметры тула налогов: новостной реестр, счета и словарь терминов. */
export interface TaxWatchToolOptions {
  newsRegistry: NewsRegistry;
  byName: Map<string, DynamicStructuredTool>;
  timeoutMs: number;
  scanPages: number;
  maxItems: number;
  taxKeywordsFile: string;
}

/** Тонкая обёртка: удержанные налоги и публикации об изменениях. */
export const createTaxWatchTool = (options: TaxWatchToolOptions): DynamicStructuredTool => {
  const { newsRegistry, byName, timeoutMs, scanPages, maxItems, taxKeywordsFile } = options;
  return new DynamicTool({
    name: TAX_WATCH_TOOL,
    description:
      'Налоги: фактически удержанные суммы из истории операций и публикации об изменениях ' +
      'налогообложения по словарю терминов.',
    schema: toZodV3({ type: 'object', properties: {} }) as never,
    func: async () => {
      const accounts = await openAccountIds(byName, timeoutMs);
      const facts = await collectTaxFacts({
        registry: newsRegistry,
        tool: (tool) => byName.get(tool),
        timeoutMs,
        accounts,
        keywords: loadTaxKeywords(taxKeywordsFile),
        pages: scanPages,
        maxItems,
      });
      return formatTaxFacts(facts);
    },
  } as never);
};
