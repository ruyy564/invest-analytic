import { asRecord, asString, jsonScriptsOf } from '../../../parsing/html.js';
import { stripMarkup } from '../../../parsing/feed.js';
import type { NewsQuery, NewsSourceAdapter, SourceItem } from '../news.types.js';
import { defaultFetchText } from './feed.js';
import type { NewsPolicy } from '../index.js';
import { withReport } from './policy.js';

/** Аналитика Т-Инвестиций: идеи и разборы по бумагам. */
export const TBANK_RESEARCH_URL = 'https://www.tbank.ru/invest/research/';
export const TBANK_RESEARCH_SOURCE = 'tbank_research';

/** Префикс стора приложения в SSR-состоянии Tramvai: версия входит в имя. */
const PORTAL_STORE_PREFIX = 'growth-research-portal';

export interface TbankResearchOptions {
  url?: string;
  fetchText?: (url: string) => Promise<string>;
  summaryLimit?: number;
  /** Политика релевантности: заменяет встроенные фильтры. */
  policy?: NewsPolicy;
}

const ideasOf = (html: string): Record<string, unknown>[] => {
  for (const value of jsonScriptsOf(html)) {
    const root = asRecord(value);
    if (!root) {
      continue;
    }
    // Имя стора версионируется (`growth-research-portal@0.15.0`), поэтому ищем по префиксу.
    const storeName = Object.keys(root).find((name) => name.startsWith(PORTAL_STORE_PREFIX));
    const ideas = asRecord(asRecord(root[storeName ?? ''])?.stores)?.tradingIdeas;
    const list = asRecord(ideas)?.ideas;
    if (Array.isArray(list)) {
      return list.map(asRecord).filter((idea) => idea !== undefined);
    }
  }
  return [];
};

const tickersOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .map((ticker) => asString(asRecord(ticker)?.ticker)?.toUpperCase())
    .filter((ticker): ticker is string => ticker !== undefined);

/**
 * SSR-состояние страницы research → аналитические идеи Т-Инвестиций.
 * У идеи есть заголовок, дата, текст разбора (HTML) и список тикеров.
 */
export const parseTbankResearch = (html: string, summaryLimit = 400): SourceItem[] =>
  ideasOf(html).flatMap((idea) => {
    const title = asString(idea.title);
    const publishedAt = asString(idea.date);
    if (!title || !publishedAt) {
      return [];
    }
    const timestamp = new Date(publishedAt);
    if (Number.isNaN(timestamp.getTime())) {
      return [];
    }
    const description = asString(idea.description);
    return [
      {
        id: asString(idea.id) ?? `${timestamp.toISOString()}-${title.slice(0, 24)}`,
        title,
        summary: description ? stripMarkup(description).slice(0, summaryLimit) : undefined,
        publishedAt: timestamp.toISOString(),
        tags: [],
        instrumentTags: tickersOf(idea.tickers),
        source: TBANK_RESEARCH_SOURCE,
      },
    ];
  });

/** Идеи Т-Инвестиций: HTML-страница research, без Telegram и MCP. */
export const createTbankResearchSource = (
  options: TbankResearchOptions = {},
): NewsSourceAdapter => {
  const fetchText = options.fetchText ?? defaultFetchText;

  const fetchNews = async (query: NewsQuery): Promise<SourceItem[]> => {
    const items = parseTbankResearch(
      await fetchText(options.url ?? TBANK_RESEARCH_URL),
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
      .filter(
        (item) =>
          tickers.length === 0 ||
          (item.instrumentTags ?? item.tags).some((tag) => tickers.includes(tag)),
      )
      .filter((item) => {
        if (matchers.length === 0) {
          return true;
        }
        // Привязка от источника (тикеры идеи) или упоминание в заголовке.
        const haystack = `${item.title} ${(item.instrumentTags ?? item.tags).join(' ')}`.toLowerCase();
        return matchers.some((matcher) => haystack.includes(matcher));
      })
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, query.maxItems);
  };

  return {
    id: TBANK_RESEARCH_SOURCE,
    topics: ['news'],
    supportsTickerQuery: true,
    supportsMatcherQuery: true,
    ...withReport(fetchNews, options.policy),
  };
};
