import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { CommoditySource } from '../../capabilities/market/commodities/commodity.types.js';
import type { KeyRateSource } from '../../capabilities/market/key-rate/key-rate.types.js';
import type { NewsRegistry } from '../../capabilities/news/news.registry.js';
import { createInstrumentTools } from '../../capabilities/instruments/tools/instruments.tools.js';
import { createNewsSearchTool } from '../../capabilities/news/tools/news-search.tool.js';
import { createCommodityTool } from '../../capabilities/market/tools/commodity/commodity.tool.js';
import { createKeyRateTool } from '../../capabilities/market/tools/key-rate/key-rate.tool.js';
import { createNewsDigestTool } from '../../capabilities/news/tools/news-digest/news-digest.tool.js';
import { createTaxWatchTool } from '../../capabilities/portfolio/tools/tax-watch/tax-watch.tool.js';

/** Настройки, которые нужны локальным тулам: таймауты и лимиты выборки. */
export interface LocalToolsConfig {
  timeoutMs: number;
  scanPages: number;
  maxItems: number;
  taxKeywordsFile: string;
}

/**
 * Сборка тематических тулов из их папок. Сами тулы живут в `tools/<tool>/`,
 * здесь только подключение: реестр новостей, источник ставки и лимиты.
 */
export const createThematicTools = (options: {
  newsRegistry?: NewsRegistry;
  keyRate?: KeyRateSource;
  commodity?: CommoditySource;
  byName: Map<string, DynamicStructuredTool>;
  config: LocalToolsConfig;
}): DynamicStructuredTool[] => {
  const { newsRegistry, keyRate, commodity, byName, config } = options;
  const shared = {
    newsRegistry,
    byName,
    timeoutMs: config.timeoutMs,
    scanPages: config.scanPages,
    maxItems: config.maxItems,
    taxKeywordsFile: config.taxKeywordsFile,
  };

  // Новостные тулы требуют лент; макро-тулы работают и без них.
  const news = newsRegistry
    ? [
        createNewsDigestTool({ ...shared, newsRegistry }),
        // Фасад: параметры запроса вместо фиксированной сводки по периодам.
        createNewsSearchTool({
          registry: newsRegistry,
          scanPages: config.scanPages,
          maxItems: config.maxItems,
        }),
        createTaxWatchTool({ ...shared, newsRegistry }),
      ]
    : [];
  return [
    ...news,
    ...(keyRate ? [createKeyRateTool(keyRate)] : []),
    ...(commodity ? [createCommodityTool(commodity)] : []),
    // Доменные фасады бумаг: модель видит шесть операций, а не десятки вызовов брокера.
    ...createInstrumentTools({ lookup: (name) => byName.get(name), timeoutMs: config.timeoutMs }),
  ];
};
