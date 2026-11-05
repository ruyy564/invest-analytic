import type { NewsQuery, NewsSourceAdapter, SourceItem, SourceTopic } from '../news.types.js';
import { isDigestTitle } from '../news.filters.js';

import {
  parseFeed,
  type FeedFormat,
  type FeedMapping,
} from '../../parsing/feed.js';

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
 * Источник-лента: один адаптер на все RSS/Atom/JSON-фиды. Новая лента — это
 * запись в реестре источников и маппинг полей, а не новый код.
 */

/** Кэш лент на прогон: пять бумаг читают одни и те же шесть лент подряд. */
const FEED_CACHE_TTL_MS = 300_000;
/** Короткая память ошибки: дольше держать нельзя — теряются новости у следующих бумаг. */
const FEED_FAILURE_TTL_MS = 5_000;
/** Обычные RSS можно тянуть параллельно: они отвечают быстро. */
const FEED_MAX_CONCURRENCY = 4;
/** Паузы перед повтором: сайт может ответить 429 на всплеск запросов. */
const FEED_RETRY_DELAYS_MS = [300, 900];
const feedCache = new Map<string, { at: number; items: SourceItem[] }>();
const feedPending = new Map<string, Promise<SourceItem[]>>();
const feedFailures = new Map<string, { at: number; error: Error }>();

/** Ограничитель одновременных запросов к лентам. */
const createLimiter = (limit: number): (<T>(task: () => Promise<T>) => Promise<T>) => {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
};

const feedSlot = createLimiter(FEED_MAX_CONCURRENCY);

/**
 * Отдаёт разобранные элементы ленты, переиспользуя недавний ответ.
 * Сбой повторяем с паузой и переходим на резервный адрес: публичные ленты
 * отвечают таймаутом или 429 на всплеск запросов.
 */
const loadCached = async (
  urls: readonly string[],
  load: (url: string) => Promise<SourceItem[]>,
): Promise<SourceItem[]> => {
  const cacheKey = urls[0] ?? '';
  const cached = feedCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FEED_CACHE_TTL_MS) {
    return cached.items;
  }
  const failure = feedFailures.get(cacheKey);
  if (failure && Date.now() - failure.at < FEED_FAILURE_TTL_MS) {
    throw failure.error;
  }
  const running = feedPending.get(cacheKey);
  if (running) {
    return running;
  }
  const request = feedSlot(async () => {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= FEED_RETRY_DELAYS_MS.length; attempt += 1) {
      for (const url of urls) {
        try {
          const items = await load(url);
          feedCache.set(cacheKey, { at: Date.now(), items });
          feedFailures.delete(cacheKey);
          return items;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
      const delay = FEED_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    const failureError = lastError ?? new Error('лента недоступна');
    feedFailures.set(cacheKey, { at: Date.now(), error: failureError });
    throw failureError;
  }).finally(() => {
    feedPending.delete(cacheKey);
  });
  feedPending.set(cacheKey, request);
  return request;
};

export const createFeedSource = (options: FeedSourceOptions): NewsSourceAdapter => {
  const fetchText = options.fetchText ?? defaultFetchText;

  return {
    id: options.id,
    topics: options.topics ?? ['news'],
    // Общая лента: поиска по тикеру нет, но фильтр по подстрокам работает.
    supportsTickerQuery: false,
    supportsMatcherQuery: true,
    async fetchNews(query: NewsQuery): Promise<SourceItem[]> {
      const urls = [options.url, options.fallbackUrl].filter(
        (url): url is string => typeof url === 'string' && url.length > 0,
      );
      const items = await loadCached(urls, async (url) => {
        const raw = await fetchText(url);
        return parseFeed(raw, {
          format: options.format,
          source: options.id,
          mapping: options.mapping,
          summaryLimit: options.summaryLimit,
        });
      });

      const since = query.sinceDays
        ? Date.now() - query.sinceDays * 24 * 60 * 60 * 1000
        : undefined;
      // Фильтр по бумагам: заголовок или аннотация должны упоминать тикер
      // либо название компании — иначе это общая лента про спорт и политику.
      const matchers = (query.matchers ?? [])
        .map((matcher) => matcher.trim().toLowerCase())
        .filter((matcher) => matcher.length > 1);
      const relevant = (item: { title: string; summary?: string }): boolean => {
        // Общие сводки («утренний дайджест») к бумаге не относятся, хотя
        // упоминают её в тексте.
        if (isDigestTitle(item.title)) {
          return false;
        }
        if (matchers.length === 0) {
          return true;
        }
        // Проверяем заголовок, а не аннотацию: обзор «народного портфеля» или
        // «акции нефтяных компаний» упоминает бумагу в тексте, но новостью по
        // ней не является.
        const haystack = item.title.toLowerCase();
        return matchers.some((matcher) => haystack.includes(matcher));
      };

      return items
        .filter((item) => !since || Date.parse(item.publishedAt) >= since)
        .filter(relevant)
        .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
        .slice(0, query.maxItems);
    },
  };
};
