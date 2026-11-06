import { redactString } from './redact.js';

export interface LogEntryInput {
  requestId: string;
  sessionId?: string;
  intent?: string;
  durationMs?: number;
  tools?: string[];
  errorCode?: string;
  question?: string;
  logQuestionText: boolean;
}

/** Структурная запись лога: текст вопроса — только при включённом флаге. */
export const formatLogEntry = (input: LogEntryInput): Record<string, unknown> => {
  const entry: Record<string, unknown> = {
    requestId: input.requestId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.intent ? { intent: input.intent } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };

  if (input.logQuestionText && input.question) {
    entry.question = redactString(input.question);
  }

  return entry;
};
