import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

interface CacheRow {
  payload: string;
  fetched_at: string;
}

/**
 * Кэш медленноменяющихся данных (ключевая ставка). Живёт в той же SQLite,
 * что и состояние; при недоступности файла деградирует в память процесса.
 */
export class KeyRateCache {
  private db?: Database.Database;
  private readonly memory = new Map<string, CacheRow>();

  constructor(
    private readonly sqlitePath: string,
    private readonly ttlHours: number,
  ) {
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
        'CREATE TABLE IF NOT EXISTS source_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL)',
      );
    } catch {
      this.db = undefined;
    }
  }

  /** Свежее значение из кэша; `undefined` — нет или протухло. */
  get(key: string, now: Date = new Date()): string | undefined {
    const row = this.read(key);
    if (!row) {
      return undefined;
    }
    const ageMs = now.getTime() - Date.parse(row.fetched_at);
    return ageMs >= 0 && ageMs <= this.ttlHours * 3_600_000 ? row.payload : undefined;
  }

  put(key: string, payload: string, now: Date = new Date()): void {
    const fetchedAt = now.toISOString();
    this.memory.set(key, { payload, fetched_at: fetchedAt });
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          'INSERT INTO source_cache (key, payload, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at',
        )
        .run(key, payload, fetchedAt);
    } catch {
      // Кэш не должен ломать прогон: остаёмся на копии в памяти.
    }
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  private read(key: string): CacheRow | undefined {
    if (this.db) {
      try {
        const row = this.db
          .prepare('SELECT payload, fetched_at FROM source_cache WHERE key = ?')
          .get(key) as CacheRow | undefined;
        if (row) {
          return row;
        }
      } catch {
        // Падаем в память.
      }
    }
    return this.memory.get(key);
  }
}

/** Читает JSON-сид-файл; отсутствие файла — не ошибка (режим live). */
export const readSeedFile = (path: string): unknown => {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};
