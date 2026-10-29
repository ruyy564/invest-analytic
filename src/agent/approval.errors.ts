/** Подтверждение пришло позже `APPROVAL_TTL_MINUTES`. */
export class ApprovalExpiredError extends Error {
  readonly code = 'APPROVAL_EXPIRED';

  constructor(message = 'Срок ожидания подтверждения истёк') {
    super(message);
    this.name = 'ApprovalExpiredError';
  }
}

/** У сессии нет ожидающего подтверждения. */
export class NotAwaitingApprovalError extends Error {
  readonly code = 'NOT_AWAITING_APPROVAL';

  constructor(message = 'Сессия не ожидает подтверждения') {
    super(message);
    this.name = 'NotAwaitingApprovalError';
  }
}
