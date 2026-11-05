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
 * РБК — экономика и рынки, smart-lab — мнения сообщества и налоговые разборы.
 * Каналы РБК, БКС и Т-Банка читаются через публичный RSS-мост Telegram:
 * прямой `t.me` отдаёт превью только из браузера, из процесса он недоступен.
 * Адрес моста можно заменить через `NEWS_<ID>_URL`.
 */
export const TELEGRAM_BRIDGE = 'https://rsshub.rssforever.com/telegram/channel';

/**
 * Каналы с аналитикой по эмитентам: разборы, идеи, комментарии к отчётности.
 * Текст поста длиннее обычной аннотации — иначе упоминание бумаги теряется.
 */
export const TELEGRAM_FALLBACK = 'https://tg.i-c-a.su/rss';

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
  // Каналы с аналитикой по эмитентам: разборы, идеи, комментарии к отчётности.
  // Текст поста длиннее обычной аннотации — иначе упоминание бумаги теряется.
  rbc_news: {
    id: 'rbc_news',
    url: `${TELEGRAM_BRIDGE}/rbc_news`,
    fallbackUrl: `${TELEGRAM_FALLBACK}/rbc_news`,
    format: 'rss',
    topics: ['news'],
    summaryLimit: 1_200,
  },
  bcs: {
    id: 'bcs',
    url: `${TELEGRAM_BRIDGE}/bcs_express`,
    fallbackUrl: `${TELEGRAM_FALLBACK}/bcs_express`,
    format: 'rss',
    topics: ['news'],
    summaryLimit: 1_200,
  },
  tbank: {
    id: 'tbank',
    url: `${TELEGRAM_BRIDGE}/tbank`,
    fallbackUrl: `${TELEGRAM_FALLBACK}/tbank`,
    format: 'rss',
    topics: ['news', 'tax'],
    summaryLimit: 1_200,
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
