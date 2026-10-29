import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { AppConfigService } from '../config/app-config.service.js';

/** Ключи, которые запрещено хранить в глобальном хранилище: данные портфеля. */
const FORBIDDEN_KEY = /portfolio|position|holding|количеств|позиц/i;

export interface StoredValue {
  namespace: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * Глобальное хранилище общих данных (счёт по умолчанию, версия схемы).
 * Работает поверх того же SQLite, что и чекпоинтер, но в отдельной таблице.
 * Данные портфеля сюда попадать не должны — иначе чтение обошло бы подтверждение.
 */
@Injectable()
export class GlobalStoreService {
  private readonly db: Database.Database;

  constructor(configService: AppConfigService) {
    const state = configService.value.state;
    const path = state.backend === 'memory' ? ':memory:' : state.sqlitePath;

    if (path !== ':memory:') {
      const directory = dirname(path);
      if (directory && directory !== '.') {
        mkdirSync(directory, { recursive: true });
      }
    }

    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS app_global_state (
           namespace TEXT NOT NULL,
           key TEXT NOT NULL,
           value TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           PRIMARY KEY (namespace, key)
         )`,
      )
      .run();
  }

  namespaceFor(userId: string): string {
    return `users/${userId}`;
  }

  put(namespace: string, key: string, value: unknown): void {
    if (FORBIDDEN_KEY.test(key)) {
      throw new Error(`Ключ "${key}" не может храниться в глобальном хранилище`);
    }
    this.db
      .prepare(
        `INSERT INTO app_global_state (namespace, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value,
                                                   updated_at = excluded.updated_at`,
      )
      .run(namespace, key, JSON.stringify(value), new Date().toISOString());
  }

  get<T>(namespace: string, key: string): T | undefined {
    const row = this.db
      .prepare('SELECT value FROM app_global_state WHERE namespace = ? AND key = ?')
      .get(namespace, key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  delete(namespace: string, key: string): void {
    this.db
      .prepare('DELETE FROM app_global_state WHERE namespace = ? AND key = ?')
      .run(namespace, key);
  }

  list(namespace: string): StoredValue[] {
    const rows = this.db
      .prepare(
        'SELECT namespace, key, value, updated_at FROM app_global_state WHERE namespace = ? ORDER BY key',
      )
      .all(namespace) as { namespace: string; key: string; value: string; updated_at: string }[];

    return rows.map((row) => ({
      namespace: row.namespace,
      key: row.key,
      value: JSON.parse(row.value) as unknown,
      updatedAt: row.updated_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
