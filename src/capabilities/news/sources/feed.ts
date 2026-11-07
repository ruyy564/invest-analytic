import type { NewsQuery, NewsSourceAdapter, SourceItem, SourceTopic } from '../news.types.js';
import { isDigestTitle } from '../news.filters.js';
import {
  applyPolicy,
  parseCanonicalItem,
  type CanonicalItem,
  type NewsPolicy,
} from '../index.js';
import { HttpGateway } from '../../../platform/http/index.js';

import {
  parseFeed,
  type FeedFormat,
  type FeedMapping,
} from '../../../shared/parsing/feed.js';

export type { FeedFormat, FeedMapping };

/** Параметры источника-ленты: адрес, формат и подмена загрузчика в тестах. */
export interface FeedSourceOptions {
  id: string;
  url: string;
  /** Резервный адрес: пробуем, если основной мост не ответил. */
  fallbackUrl?: string;
  format: FeedFormat;
  topics?: readonly SourceTopic[];
  mapping?: Partial<FeedMapping>;
  /** Подмена загрузчика в тестах; по умолчанию — глобальный fetch. */
  fetchText?: (url: string) => Promise<string>;
  /** Сколько символов аннотации оставлять. */
  summaryLimit?: number;
  /** Политика релевантности: если передана, заменяет встроенные фильтры. */
  policy?: NewsPolicy;
  /** Шлюз запросов: в тестах можно передать свой, чтобы не делить кэш. */
  gateway?: HttpGateway;
}

export { parseFeed };

/** Загрузчик ленты по умолчанию: глобальный fetch с таймаутом и своим UA. */
export const defaultFetchText = async (url: string): Promise<string> => {
  const response = await fetch(url, {
    headers: { 'user-agent': 'invest-analytic/0.1 (+portfolio review)' },
    // Лента не должна съедать весь таймаут тула: медленный источник отбрасываем.
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
};

/**
 * Абсолютная ссылка публикации.
 *
 * Ленты отдают путь без домена (smart-lab: `/blog/tradesignals/1367782.php`),
 * и такой адрес нельзя ни открыть, ни дочитать — достраиваем от адреса ленты.
 */
export const absoluteUrl = (url: string | undefined, base: string): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
};

/** Элемент ленты → канонический вид: проверка схемы и отдельная привязка к бумаге. */
const toCanonical = (item: SourceItem): CanonicalItem | undefined => {
  const parsed = parseCanonicalItem({
    id: item.id,
    title: item.title,
    summary: item.summary,
    url: item.url,
    publishedAt: item.publishedAt,
    source: item.source,
    tags: item.tags,
    instrumentTags: [],
  });
  return parsed.ok ? parsed.item : undefined;
};

/**
 * Источник-лента: один адаптер на все RSS/Atom/JSON-фиды. Сеть, повторы и кэш —
 * в шлюзе, решение о релевантности — в политике (`data/policy/news.yaml`).
 */
export const createFeedSource = (options: FeedSourceOptions): NewsSourceAdapter => {
  const gateway = options.gateway ?? new HttpGateway(options.fetchText ?? defaultFetchText);
  const urls = [options.url, options.fallbackUrl].filter(
    (url): url is string => typeof url === 'string' && url.length > 0,
  );

  const fetchNewsWithReport = async (
    query: NewsQuery,
  ): Promise<{ items: SourceItem[]; dropped?: { reason: string; count: number }[] }> => {
    const response = await gateway.get(urls);
    const parsed = parseFeed(response.text, {
      format: options.format,
      source: options.id,
      mapping: options.mapping,
      summaryLimit: options.summaryLimit,
    });

    const canonical = parsed
      .map(toCanonical)
      .filter((item): item is CanonicalItem => item !== undefined);

    const matchers = (query.matchers ?? [])
      .map((matcher) => matcher.trim())
      .filter((value) => value.length > 1);
    const tickers = (query.tickers ?? [])
      .map((ticker) => ticker.trim().toUpperCase())
      .filter(Boolean);

    // Новая политика: правила в YAML. Без политики — прежнее поведение.
    const governed = options.policy
      ? applyPolicy(
          canonical,
          { mode: matchers.length > 0 ? 'ticker' : 'general', matchers, tickers },
          options.policy,
        )
      : { items: canonical, report: undefined };

    const since = query.sinceDays
      ? Date.now() - query.sinceDays * 24 * 60 * 60 * 1000
      : undefined;
    const legacy = (item: CanonicalItem): boolean => {
      if (isDigestTitle(item.title)) {
        return false;
      }
      if (matchers.length === 0) {
        return true;
      }
      const haystack = item.title.toLowerCase();
      return matchers.some((matcher) => haystack.includes(matcher.toLowerCase()));
    };

    const items = governed.items
      .filter((item) => !since || Date.parse(item.publishedAt) >= since)
      .filter((item) => (options.policy ? true : legacy(item)))
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, query.maxItems)
      // Ссылки в лентах бывают относительными: дочитывание статьи требует домена.
      .map((item) => ({ ...item, url: absoluteUrl(item.url, urls[0]) }));

    return { items, ...(governed.report ? { dropped: governed.report.dropped } : {}) };
  };

  return {
    id: options.id,
    topics: options.topics ?? ['news'],
    // Общая лента: поиска по тикеру нет, но фильтр по подстрокам работает.
    supportsTickerQuery: false,
    supportsMatcherQuery: true,
    fetchNewsWithReport,
    async fetchNews(query: NewsQuery): Promise<SourceItem[]> {
      return (await fetchNewsWithReport(query)).items;
    },
  };
};

