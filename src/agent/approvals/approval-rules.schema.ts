import { z } from 'zod';

/** Одно правило: какое действие и как спрашивать подтверждение. */
export const approvalRuleSchema = z.object({
  tool: z.string().trim().min(1, 'tool обязателен'),
  label: z.string().trim().min(1, 'label обязателен'),
  question: z.string().trim().min(1, 'question обязателен'),
  requiresApproval: z.boolean().default(true),
});

export type ApprovalRule = z.infer<typeof approvalRuleSchema>;

/** Формат файла `APPROVALS_FILE`: набор правил и (опционально) политика по умолчанию. */
export const approvalRulesFileSchema = z.object({
  rules: z.array(approvalRuleSchema).min(1, 'нужно хотя бы одно правило'),
  unlisted: z.enum(['require', 'allow']).optional(),
});

export type ApprovalRulesFile = z.infer<typeof approvalRulesFileSchema>;
