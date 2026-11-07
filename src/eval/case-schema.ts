import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Ожидаемый ответ: те же поля, что в корзине диалогов, плюс необязательные. */
export const EvalAnswerSchema = z.object({
  mustContain: z.array(z.string()).default([]),
  mustNotContain: z.array(z.string()).default([]),
  /** Обязательные разделы ответа (заголовки markdown): структура аналитики. */
  sections: z.array(z.string()).default([]),
  /** Минимум строк-цитат вида «• 2026-11-05 [интерфакс] …». */
  minCitations: z.number().int().nonnegative().default(0),
  /** Минимум чисел в ответе: аналитика без цифр — не аналитика. */
  minNumbers: z.number().int().nonnegative().default(0),
});

/** Кейс оценки: вопрос, ожидаемый маршрут, инструменты и грейдеры. */
export const EvalCaseSchema = z.object({
  id: z.string().trim().min(1),
  question: z.string().trim().min(1),
  /**
   * Предыдущие вопросы той же сессии: нужны диалоговым регрессиям
   * («стоит ли её покупать» после «расскажи о Сбере»).
   */
  history: z.array(z.string().trim().min(1)).default([]),
  /** `rule` — маршрут детерминирован; `llm` — метку выбирает модель. */
  resolvedBy: z.enum(['rule', 'llm']).optional(),
  intent: z.string().optional(),
  scope: z.enum(['portfolio', 'account', 'instrument']).optional(),
  target: z.string().optional(),
  /** Инструменты, которые обязаны быть вызваны (tool-choice). */
  expectedTools: z.array(z.string()).default([]),
  /** Запрещённые инструменты: лишние вызовы считаются ошибкой. */
  forbiddenTools: z.array(z.string()).default([]),
  /** Сколько раз прогнать кейс: нужно для `pass@k` и `pass^k`. */
  trials: z.number().int().positive().default(1),
  tags: z.array(z.string()).default([]),
  /** Записанный ответ для офлайн-режима: если нет, берётся из каталога транскриптов. */
  transcript: z.string().optional(),
  answer: EvalAnswerSchema.optional(),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

/** Файл кейсов: массив или объект с полем `cases`. */
export const EvalFileSchema = z.union([
  z.array(EvalCaseSchema),
  z.object({ cases: z.array(EvalCaseSchema) }),
]);

/** Загрузка и валидация кейсов: битый файл — ошибка, а не «ноль кейсов». */
export const loadEvalCases = (path: string): EvalCase[] => {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const parsed = EvalFileSchema.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.cases;
};
