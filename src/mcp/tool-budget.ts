import { RunBudgetExceededError } from './errors.js';

export interface ToolBudgetOptions {
  maxCalls: number;
  deadlineMs: number;
  now?: () => number;
}

/**
 * Бюджет прогона: ограничивает число вызовов инструментов и общее время.
 * Счётчик общий для всех инструментов, поэтому суммируется через паузы подтверждений
 * (состояние создаётся на прогон, а не на вызов).
 */
export class ToolBudget {
  private calls = 0;
  private readonly startedAt: number;
  private readonly now: () => number;

  constructor(private readonly options: ToolBudgetOptions) {
    this.now = options.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  get usedCalls(): number {
    return this.calls;
  }

  /** Бросает ошибку, если лимит вызовов или времени исчерпан. */
  assertAvailable(toolName: string): void {
    if (!this.hasCallsLeft()) {
      throw new RunBudgetExceededError(
        `Лимит вызовов инструментов (${this.options.maxCalls}) исчерпан перед вызовом ${toolName}`,
      );
    }
    if (this.isExpired()) {
      throw new RunBudgetExceededError(
        `Лимит времени прогона (${this.options.deadlineMs} мс) исчерпан перед вызовом ${toolName}`,
      );
    }
  }

  /** Регистрирует факт вызова и возвращает текущее значение счётчика. */
  registerCall(): number {
    this.calls += 1;
    return this.calls;
  }

  hasCallsLeft(): boolean {
    return this.calls < this.options.maxCalls;
  }

  isExpired(): boolean {
    return this.now() - this.startedAt >= this.options.deadlineMs;
  }

  remainingMs(): number {
    return Math.max(0, this.options.deadlineMs - (this.now() - this.startedAt));
  }
}
