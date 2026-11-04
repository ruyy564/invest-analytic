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
 */
@Injectable()
export class ReportStoreService {
  private readonly db?: Database.Database;
  private readonly memory = new Map<string, StoredReport>();

  constructor(private readonly config: AppConfigService) {
    const state = this.config.value.state;
    if (state.backend !== 'sqlite') {
      return;
    }
    try {
      const directory = dirname(state.sqlitePath);
      if (directory && directory !== '.') {
        mkdirSync(directory, { recursive: true });
      }
      this.db = new Database(state.sqlitePath);
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS reports (
          report_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          template_version INTEGER NOT NULL,
          markdown TEXT NOT NULL,
          json TEXT NOT NULL
        )`,
      );
    } catch {
      this.db = undefined;
    }
  }

  save(report: StoredReport): void {
    this.memory.set(report.reportId, report);
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `INSERT INTO reports (report_id, user_id, created_at, template_version, markdown, json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(report_id) DO UPDATE SET markdown = excluded.markdown, json = excluded.json`,
        )
        .run(
          report.reportId,
          report.userId,
          report.createdAt,
          report.templateVersion,
          report.markdown,
          report.json,
        );
    } catch {
      // Хранилище не должно ломать ответ: копия уже в памяти.
    }
  }

  /** Отчёт пользователя; чужой или неизвестный идентификатор — `undefined`. */
  get(reportId: string, userId: string): StoredReport | undefined {
    const stored = this.read(reportId);
    return stored && stored.userId === userId ? stored : undefined;
  }

  private read(reportId: string): StoredReport | undefined {
    if (this.db) {
      try {
        const row = this.db
          .prepare('SELECT * FROM reports WHERE report_id = ?')
          .get(reportId) as
          | {
              report_id: string;
              user_id: string;
              created_at: string;
              template_version: number;
              markdown: string;
              json: string;
            }
          | undefined;
        if (row) {
          return {
            reportId: row.report_id,
            userId: row.user_id,
            createdAt: row.created_at,
            templateVersion: row.template_version,
            markdown: row.markdown,
            json: row.json,
          };
        }
      } catch {
        // Падаем в память.
      }
    }
    return this.memory.get(reportId);
  }
}
