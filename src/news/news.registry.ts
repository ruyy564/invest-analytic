import type {
  NewsQuery,
  NewsSourceAdapter,
  SourceItem,
  SourceTopic,
} from './news.types.js';

export interface SourceCoverageEntry {
  source: string;
  status: 'ok' | 'missing';
  items?: number;
  reason?: string;
}

/** Короткое имя того же типа: используется сбором и отчётом. */
export type CoverageEntry = SourceCoverageEntry;

export interface NewsDigest {
  items: SourceItem[];
  coverage: SourceCoverageEntry[];
}

/** Ключ дубликата: ссылка, иначе нормализованный заголовок. */
export const dedupeKey = (item: SourceItem): string =>
  (item.url ?? item.title).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Слияние лент: порядок источников задаёт приоритет — при дубликате остаётся
 * элемент из источника, который пришёл первым.
 */
export const mergeNews = (batches: { source: string; items: SourceItem[] }[]): SourceItem[] => {
  const seen = new Map<string, SourceItem>();
  for (const batch of batches) {
    for (const item of batch.items) {
      const key = dedupeKey(item);
      if (!seen.has(key)) {
        seen.set(key, item);
      }
    }
  }
  return [...seen.values()].sort((left, right) =>
    right.publishedAt.localeCompare(left.publishedAt),
  );
};

/** Источники по темам: одна точка доступа для инструментов и провайдеров. */
export class NewsRegistry {
  constructor(private readonly news: readonly NewsSourceAdapter[] = []) {}

  get newsSources(): readonly NewsSourceAdapter[] {
    return this.news;
  }

  /** Источники, обслуживающие тему (новости, налоги). */
  newsSourcesFor(topic: SourceTopic): readonly NewsSourceAdapter[] {
    return this.news.filter((source) => source.topics.includes(topic));
  }

  /**
   * Сводка новостей из всех источников темы. Отказ одного источника не
   * прерывает сбор: причина попадает в покрытие.
   */
  async newsDigest(query: NewsQuery, topic: SourceTopic = 'news'): Promise<NewsDigest> {
    const tickers = (query.tickers ?? []).filter((ticker) => ticker.length > 0);
    const matchers = (query.matchers ?? []).filter((matcher) => matcher.trim().length > 1);
    const all = this.newsSourcesFor(topic);
    // Новости по бумагам: брокер ищет по тикеру, ленты — фильтруют заголовки по
    // подстрокам (тикер и название компании). Общий поток РБК/«Интерфакса» сюда
    // не попадает: спорт и политика к портфелю отношения не имеют.
    const sources =
      tickers.length > 0 || matchers.length > 0
        ? all.filter(
            (source) =>
              source.supportsTickerQuery ||
              (matchers.length > 0 && source.supportsMatcherQuery),
          )
        : all;
    const batches: { source: string; items: SourceItem[] }[] = [];
    const coverage: SourceCoverageEntry[] = [];

    if (sources.length === 0) {
      return {
        items: [],
        coverage: [
          { source: 'news', status: 'missing', reason: 'нет источника новостей по бумаге' },
        ],
      };
    }

    await Promise.all(
      sources.map(async (source) => {
        try {
          const items = await source.fetchNews(query);
          batches.push({ source: source.id, items });
          coverage.push({ source: source.id, status: 'ok', items: items.length });
        } catch (error) {
          coverage.push({
            source: source.id,
            status: 'missing',
            reason: (error as Error)?.message ?? 'ошибка источника',
          });
        }
      }),
    );

    return {
      items: mergeNews(batches).slice(0, query.maxItems),
      coverage: coverage.sort((left, right) => left.source.localeCompare(right.source)),
    };
  }
}
