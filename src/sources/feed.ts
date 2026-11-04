import type { NewsQuery, NewsSourceAdapter, SourceItem, SourceTopic } from './types.js';

export type FeedFormat = 'rss' | 'atom' | 'json';

/** Как вытащить поля из ленты: у каждой ленты свои имена тегов. */
export interface FeedMapping {
  title: string;
  link: string;
  summary?: string;
  date: string;
  tags?: string;
}

export interface FeedSourceOptions {
  id: string;
  url: string;
  format: FeedFormat;
  topics?: readonly SourceTopic[];
  mapping?: Partial<FeedMapping>;
  /** Подмена загрузчика в тестах; по умолчанию — глобальный fetch. */
  fetchText?: (url: string) => Promise<string>;
  /** Сколько символов аннотации оставлять. */
  summaryLimit?: number;
}

const DEFAULT_MAPPING: Record<FeedFormat, FeedMapping> = {
  rss: { title: 'title', link: 'link', summary: 'description', date: 'pubDate', tags: 'category' },
  atom: { title: 'title', link: 'link', summary: 'summary', date: 'updated', tags: 'category' },
  json: { title: 'title', link: 'link', summary: 'summary', date: 'publishedAt' },
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Раскрывает HTML-сущности: ленты отдают их и в заголовках, и в аннотациях. */
export const unescapeEntities = (value: string): string =>
  value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    }
    if (key.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    }
    return ENTITIES[key] ?? match;
  });

/** Убирает теги и CDATA: в отчёт попадает только текст. */
export const stripMarkup = (value: string): string =>
  unescapeEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

/** Содержимое первого блока `<tag>…</tag>` без учёта регистра. */
const blockOf = (xml: string, tag: string): string | undefined =>
  new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)?.[1];

/** Текстовое значение первого тега. */
const textOf = (xml: string, tag: string): string | undefined => {
  const block = blockOf(xml, tag);
  return block === undefined ? undefined : stripMarkup(block);
};

/** Ссылка: текст тега (RSS) или атрибут `href` (Atom). */
const linkOf = (block: string, tag: string): string | undefined => {
  const inner = blockOf(block, tag);
  if (inner !== undefined && !inner.includes('<')) {
    return stripMarkup(inner) || undefined;
  }
  const attr = new RegExp(`<${tag}[^>]*href="([^"]+)"`, 'i').exec(block)?.[1];
  return attr ? unescapeEntities(attr) : undefined;
};

const allOf = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))].map((match) =>
    stripMarkup(match[1]),
  );

/** Дата в ISO; нераспознанная дата отбрасывается как некорректная. */
const toIso = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
};


const parseJson = (raw: string, mapping: FeedMapping, source: string): SourceItem[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('лента вернула невалидный JSON');
  }
  const list = Array.isArray(parsed) ? parsed : ((parsed as { items?: unknown[] })?.items ?? []);
  if (!Array.isArray(list)) {
    throw new Error('в JSON-ленте нет массива элементов');
  }
  return list.flatMap((item, index) => {
    const record = (item ?? {}) as Record<string, unknown>;
    const title = typeof record[mapping.title] === 'string' ? String(record[mapping.title]) : '';
    const date = toIso(
      typeof record[mapping.date] === 'string' ? String(record[mapping.date]) : undefined,
    );
    if (!title || !date) {
      return [];
    }
    return [
      {
        id: `${source}-${index}-${date}`,
        title,
        summary: mapping.summary ? String(record[mapping.summary] ?? '') || undefined : undefined,
        url: mapping.link ? String(record[mapping.link] ?? '') || undefined : undefined,
        publishedAt: date,
        tags: [],
        source,
      },
    ];
  });
};

/** Разбор RSS/Atom/JSON-ленты в единый список новостей. */
export const parseFeed = (
  raw: string,
  options: {
    format: FeedFormat;
    source: string;
    mapping?: Partial<FeedMapping>;
    summaryLimit?: number;
  },
): SourceItem[] => {
  const mapping = { ...DEFAULT_MAPPING[options.format], ...options.mapping };
  const limit = options.summaryLimit ?? 400;

  if (options.format === 'json') {
    return parseJson(raw, mapping, options.source);
  }
  const lower = raw.toLowerCase();
  if (!raw.includes('<') || lower.includes('<html') || lower.includes('<!doctype html')) {
    throw new Error('лента вернула не XML (вероятно, HTML-страницу)');
  }

  const itemTag = options.format === 'atom' ? 'entry' : 'item';
  const blocks = [...raw.matchAll(new RegExp(`<${itemTag}[\\s>][\\s\\S]*?</${itemTag}>`, 'gi'))].map(
    (match) => match[0],
  );
  if (blocks.length === 0) {
    throw new Error('в ленте нет элементов');
  }

  return blocks.flatMap((block, index) => {
    const title = textOf(block, mapping.title);
    const date = toIso(textOf(block, mapping.date));
    if (!title || !date) {
      return [];
    }
    const summary = mapping.summary ? textOf(block, mapping.summary) : undefined;
    return [
      {
        id: `${options.source}-${index}-${date}`,
        title,
        summary: summary ? summary.slice(0, limit) : undefined,
        url: linkOf(block, mapping.link),
        publishedAt: date,
        tags: mapping.tags ? allOf(block, mapping.tags).filter((tag) => tag.length > 0) : [],
        source: options.source,
      },
    ];
  });
};

const defaultFetch = async (url: string): Promise<string> => {
  const response = await fetch(url, {
    headers: { 'user-agent': 'invest-analytic/0.1 (+portfolio review)' },
    signal: AbortSignal.timeout(10_000),
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
export const createFeedSource = (options: FeedSourceOptions): NewsSourceAdapter => {
  const fetchText = options.fetchText ?? defaultFetch;

  return {
    id: options.id,
    topics: options.topics ?? ['news'],
    // Общая лента: поиска по тикеру нет, но фильтр по подстрокам работает.
    supportsTickerQuery: false,
    supportsMatcherQuery: true,
    async fetchNews(query: NewsQuery): Promise<SourceItem[]> {
      const raw = await fetchText(options.url);
      const items = parseFeed(raw, {
        format: options.format,
        source: options.id,
        mapping: options.mapping,
        summaryLimit: options.summaryLimit,
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
        if (matchers.length === 0) {
          return true;
        }
        const haystack = `${item.title} ${item.summary ?? ''}`.toLowerCase();
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
