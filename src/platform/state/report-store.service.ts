import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { AppConfigService } from '../config/app-config.service.js';

export interface StoredReport {
  reportId: string;
  userId: string;
  createdAt: string;
  templateVersion: number;
  markdown: string;
  /** Структурированный отчёт: секции и факты для JSON-выгрузки. */
  json: string;
}

/**
 * Хранилище готовых отчётов: markdown и структурированный JSON по `reportId`.
 * Отчёт привязан к `USER_ID`, чужой идентификатор отдаётся как «не найден».
 *
 * Соединение с SQLite открывается лениво: файл делят чекпоинтер и хранилище
 * отчётов, и долгоживущий дескриптор ловил блокировки — выгрузка отвечала 404
 * на только что сохранённый отчёт.
 */
@Injectable()
export class ReportStoreService {
  private db?: Database.Database;
  private warned = false;
  private readonly memory = new Map<string, StoredReport>();

  constructor(private readonly config: AppConfigService) {}

  /** Соединение с файлом: `undefined` — работаем из памяти. */
  private connection(): Database.Database | undefined {
    if (this.db) {
      return this.db;
    }
    const state = this.config.value.state;
    if (state.backend !== 'sqlite') {
      return undefined;
    }
    try {
      const directory = dirname(state.sqlitePath);
      if (directory && directory !== '.') {
        mkdirSync(directory, { recursive: true });
      }
      const db = new Database(state.sqlitePath);
      // WAL и ожидание блокировки: чекпоинтер пишет в тот же файл.
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 3000');
      db.exec(
        `CREATE TABLE IF NOT EXISTS reports (
          report_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          template_version INTEGER NOT NULL,
          markdown TEXT NOT NULL,
          json TEXT NOT NULL
        )`,
      );
      this.db = db;
      return db;
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        console.warn(
          '[reports] хранилище отчётов недоступно, работаем из памяти:',
          (error as Error)?.message ?? error,
        );
      }
      return undefined;
    }
  }

  save(report: StoredReport): void {
    this.memory.set(report.reportId, report);
    const db = this.connection();
    if (!db) {
      return;
    }
    try {
      db.prepare(
        `INSERT INTO reports (report_id, user_id, created_at, template_version, markdown, json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(report_id) DO UPDATE SET markdown = excluded.markdown, json = excluded.json`,
      ).run(
        report.reportId,
        report.userId,
        report.createdAt,
        report.templateVersion,
        report.markdown,
        report.json,
      );
    } catch (error) {
      console.warn('[reports] не удалось сохранить отчёт:', (error as Error)?.message ?? error);
    }
  }

  /** Отчёт пользователя; чужой или неизвестный идентификатор — `undefined`. */
  get(reportId: string, userId: string): StoredReport | undefined {
    const stored = this.read(reportId) ?? this.memory.get(reportId);
    return stored && stored.userId === userId ? stored : undefined;
  }

  private read(reportId: string): StoredReport | undefined {
    const db = this.connection();
    if (!db) {
      return undefined;
    }
    try {
      const row = db.prepare('SELECT * FROM reports WHERE report_id = ?').get(reportId) as
        | {
            report_id: string;
            user_id: string;
            created_at: string;
            template_version: number;
            markdown: string;
            json: string;
          }
        | undefined;
      if (!row) {
        return undefined;
      }
      return {
        reportId: row.report_id,
        userId: row.user_id,
        createdAt: row.created_at,
        templateVersion: row.template_version,
        markdown: row.markdown,
        json: row.json,
      };
    } catch (error) {
      console.warn('[reports] не удалось прочитать отчёт:', (error as Error)?.message ?? error);
      return undefined;
    }
  }
}
