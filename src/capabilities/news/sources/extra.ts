import { readFileSync } from 'node:fs';
import { parseYaml } from '../../../shared/parsing/yaml.js';
import type { SourceTopic } from '../news.types.js';
import type { FeedFormat } from './feed.js';

/** Лента, добавленная файлом `NEWS_EXTRA_FEEDS_FILE`, а не кодом. */
export interface ExtraFeed {
  id: string;
  url: string;
  fallbackUrl?: string;
  format: FeedFormat;
  topics: readonly SourceTopic[];
  summaryLimit?: number;
}

const FORMATS: readonly FeedFormat[] = ['rss', 'atom', 'json'];
const TOPICS: readonly SourceTopic[] = ['portfolio', 'news', 'tax', 'macro', 'market'];

const asTopic = (value: unknown): SourceTopic | undefined =>
  typeof value === 'string' && TOPICS.includes(value as SourceTopic)
    ? (value as SourceTopic)
    : undefined;

/**
 * Дополнительные ленты из YAML: новый источник подключается файлом, без правки
 * кода. Формат строки — `- id: cbr`, `url: https://…`, `format: rss`,
 * `topics: [news]`. Файла нет — список пуст, поведение прежнее.
 */
export const loadExtraFeeds = (path: string | undefined): ExtraFeed[] => {
  if (!path) {
    return [];
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const parsed = parseYaml(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (id.length === 0 || !/^https?:\/\//i.test(url)) {
      return [];
    }
    const format =
      typeof record.format === 'string' && FORMATS.includes(record.format as FeedFormat)
        ? (record.format as FeedFormat)
        : 'rss';
    const topics = (Array.isArray(record.topics) ? record.topics : [])
      .map(asTopic)
      .filter((topic): topic is SourceTopic => topic !== undefined);

    return [
      {
        id,
        url,
        format,
        topics: topics.length > 0 ? topics : ['news'],
        ...(typeof record.fallbackUrl === 'string' && record.fallbackUrl.trim().length > 0
          ? { fallbackUrl: record.fallbackUrl.trim() }
          : {}),
        ...(typeof record.summaryLimit === 'number' && record.summaryLimit > 0
          ? { summaryLimit: record.summaryLimit }
          : {}),
      },
    ];
  });
};
