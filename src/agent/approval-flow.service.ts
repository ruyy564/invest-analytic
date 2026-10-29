import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { ApprovalExpiredError } from './approval.errors.js';
import type { ApprovalRule } from './approvals/approval-rules.schema.js';

export interface ApprovalAction {
  tool: string;
  label: string;
  args: Record<string, unknown>;
}

export interface ApprovePayload {
  question: string;
  actions: ApprovalAction[];
  accountId?: string;
}

export interface ApproveDecision {
  approved: boolean;
  comment?: string;
}

/** Собирает запрос подтверждения и считает срок его жизни. */
@Injectable()
export class ApprovalFlowService {
  private readonly requestedAt = new Map<string, string>();

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
  ): ApprovePayload {
    const actions = items.map((item) => ({
      tool: item.rule.tool,
      label: item.rule.label,
      args: item.args,
    }));
    return {
      question: items[0]?.rule.question ?? 'Подтвердить чтение данных?',
      actions,
      ...(accountId ? { accountId } : {}),
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
