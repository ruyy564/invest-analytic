import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from '../logging/redact.js';

/** Виды записей журнала: этапы прогона и итог. */
export type RunEventType =
  | 'run_started'
  | 'intent'
  | 'tool_call'
  | 'tool_result'
  | 'run_finished';

export interface RunJournalOptions {
  /** Каталог журналов (`STATE_RUNS_DIR`). */
  dir: string;
  runId: string;
  now?: () => Date;
  /** Ошибка записи не прерывает прогон: журнал — вспомогательный канал. */
  onError?: (error: Error) => void;
}

/**
 * Журнал прогона: JSONL, по файлу на `runId`. Пишется синхронно (несколько
 * записей на прогон), перед записью маскируются секреты.
 */
export class RunJournal {
  readonly path: string;
  private readonly now: () => Date;
  private readonly onError?: (error: Error) => void;

  constructor(options: RunJournalOptions) {
    this.path = join(options.dir, `${options.runId}.jsonl`);
    this.now = options.now ?? (() => new Date());
    this.onError = options.onError;
    mkdirSync(options.dir, { recursive: true });
  }

  /** Добавляет запись: `at` ставится автоматически, поля маскируются. */
  append(event: { type: RunEventType } & Record<string, unknown>): void {
    const entry = redact({ at: this.now().toISOString(), ...event });
    try {
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Записи журнала: нужны воспроизведению и тестам. */
  read(): Record<string, unknown>[] {
    try {
      return readFileSync(this.path, 'utf8')
        .replace(/^\uFEFF/, '')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    } catch {
      return [];
    }
  }
}
