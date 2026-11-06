import { parseFeed } from './feed.js';
import { isDigestTitle } from '../news.filters.js';
import type { NewsQuery, NewsSourceAdapter, SourceItem } from '../news.types.js';
import type { NewsPolicy } from '../index.js';
import { withReport } from './policy.js';

/** Лента smart-lab по тикеру: разборы и новости конкретной бумаги. */
export const SMARTLAB_TAG_TOOL = 'smartlab_tag';

/** Шаблон адреса: `{ticker}` подставляется вместо тикера. */
export const SMARTLAB_TAG_URL = 'https://smart-lab.ru/rss/tag/{ticker}';

export interface SmartLabTagOptions {
  /** Шаблон адреса, по умолчанию `https://smart-lab.ru/rss/tag/{ticker}`. */
  template?: string;
  fetchText: (url: string) => Promise<string>;
  /** Сколько бумаг читать за один запрос. */
  maxTickers?: number;
  summaryLimit?: number;
  onError?: (ticker: string, error: Error) => void;
  /** Политика релевантности: заменяет встроенные фильтры. */
  policy?: NewsPolicy;
}

/**
 * Адаптер smart-lab: у площадки есть лента на каждый тикер, поэтому в отличие
 * от общих лент здесь новости уже привязаны к бумаге — фильтр по подстрокам
 * нужен только чтобы отсечь общие посты, попавшие в тег.
 */
export const createSmartLabTagSource = (options: SmartLabTagOptions): NewsSourceAdapter => {
  const template = options.template ?? SMARTLAB_TAG_URL;
  const maxTickers = options.maxTickers ?? 10;

  const fetchNews = async (query: NewsQuery): Promise<SourceItem[]> => {
    const tickers = (query.tickers ?? [])
      .map((ticker) => ticker.trim().toUpperCase())
      .filter((ticker) => ticker.length > 0)
      .slice(0, maxTickers);
    if (tickers.length === 0) {
      return [];
    }

    const matchers = (query.matchers ?? [])
      .map((matcher) => matcher.trim().toLowerCase())
      .filter((matcher) => matcher.length > 1);
    const items: SourceItem[] = [];

    for (const ticker of tickers) {
      try {
        const raw = await options.fetchText(template.replace('{ticker}', ticker));
        const parsed = parseFeed(raw, {
          format: 'rss',
          source: 'smartlab',
          summaryLimit: options.summaryLimit ?? 600,
        });
        for (const item of parsed) {
          if (isDigestTitle(item.title)) {
            continue;
          }
          // Общие посты попадают в тег вместе с бумагами: сверяем текст.
          const haystack = `${item.title} ${item.summary ?? ''}`.toLowerCase();
          const relevant =
            matchers.length === 0 || matchers.some((matcher) => haystack.includes(matcher));
          if (relevant) {
            // Лента тега уже привязана к бумаге: это привязка от источника.
            items.push({ ...item, instrumentTags: [ticker] });
          }
        }
      } catch (error) {
        options.onError?.(ticker, error instanceof Error ? error : new Error(String(error)));
      }
    }

    return items
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, query.maxItems);
  };

  return {
    id: 'smartlab_tag',
    topics: ['news'],
    supportsTickerQuery: true,
    ...withReport(fetchNews, options.policy),
  };
};
