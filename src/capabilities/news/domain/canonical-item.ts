import { z } from 'zod';

/**
 * Канонический элемент источника: единая схема для всех лент, брокера и
 * HTML-страниц. Невалидный элемент отбрасывается на границе, а не «протекает»
 * в отчёт.
 */
export const CanonicalItemSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().optional(),
  url: z.string().optional(),
  /** ISO 8601 со смещением: сравнение периодов не зависит от локали. */
  publishedAt: z.string().datetime({ offset: true }),
  source: z.string().trim().min(1),
  /** Рубрики источника. */
  tags: z.array(z.string()).default([]),
  /** Привязка к бумагам: теги инструментов, отдельно от рубрик. */
  instrumentTags: z.array(z.string()).default([]),
});

export type CanonicalItem = z.infer<typeof CanonicalItemSchema>;

/** Разбор элемента без исключения: причина отбраковки нужна отчёту стадий. */
export const parseCanonicalItem = (
  value: unknown,
): { ok: true; item: CanonicalItem } | { ok: false; reason: string } => {
  const parsed = CanonicalItemSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, item: parsed.data };
  }
  const issue = parsed.error.issues[0];
  return { ok: false, reason: `схема: ${issue?.path.join('.') ?? '?'} ${issue?.message ?? ''}`.trim() };
};
