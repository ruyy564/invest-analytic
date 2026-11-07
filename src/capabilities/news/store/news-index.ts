import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { SourceItem } from '../news.types.js';

/**
 * Индекс собранных публикаций.
 *
 * Сбор «в момент вопроса» упирается в сетевое окно лент: за 90 дней публикации
 * уже не отдаются, а причины движения цены живут именно в истории. Индекс
 * накапливает всё, что собрано (фоном и по запросу), помнит текст статей и
 * отдаёт публикации за окно любой длины без повторных скачиваний.
 */

/** Публикация в индексе: те же поля, что у источника, плюс привязки и текст. */
export interface StoredNews {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  publishedAt: string;
  source: string;
  /** Тикеры, к которым публикация привязана (может быть несколько). */
  tickers: string[];
  fetchedAt: string;
}

export interface NewsSearchOptions {
  /** Тикеры: публикация привязана хотя бы к одному. */
  tickers?: string[];
  /** Подстроки для поиска по заголовку и аннотации. */
  keywords?: string[];
  sinceDays?: number;
  limit?: number;
}

interface NewsRow {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  source: string;
  published_at: string;
  tickers: string;
  fetched_at: string;
}

/** Ключ публикации: ссылка, иначе нормализованный заголовок. */
export const storedId = (item: { title: string; url?: string }): string =>
  (item.url ?? item.title).toLowerCase().replace(/\s+/g, ' ').trim();

/** Строка источника → запись индекса: привязки к тикерам и время сбора. */
export const toStored = (
  item: SourceItem,
  options: { tickers?: string[]; now?: Date } = {},
): StoredNews => ({
  id: storedId(item),
  title: item.title,
  summary: item.summary,
  url: item.url,
  publishedAt: item.publishedAt,
  source: item.source,
  tickers: [
    ...new Set(
      [...(item.instrumentTags ?? []), ...(options.tickers ?? [])].map((ticker) =>
        ticker.toUpperCase(),
      ),
    ),
  ],
  fetchedAt: (options.now ?? new Date()).toISOString(),
});

export class NewsIndex {
  private db?: Database.Database;
  private readonly memory = new Map<string, StoredNews>();
  private readonly texts = new Map<string, { text: string; fetchedAt: string }>();

  constructor(private readonly sqlitePath: string) {
    this.open();
  }

  private open(): void {
    try {
      const directory = dirname(this.sqlitePath);
      if (directory && directory !== '.') {
        mkdirSync(directory, { recursive: true });
      }
      this.db = new Database(this.sqlitePath);
      this.db.exec(
        [
          "CREATE TABLE IF NOT EXISTS news_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT, url TEXT, source TEXT NOT NULL, published_at TEXT NOT NULL, tickers TEXT NOT NULL DEFAULT '', fetched_at TEXT NOT NULL)",
          'CREATE INDEX IF NOT EXISTS news_items_published ON news_items(published_at)',
          'CREATE TABLE IF NOT EXISTS news_texts (url TEXT PRIMARY KEY, text TEXT NOT NULL, fetched_at TEXT NOT NULL)',
        ].join(';'),
      );
    } catch {
      // Индекс не должен ломать сбор: при недоступности файла работаем в памяти.
      this.db = undefined;
    }
  }

  /** Кладёт публикации в индекс: привязки к тикерам объединяются, а не теряются. */
  save(items: readonly StoredNews[], now: Date = new Date()): void {
    for (const item of items) {
      const previous = this.raw(item.id);
      const merged: StoredNews = {
        ...item,
        tickers: [...new Set([...(previous?.tickers ?? []), ...item.tickers])],
        fetchedAt: now.toISOString(),
      };
      this.memory.set(merged.id, merged);
      this.db
        ?.prepare(
          'INSERT INTO news_items (id, title, summary, url, source, published_at, tickers, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, summary = excluded.summary, url = excluded.url, source = excluded.source, published_at = excluded.published_at, tickers = excluded.tickers, fetched_at = excluded.fetched_at',
        )
        .run(
          merged.id,
          merged.title,
          merged.summary ?? null,
          merged.url ?? null,
          merged.source,
          merged.publishedAt,
          merged.tickers.join(','),
          merged.fetchedAt,
        );
    }
  }

  /** Публикации за окно: по тикерам или по ключевым словам, свежие сверху. */
  search(options: NewsSearchOptions = {}, now: Date = new Date()): StoredNews[] {
    const limit = options.limit ?? 20;
    const since = now.getTime() - (options.sinceDays ?? 90) * 24 * 60 * 60 * 1000;
    const tickers = (options.tickers ?? []).map((ticker) => ticker.toUpperCase());
    const keywords = (options.keywords ?? []).map((keyword) => keyword.toLowerCase());

    return this.all()
      .filter((item) => Date.parse(item.publishedAt) >= since)
      .filter((item) => {
        if (tickers.length === 0 && keywords.length === 0) {
          return true;
        }
        if (tickers.some((ticker) => item.tickers.includes(ticker))) {
          return true;
        }
        const haystack = `${item.title} ${item.summary ?? ''}`.toLowerCase();
        return keywords.some((keyword) => haystack.includes(keyword));
      })
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, limit);
  }

  /** Текст статьи по ссылке: скачанный однажды больше не запрашивается. */
  textOf(url?: string): string | undefined {
    if (!url) {
      return undefined;
    }
    const key = url.toLowerCase();
    if (this.db) {
      const row = this.db
        .prepare('SELECT text FROM news_texts WHERE url = ?')
        .get(key) as { text: string } | undefined;
      if (row?.text) {
        return row.text;
      }
    }
    return this.texts.get(key)?.text;
  }

  saveText(url: string, text: string, now: Date = new Date()): void {
    const key = url.toLowerCase();
    this.texts.set(key, { text, fetchedAt: now.toISOString() });
    this.db
      ?.prepare(
        'INSERT INTO news_texts (url, text, fetched_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET text = excluded.text, fetched_at = excluded.fetched_at',
      )
      .run(key, text, now.toISOString());
  }

  /** Удаляет публикации и тексты старше срока хранения. */
  prune(ttlDays: number, now: Date = new Date()): number {
    const border = new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
    let removed = 0;
    for (const [id, item] of this.memory) {
      if (item.publishedAt < border) {
        this.memory.delete(id);
        removed += 1;
      }
    }
    this.db?.prepare('DELETE FROM news_items WHERE published_at < ?').run(border);
    this.db?.prepare('DELETE FROM news_texts WHERE fetched_at < ?').run(border);
    return removed;
  }

  /** Сколько публикаций в индексе: для диагностики и логов. */
  size(): number {
    return this.all().length;
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  private all(): StoredNews[] {
    if (this.db) {
      try {
        const rows = this.db
          .prepare(
            'SELECT id, title, summary, url, source, published_at, tickers, fetched_at FROM news_items',
          )
          .all() as NewsRow[];
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          summary: row.summary ?? undefined,
          url: row.url ?? undefined,
          source: row.source,
          publishedAt: row.published_at,
          tickers: row.tickers.split(',').filter((ticker) => ticker.length > 0),
          fetchedAt: row.fetched_at,
        }));
      } catch {
        // Падаем в память.
      }
    }
    return [...this.memory.values()];
  }

  /** Запись по ключу: нужна, чтобы не терять прежние привязки к тикерам. */
  private raw(id: string): StoredNews | undefined {
    return this.all().find((item) => item.id === id);
  }
}

