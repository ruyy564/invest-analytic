import { z } from 'zod';

/** Подраздел темы: свой заголовок и тезисы (фазы цикла, разбор по кризисам). */
export const KnowledgeSectionSchema = z.object({
  title: z.string().trim().min(1),
  points: z.array(z.string()).default([]),
});

/** Тема: определение, тезисы, подразделы, ошибки, теги отбора и источники. */
export const KnowledgeTopicSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  points: z.array(z.string()).default([]),
  details: z.array(KnowledgeSectionSchema).default([]),
  pitfalls: z.array(z.string()).default([]),
  sections: z.array(z.string()).default([]),
  sectors: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
});

export type KnowledgeTopic = z.infer<typeof KnowledgeTopicSchema>;

/** Один файл-тема: `version` + `topics` (в файле обычно одна тема). */
export const KnowledgeFileSchema = z.object({
  version: z.number().int().positive().default(1),
  topics: z.array(KnowledgeTopicSchema).default([]),
});

export type KnowledgeData = z.infer<typeof KnowledgeFileSchema>;

export const EMPTY_KNOWLEDGE: KnowledgeData = { version: 1, topics: [] };

/** Что нужно от базы знаний вызывающему: раздел, секторы или вопрос. */
export interface KnowledgeQuery {
  section?: string;
  sectors?: readonly string[];
  question?: string;
  required?: readonly string[];
  limit?: number;
}

/**
 * Контракт для потребителей (движок отчёта, узлы): им нужен только блок знаний,
 * а не файлы и не Nest. Реализация — `KnowledgeService`.
 */
export interface KnowledgeProvider {
  readonly isEmpty: boolean;
  promptBlock(query: KnowledgeQuery & { maxChars?: number; requireChecklist?: boolean }): string | undefined;
  topicFor(question: string): KnowledgeTopic | undefined;
  answerFor(question: string): string | undefined;
  miss(): string;
}
