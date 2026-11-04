import type {
  KeyRateSnapshot,
  KeyRateSource,
  NewsQuery,
  NewsSourceAdapter,
  SourceItem,
  SourceTopic,
} from './types.js';

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
export class SourceRegistry {
  constructor(
    private readonly news: readonly NewsSourceAdapter[] = [],
    private readonly keyRate?: KeyRateSource,
  ) {}

  get newsSources(): readonly NewsSourceAdapter[] {
    return this.news;
  }

  /** Источники, обслуживающие тему (новости, налоги). */
  newsSourcesFor(topic: SourceTopic): readonly NewsSourceAdapter[] {
    return this.news.filter((source) => source.topics.includes(topic));
  }

  hasKeyRate(): boolean {
    return this.keyRate !== undefined;
  }

  /**
   * Сводка новостей из всех источников темы. Отказ одного источника не
   * прерывает сбор: причина попадает в покрытие.
   */
  async newsDigest(query: NewsQuery, topic: SourceTopic = 'news'): Promise<NewsDigest> {
    const sources = this.newsSourcesFor(topic);
    const batches: { source: string; items: SourceItem[] }[] = [];
    const coverage: SourceCoverageEntry[] = [];

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

  /** Снимок ключевой ставки и статус источника. */
  async keyRateSnapshot(): Promise<{
    snapshot?: KeyRateSnapshot;
    coverage: SourceCoverageEntry;
  }> {
    if (!this.keyRate) {
      return {
        coverage: { source: 'cbr', status: 'missing', reason: 'источник ставки не подключён' },
      };
    }
    try {
      const snapshot = await this.keyRate.read();
      return snapshot
        ? { snapshot, coverage: { source: 'cbr', status: 'ok', items: snapshot.history.length } }
        : {
            coverage: {
              source: 'cbr',
              status: 'missing',
              reason: 'ни live, ни сид, ни кэш не дали данных',
            },
          };
    } catch (error) {
      return {
        coverage: { source: 'cbr', status: 'missing', reason: (error as Error)?.message ?? 'ошибка' },
      };
    }
  }
}
