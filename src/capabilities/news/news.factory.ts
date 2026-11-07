import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { AppConfig } from '../../platform/config/configuration.js';
import { createFeedSource, defaultFetchText, type FeedFormat } from './sources/feed.js';
import { FEED_DEFAULTS, feedFallbackUrl, feedUrl } from './sources/defaults.js';
import { NewsRegistry } from './news.registry.js';
import { createTinkoffNewsSource } from './sources/tinkoff.js';
import { createSmartLabTagSource } from './sources/smartlab-tag.js';
import { createRbcQuoteSource } from './sources/rbc-quote.js';
import { createTbankResearchSource } from './sources/tbank-research.js';
import { loadExtraFeeds } from './sources/extra.js';
import { loadNewsPolicy, type NewsPolicy } from './index.js';
import type { NewsSourceAdapter } from './news.types.js';

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
  const news: NewsSourceAdapter[] = [];
  // Политика релевантности: включена по умолчанию, отключается флагом.
  const policy: NewsPolicy | undefined = config.sources.news.policyV2
    ? loadNewsPolicy(config.sources.news.policyFile)
    : undefined;

  if (enabled.has('tinkoff')) {
    news.push(
      createTinkoffNewsSource({
        tool: deps.tool,
        timeoutMs: config.run.mcpToolTimeoutMs,
        policy,
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
        policy,
        // Ошибка по бумаге не должна теряться: она видна в логе сервиса.
        onError: (ticker, error) =>
          console.warn(`[smartlab_tag] ${ticker}:`, error.message.slice(0, 120)),
      }),
    );
  }

  // РБК Инвестиции и research Т-Инвестиций: HTML-страницы с SSR-состоянием.
  // Telegram не используется — у брокеров нет публичного RSS.
  if (enabled.has('rbc_quote')) {
    news.push(
      createRbcQuoteSource({
        url: env.NEWS_RBC_QUOTE_URL?.trim() || undefined,
        fetchText: deps.fetchText,
        policy,
      }),
    );
  }
  if (enabled.has('tbank_research')) {
    news.push(
      createTbankResearchSource({
        url: env.NEWS_TBANK_RESEARCH_URL?.trim() || undefined,
        fetchText: deps.fetchText,
        policy,
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
        policy,
      }),
    );
  }

  // Дополнительные ленты из файла: новый источник подключается данными, а не кодом.
  // Файла нет или сбор не включён в `SOURCES` — список пуст, поведение не меняется.
  if (enabled.has('news_extra')) {
    for (const feed of loadExtraFeeds(config.sources.news.extraFeedsFile)) {
      news.push(
        createFeedSource({
          id: feed.id,
          url: feed.url,
          fallbackUrl: feed.fallbackUrl,
          format: feed.format,
          topics: feed.topics,
          summaryLimit: feed.summaryLimit,
          fetchText: deps.fetchText,
          policy,
        }),
      );
    }
  }

  return new NewsRegistry(news);
};
