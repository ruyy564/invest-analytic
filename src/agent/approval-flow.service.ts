import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../platform/config/app-config.service.js';
import { ApprovalExpiredError } from './approval.errors.js';
import type { ApprovalRule } from './approvals/approval-rules.schema.js';

export interface ApprovalAction {
  tool: string;
  label: string;
  args: Record<string, unknown>;
}

/** Лимиты прогона, о которых пользователь узнаёт при подтверждении. */
export interface ApproveLimits {
  maxCalls: number;
  deadlineMs: number;
  approvalTtlMinutes: number;
}

export interface ApprovePayload {
  question: string;
  actions: ApprovalAction[];
  accountId?: string;
  /** Сколько вызовов и времени разрешено после подтверждения. */
  limits?: ApproveLimits;
  /** Когда согласие перестанет действовать. */
  expiresAt?: string;
}

export interface ApproveDecision {
  approved: boolean;
  comment?: string;
}

/** Собирает запрос подтверждения и считает срок его жизни. */
@Injectable()
export class ApprovalFlowService {
  private readonly requestedAt = new Map<string, string>();
  private readonly pending = new Set<string>();

  constructor(private readonly config: AppConfigService) {}

  get ttlMinutes(): number {
    return this.config.value.approvals.ttlMinutes;
  }

  /** Запоминает момент постановки в `interrupt` для проверки срока. */
  markRequested(sessionId: string, at: Date = new Date()): void {
    if (sessionId) {
      this.requestedAt.set(sessionId, at.toISOString());
    }
  }

  requestedAtOf(sessionId: string): string | undefined {
    return this.requestedAt.get(sessionId);
  }

  clear(sessionId: string): void {
    this.requestedAt.delete(sessionId);
  }

  /** Флаг «сессия ждёт решения» — чтобы различать 409 и обычное продолжение. */
  markPending(sessionId: string): void {
    if (sessionId) {
      this.pending.add(sessionId);
    }
  }

  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  clearPending(sessionId: string): void {
    this.pending.delete(sessionId);
  }

  /** Проверка срока для сессии: нет отметки — считаем, что подтверждения не ждали. */
  assertSessionNotExpired(sessionId: string, now: Date = new Date()): void {
    const requestedAt = this.requestedAt.get(sessionId);
    if (requestedAt) {
      this.assertNotExpired(requestedAt, now);
    }
  }

  buildPayload(
    items: { rule: ApprovalRule; args: Record<string, unknown> }[],
    accountId?: string,
    now: Date = new Date(),
  ): ApprovePayload {
    const actions = items.map((item) => ({
      tool: item.rule.tool,
      label: item.rule.label,
      args: item.args,
    }));
    const ttlMinutes = this.ttlMinutes;
    const run = this.config.value.run;
    return {
      question: items[0]?.rule.question ?? 'Подтвердить чтение данных?',
      actions,
      ...(accountId ? { accountId } : {}),
      // Пользователь видит, что именно разрешает: объём вызовов и срок согласия.
      limits: {
        maxCalls: run?.toolMaxCalls ?? 0,
        deadlineMs: run?.deadlineMs ?? 0,
        approvalTtlMinutes: ttlMinutes,
      },
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    };
  }

  isExpired(requestedAt: string, now: Date = new Date()): boolean {
    const requested = Date.parse(requestedAt);
    if (Number.isNaN(requested)) {
      throw new ApprovalExpiredError('Некорректное время запроса подтверждения');
    }
    return now.getTime() - requested > this.ttlMinutes * 60_000;
  }

  assertNotExpired(requestedAt: string, now: Date = new Date()): void {
    if (this.isExpired(requestedAt, now)) {
      throw new ApprovalExpiredError(
        `Подтверждение пришло позже ${this.ttlMinutes} мин — прогон не продолжен`,
      );
    }
  }
}
