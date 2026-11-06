import type { NewsQuery, NewsSourceAdapter, NewsFetchResult, SourceItem } from '../news.types.js';
import { applyPolicy, type CanonicalItem, type NewsPolicy } from '../index.js';

/**
 * Применяет политику к элементам источника. Пока флаг не включён, политика не
 * передаётся и источники работают по прежним правилам.
 */
export const governItems = (
  items: readonly SourceItem[],
  query: NewsQuery,
  policy: NewsPolicy | undefined,
  options: { tagsAreInstruments?: boolean } = {},
): NewsFetchResult => {
  if (!policy) {
    return { items: [...items] };
  }

  const canonical: CanonicalItem[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    url: item.url,
    publishedAt: item.publishedAt,
    source: item.source,
    tags: options.tagsAreInstruments ? [] : item.tags,
    instrumentTags:
      item.instrumentTags ?? (options.tagsAreInstruments ? item.tags : []),
  }));

  const mode =
    (query.matchers ?? []).length > 0 || (query.tickers ?? []).length > 0 ? 'ticker' : 'general';
  const result = applyPolicy(
    canonical,
    { mode, matchers: query.matchers, tickers: query.tickers },
    policy,
  );

  return {
    items: result.items.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      url: item.url,
      publishedAt: item.publishedAt,
      source: item.source,
      tags: options.tagsAreInstruments ? item.instrumentTags : item.tags,
    })),
    dropped: result.report.dropped,
  };
};

/** Обёртка источника: обычный ответ и ответ с отчётом стадий. */
export const withReport = (
  fetch: (query: NewsQuery) => Promise<SourceItem[]>,
  policy: NewsPolicy | undefined,
  options: { tagsAreInstruments?: boolean } = {},
): Pick<NewsSourceAdapter, 'fetchNews' | 'fetchNewsWithReport'> => ({
  async fetchNews(query: NewsQuery): Promise<SourceItem[]> {
    return (await fetch(query)).slice();
  },
  async fetchNewsWithReport(query: NewsQuery): Promise<NewsFetchResult> {
    return governItems(await fetch(query), query, policy, options);
  },
});
