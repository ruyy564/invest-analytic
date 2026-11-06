import { z } from 'zod';

/** Ошибка валидации входных данных (400). */
export class ApiValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  readonly details: string[];

  constructor(details: string[]) {
    super(details.join('; '));
    this.name = 'ApiValidationError';
    this.details = details;
  }
}

export const chatRequestSchema = z.object({
  message: z
    .string({ message: 'message обязателен' })
    .trim()
    .min(1, 'message не должен быть пустым')
    .max(2000, 'message длиннее 2000 символов'),
  sessionId: z.string().uuid('sessionId должен быть UUID').optional(),
});

export const approveRequestSchema = z.object({
  sessionId: z.string().uuid('sessionId должен быть UUID'),
  approved: z.boolean({ message: 'approved обязателен' }),
  comment: z.string().max(500, 'comment длиннее 500 символов').optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ApproveRequest = z.infer<typeof approveRequestSchema>;

/** Разбор тела запроса: любая проблема — `ApiValidationError` без обращения к LLM/MCP. */
export const parseOrThrow = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiValidationError(
      parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join('.') || '<body>'}: ${issue.message}`,
      ),
    );
  }
  return parsed.data;
};
