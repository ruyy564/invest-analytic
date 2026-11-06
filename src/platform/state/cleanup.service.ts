import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import Database from 'better-sqlite3';
import { AppConfigService } from '../config/app-config.service.js';
import { GlobalStoreService } from './global-store.service.js';

/** Удаляет брошенные сессии: чекпоинты, не обновлявшиеся дольше `STATE_TTL_DAYS`. */
@Injectable()
export class CleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly store: GlobalStoreService,
  ) {}

  onApplicationBootstrap(): void {
    try {
      this.cleanup(new Date());
    } catch (error) {
      this.logger.warn(`Очистка устаревших сессий не выполнена: ${(error as Error).message}`);
    }
  }

  /** Возвращает число удалённых сессий; в memory-режиме ничего не делает. */
  cleanup(now: Date = new Date()): number {
    const state = this.config.value.state;
    if (state.backend !== 'sqlite') {
      return 0;
    }

    const db = new Database(state.sqlitePath);
    try {
      const tables = db
        .prepare("select name from sqlite_master where type='table' and name in ('checkpoints','writes')")
        .all() as { name: string }[];
      if (tables.length === 0) {
        return 0;
      }

      const threshold = new Date(now.getTime() - state.ttlDays * 24 * 60 * 60 * 1000).toISOString();
      // `checkpoint_id` — не время, а идентификатор в лексикографическом порядке
      // (для UUIDv6 первый префикс — метка времени). Поэтому сравниваем время из
      // `checkpoint` (ISO-строка, JSON); фолбэк по `checkpoint_id` — только для строк,
      // где времени нет, иначе свежие сессии удалялись бы вместе со старыми.
      const stale = db
        .prepare(
          `SELECT DISTINCT thread_id FROM checkpoints
           WHERE json_extract(checkpoint, '$.ts') < ?
              OR (json_extract(checkpoint, '$.ts') IS NULL AND checkpoint_id < ?)`,
        )
        .all(threshold, threshold) as { thread_id: string }[];

      const deleteCheckpoints = db.prepare('DELETE FROM checkpoints WHERE thread_id = ?');
      const deleteWrites = db.prepare('DELETE FROM writes WHERE thread_id = ?');

      const remove = db.transaction((threadIds: string[]) => {
        for (const threadId of threadIds) {
          deleteCheckpoints.run(threadId);
          deleteWrites.run(threadId);
        }
      });
      remove(stale.map((row) => row.thread_id));

      if (stale.length > 0) {
        this.logger.log(`Удалено устаревших сессий: ${stale.length}`);
      }
      return stale.length;
    } finally {
      db.close();
    }
  }

  /** Данные пользователя из глобального хранилища (для проверок и отладки). */
  listUserData(userId: string): unknown {
    return this.store.list(this.store.namespaceFor(userId));
  }
}
