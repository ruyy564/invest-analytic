import type { FeedFormat, FeedMapping } from './feed.js';
import type { SourceTopic } from '../news.types.js';

/** Описание известной ленты: адрес можно переопределить через `NEWS_<ID>_URL`. */
export interface FeedDefault {
  id: string;
  url: string;
  /** Резервный адрес: публичные мосты часто отвечают 429 на всплеск запросов. */
  fallbackUrl?: string;
  format: FeedFormat;
  topics: readonly SourceTopic[];
  mapping?: Partial<FeedMapping>;
  /** Сколько символов текста поста оставлять: у каналов посты длинные. */
  summaryLimit?: number;
}

/**
 * Проверенные ленты (см. docs/sources.md): интерфакс — общие новости,
 * РБК — экономика и рынки, smart-lab — мнения сообщества и налоговые разборы,
 * Ведомости/Коммерсантъ/ТАСС/Финам — деловые новости и рынки.
 * Telegram не используется: у БКС и Т-Инвестиций нет публичного RSS, поэтому их
 * материалы берутся со страниц research/quote (см. rbc-quote.ts, tbank-research.ts).
 * Адрес любой ленты можно заменить через `NEWS_<ID>_URL`.
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
  // Деловые ленты: дают объём и рынок без Telegram.
  vedomosti: {
    id: 'vedomosti',
    url: 'https://www.vedomosti.ru/rss/news',
    format: 'rss',
    topics: ['news'],
  },
  kommersant: {
    id: 'kommersant',
    url: 'https://www.kommersant.ru/RSS/section-finance.xml',
    format: 'rss',
    topics: ['news'],
  },
  tass: {
    id: 'tass',
    // Раздел «Экономика»: общая лента ТАСС приносит спорт и региональные происшествия.
    url: 'https://tass.ru/rss/v2.xml?category=ekonomika',
    format: 'rss',
    topics: ['news'],
  },
  finam: {
    id: 'finam',
    url: 'https://www.finam.ru/analysis/conews/rsspoint/',
    format: 'rss',
    topics: ['news'],
  },
};

/** Адрес ленты: переменная окружения `NEWS_<ID>_URL` важнее встроенного. */
export const feedUrl = (feed: FeedDefault, env: NodeJS.ProcessEnv = process.env): string =>
  env[`NEWS_${feed.id.toUpperCase()}_URL`]?.trim() || feed.url;

/** Резервный адрес ленты: `NEWS_<ID>_FALLBACK_URL` важнее встроенного. */
export const feedFallbackUrl = (
  feed: FeedDefault,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined =>
  env[`NEWS_${feed.id.toUpperCase()}_FALLBACK_URL`]?.trim() || feed.fallbackUrl;
