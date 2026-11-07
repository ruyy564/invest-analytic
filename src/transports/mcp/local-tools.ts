import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { CommoditySource } from '../../capabilities/market/commodities/commodity.types.js';
import type { KeyRateSource } from '../../capabilities/market/key-rate/key-rate.types.js';
import type { NewsRegistry } from '../../capabilities/news/news.registry.js';
import { createInstrumentTools } from '../../capabilities/instruments/tools/instruments.tools.js';
import { pickInstruments } from '../../capabilities/instruments/tools/price-dynamics/price-dynamics.service.js';
import { createNewsSearchTool } from '../../capabilities/news/tools/news-search.tool.js';
import type { NewsIndex } from '../../capabilities/news/store/news-index.js';
import { createCommodityTool } from '../../capabilities/market/tools/commodity/commodity.tool.js';
import { createKeyRateTool } from '../../capabilities/market/tools/key-rate/key-rate.tool.js';
import { createFactorsTool } from '../../capabilities/market/tools/factors/factors.tool.js';
import { createCbMeetingsTool } from '../../capabilities/market/cb-meetings/cb-meetings.tool.js';
import { createNewsDigestTool } from '../../capabilities/news/tools/news-digest/news-digest.tool.js';
import { defaultFetchText } from '../../capabilities/news/sources/feed.js';
import { createTaxWatchTool } from '../../capabilities/portfolio/tools/tax-watch/tax-watch.tool.js';
import { withTimeout } from './mcp-tool.adapter.js';

/** Настройки, которые нужны локальным тулам: таймауты и лимиты выборки. */
export interface LocalToolsConfig {
  timeoutMs: number;
  scanPages: number;
  maxItems: number;
  taxKeywordsFile: string;
  /** Файл алиасов эмитентов: по нему новостной фасад ищет бумагу по имени. */
  tickerAliasesFile?: string;
  /** Загрузчик страниц: дочитывание статей в новостном фасаде (в тестах — подмена). */
  fetchText?: (url: string) => Promise<string>;
  /** Файл профилей: по нему новостной фасад подбирает факторы поиска причин. */
  profilesFile?: string;
  /** План заседаний ЦБ: даты решений по ставке для блока «чего ждём». */
  cbMeetingsFile?: string;
  /** Индекс собранных публикаций: история новостей и кэш текстов статей. */
  index?: NewsIndex;
}

/**
 * Класс торгов по тикеру: брокер ищет новости по `TICKER_CLASSCODE` и отвечает
 * «Instrument not found» на один тикер — без этого новости эмитента терялись.
 * Ответ кэшируется: за прогон бумага спрашивается не один раз.
 */
const createInstrumentResolver = (
  byName: Map<string, DynamicStructuredTool>,
  timeoutMs: number,
): ((ticker: string) => Promise<string | undefined>) => {
  const cache = new Map<string, string | undefined>();

  return async (requested: string): Promise<string | undefined> => {
    const key = requested.trim().toUpperCase();
    if (cache.has(key)) {
      return cache.get(key);
    }
    const tool = byName.get('invest_find_instrument');
    if (!tool) {
      return undefined;
    }
    try {
      const raw = await withTimeout(
        tool.invoke({ query: key } as never),
        timeoutMs,
        () => new Error('таймаут поиска бумаги'),
      );
      const best = pickInstruments(raw, key)[0];
      const id = best?.classCode ? `${best.ticker}_${best.classCode}` : undefined;
      cache.set(key, id);
      return id;
    } catch {
      // Не нашли класс торгов — новостной фасад продолжит по лентам.
      return undefined;
    }
  };
};

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
          aliasesFile: config.tickerAliasesFile,
          resolveInstrumentId: createInstrumentResolver(byName, config.timeoutMs),
          // Дочитывание статей целиком: причины обычно в тексте, не в заголовке.
          fetchText: config.fetchText ?? defaultFetchText,
          // Факторы поиска причин: драйверы сектора бумаги и общие рыночные.
          profilesFile: config.profilesFile,
          // Индекс: история публикаций шире сетевого окна и кэш текстов статей.
          index: config.index,
        }),
        createTaxWatchTool({ ...shared, newsRegistry }),
      ]
    : [];
  return [
    ...news,
    ...(keyRate ? [createKeyRateTool(keyRate)] : []),
    ...(commodity ? [createCommodityTool(commodity)] : []),
    // Рыночные факторы числами: нефть, курс, ставка — аргументы для причин.
    createFactorsTool({ tool: (name) => byName.get(name), timeoutMs: config.timeoutMs, keyRate }),
    // Календарь ЦБ: даты заседаний из плана регулятора, без парсинга сайта.
    createCbMeetingsTool({ file: config.cbMeetingsFile ?? 'data/cb-meetings.yaml' }),
    // Доменные фасады бумаг: модель видит шесть операций, а не десятки вызовов брокера.
    ...createInstrumentTools({ lookup: (name) => byName.get(name), timeoutMs: config.timeoutMs }),
  ];
};
