import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { KeyRateSource } from '../key-rate/key-rate.types.js';
import type { NewsRegistry } from '../news/news.registry.js';
import { createKeyRateTool } from '../tools/key-rate/key-rate.tool.js';
import { createNewsDigestTool } from '../tools/news-digest/news-digest.tool.js';
import { createTaxWatchTool } from '../tools/tax-watch/tax-watch.tool.js';

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
  byName: Map<string, DynamicStructuredTool>;
  config: LocalToolsConfig;
}): DynamicStructuredTool[] => {
  const { newsRegistry, keyRate, byName, config } = options;
  if (!newsRegistry) {
    return [];
  }

  const shared = {
    newsRegistry,
    byName,
    timeoutMs: config.timeoutMs,
    scanPages: config.scanPages,
    maxItems: config.maxItems,
    taxKeywordsFile: config.taxKeywordsFile,
  };

  return [
    createNewsDigestTool(shared),
    createTaxWatchTool(shared),
    ...(keyRate ? [createKeyRateTool(keyRate)] : []),
  ];
};
