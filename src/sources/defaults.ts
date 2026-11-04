import type { FeedFormat, FeedMapping } from './feed.js';
import type { SourceTopic } from './types.js';

/** Описание известной ленты: адрес можно переопределить через `NEWS_<ID>_URL`. */
export interface FeedDefault {
  id: string;
  url: string;
  format: FeedFormat;
  topics: readonly SourceTopic[];
  mapping?: Partial<FeedMapping>;
}

/**
 * Проверенные ленты (см. docs/sources.md): интерфакс — общие новости,
 * РБК — экономика и рынки, smart-lab — мнения сообщества и налоговые разборы.
 */
export const FEED_DEFAULTS: Record<string, FeedDefault> = {
  interfax: {
    id: 'interfax',
    url: 'https://www.interfax.ru/rss.asp',
    format: 'rss',
    topics: ['news'],
  },
  rbc: {
    id: 'rbc',
    url: 'https://rssexport.rbc.ru/rbcnews/news/30/full.rss',
    format: 'rss',
    topics: ['news'],
  },
  smartlab: {
    id: 'smartlab',
    url: 'https://smart-lab.ru/rss/',
    format: 'rss',
    topics: ['news', 'tax'],
  },
};

/** Адрес ленты: переменная окружения `NEWS_<ID>_URL` важнее встроенного. */
export const feedUrl = (feed: FeedDefault, env: NodeJS.ProcessEnv = process.env): string =>
  env[`NEWS_${feed.id.toUpperCase()}_URL`]?.trim() || feed.url;
