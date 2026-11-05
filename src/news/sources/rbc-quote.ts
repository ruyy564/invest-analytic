import { asRecord, asString, jsonScriptsOf } from '../../parsing/html.js';
import { stripMarkup } from '../../parsing/feed.js';
import { isDigestTitle } from '../news.filters.js';
import type { NewsQuery, NewsSourceAdapter, SourceItem } from '../news.types.js';
import { defaultFetchText } from './feed.js';

/** Лента РБК Инвестиций: новости фондового рынка и котировки. */
export const RBC_QUOTE_URL = 'https://www.rbc.ru/quote';
export const RBC_QUOTE_SOURCE = 'rbc_quote';

export interface RbcQuoteOptions {
  url?: string;
  fetchText?: (url: string) => Promise<string>;
  summaryLimit?: number;
}

const rawItemsOf = (pageProps: Record<string, unknown>): Record<string, unknown>[] => {
  const collect = (value: unknown): Record<string, unknown>[] => {
    const items = asRecord(value)?.items;
    return Array.isArray(items) ? items.map(asRecord).filter((item) => item !== undefined) : [];
  };
  // На странице два списка: материалы раздела и общая новостная лента.
  return [...collect(pageProps.materials), ...collect(pageProps.newsfeed)];
};

const tickersOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .map((ticker) => asString(asRecord(ticker)?.title)?.toUpperCase())
    .filter((ticker): ticker is string => ticker !== undefined);

/**
 * `__NEXT_DATA__` страницы РБК Инвестиций → новости.
 * Заголовок у материалов лежит в `header`/`titleOnMain`, дата — RFC 2822,
 * тикеры — объекты с полем `title` (`SBER`, `VTBR`).
 */
export const parseRbcQuote = (html: string, summaryLimit = 400): SourceItem[] => {
  const pageProps = jsonScriptsOf(html)
    .map((value) => asRecord(asRecord(value)?.props)?.pageProps)
    .map(asRecord)
    .find((props) => props !== undefined && (props.materials !== undefined || props.newsfeed !== undefined));
  if (!pageProps) {
    return [];
  }

  return rawItemsOf(pageProps).flatMap((item) => {
    const title = asString(item.header) ?? asString(item.titleOnMain) ?? asString(item.title);
    const publishedAt = asString(item.publishDate);
    if (!title || !publishedAt) {
      return [];
    }
    const timestamp = new Date(publishedAt);
    if (Number.isNaN(timestamp.getTime()) || isDigestTitle(title)) {
      return [];
    }
    const summary = asString(item.anons) ?? asString(item.anonsText) ?? asString(item.anonsMd);
    return [
      {
        id: asString(item.id) ?? `${timestamp.toISOString()}-${title.slice(0, 24)}`,
        title,
        summary: summary ? stripMarkup(summary).slice(0, summaryLimit) : undefined,
        publishedAt: timestamp.toISOString(),
        tags: tickersOf(item.tickers),
        url: asString(item.url),
        source: RBC_QUOTE_SOURCE,
      },
    ];
  });
};

/** РБК Инвестиции: HTML-страница с SSR-состоянием, без Telegram и RSS. */
export const createRbcQuoteSource = (options: RbcQuoteOptions = {}): NewsSourceAdapter => {
  const fetchText = options.fetchText ?? defaultFetchText;

  return {
    id: RBC_QUOTE_SOURCE,
    topics: ['news'],
    // Страница отдаёт новости по рынку и помечает материалы тикерами.
    supportsTickerQuery: true,
    supportsMatcherQuery: true,
    async fetchNews(query: NewsQuery): Promise<SourceItem[]> {
      const items = parseRbcQuote(
        await fetchText(options.url ?? RBC_QUOTE_URL),
        options.summaryLimit,
      );
      const since = query.sinceDays
        ? Date.now() - query.sinceDays * 24 * 60 * 60 * 1000
        : undefined;
      const tickers = (query.tickers ?? []).map((ticker) => ticker.trim().toUpperCase());
      const matchers = (query.matchers ?? [])
        .map((matcher) => matcher.trim().toLowerCase())
        .filter((matcher) => matcher.length > 1);

      return items
        .filter((item) => !since || Date.parse(item.publishedAt) >= since)
        .filter((item) => tickers.length === 0 || item.tags.some((tag) => tickers.includes(tag)))
        .filter((item) => {
          if (matchers.length === 0) {
            return true;
          }
          // Привязка от источника (теги) или упоминание в заголовке: аннотацию
          // не смотрим, иначе проходят обзоры «акции нефтяных компаний».
          const haystack = `${item.title} ${item.tags.join(' ')}`.toLowerCase();
          return matchers.some((matcher) => haystack.includes(matcher));
        })
        .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
        .slice(0, query.maxItems);
    },
  };
};
