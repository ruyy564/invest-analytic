import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { AppConfig } from '../config/configuration.js';
import { createFeedSource, defaultFetchText, type FeedFormat } from './sources/feed.js';
import { FEED_DEFAULTS, feedFallbackUrl, feedUrl } from './sources/defaults.js';
import { NewsRegistry } from './news.registry.js';
import { createTinkoffNewsSource } from './sources/tinkoff.js';
import { createSmartLabTagSource } from './sources/smartlab-tag.js';

export interface NewsFactoryDeps {
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
export const buildNewsRegistry = (deps: NewsFactoryDeps): NewsRegistry => {
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

  if (enabled.has('smartlab_tag')) {
    // Лента smart-lab по тикеру: единственный источник, который знает бумагу
    // заранее, поэтому именно он даёт news по каждой позиции.
    news.push(
      createSmartLabTagSource({
        template: env.NEWS_SMARTLAB_TAG_URL?.trim() || undefined,
        fetchText: deps.fetchText ?? defaultFetchText,
        summaryLimit: 600,
        // Ошибка по бумаге не должна теряться: она видна в логе сервиса.
        onError: (ticker, error) =>
          console.warn(`[smartlab_tag] ${ticker}:`, error.message.slice(0, 120)),
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
        fallbackUrl: feedFallbackUrl(feed, env),
        format: feed.format as FeedFormat,
        topics: feed.topics,
        mapping: feed.mapping,
        summaryLimit: feed.summaryLimit,
        fetchText: deps.fetchText,
      }),
    );
  }

  return new NewsRegistry(news);
};
