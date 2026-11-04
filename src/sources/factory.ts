import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { AppConfig } from '../config/configuration.js';
import { createCbrSource } from './cbr.js';
import { createFeedSource, type FeedFormat } from './feed.js';
import { FEED_DEFAULTS, feedUrl } from './defaults.js';
import { KeyRateCache } from './key-rate-cache.js';
import { SourceRegistry } from './registry.js';
import { createTinkoffNewsSource } from './tinkoff.js';

export interface SourceFactoryDeps {
  config: AppConfig;
  /** Инструмент MCP по короткому имени: `invest_get_news`. */
  tool: (name: string) => DynamicStructuredTool | undefined;
  env?: NodeJS.ProcessEnv;
  /** Подмена загрузчика лент в тестах. */
  fetchText?: (url: string, init?: RequestInit) => Promise<string>;
}

/**
 * Собирает реестр источников по конфигурации: брокер (MCP) + выбранные ленты +
 * источник ключевой ставки. Новая лента добавляется конфигом, не кодом.
 */
export const buildSourceRegistry = (deps: SourceFactoryDeps): SourceRegistry => {
  const { config } = deps;
  const enabled = new Set(config.sources.enabled);
  const env = deps.env ?? process.env;
  const news: ReturnType<typeof createFeedSource>[] = [];

  if (enabled.has('tinkoff')) {
    news.push(
      createTinkoffNewsSource({
        tool: deps.tool,
        timeoutMs: config.run.mcpToolTimeoutMs,
      }),
    );
  }

  for (const id of config.sources.news.ids) {
    if (!enabled.has(id)) {
      continue;
    }
    const feed = FEED_DEFAULTS[id];
    if (!feed) {
      continue;
    }
    news.push(
      createFeedSource({
        id: feed.id,
        url: feedUrl(feed, env),
        format: feed.format as FeedFormat,
        topics: feed.topics,
        mapping: feed.mapping,
        fetchText: deps.fetchText,
      }),
    );
  }

  const keyRate = enabled.has('cbr')
    ? createCbrSource({
        mode: config.sources.keyRate.mode,
        soapUrl: config.sources.keyRate.soapUrl,
        htmlUrl: config.sources.keyRate.htmlUrl,
        seedFile: config.sources.keyRate.seedFile,
        cache: new KeyRateCache(
          config.state.backend === 'sqlite' ? config.state.sqlitePath : ':memory:',
          config.sources.keyRate.cacheTtlHours,
        ),
        fetchText: deps.fetchText,
      })
    : undefined;

  return new SourceRegistry(news, keyRate);
};
