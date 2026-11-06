import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

/** Рубрика оценки: оси, версия и минимальный проходной балл. */
export interface JudgeRubric {
  id: string;
  version: number;
  axes: readonly string[];
  minScore: number;
}

/** Оценка разбора бумаги: факты, риски, отсутствие рекомендаций. */
export const CONCLUSION_RUBRIC: JudgeRubric = {
  id: 'conclusion',
  version: 1,
  axes: ['полнота фактов', 'опора на бриф, без выдуманных чисел', 'риски и что проверить', 'структура'],
  minScore: 4,
};

export interface JudgeResult {
  score?: number;
  reason: string;
  rubricId: string;
  rubricVersion: number;
}

const INSTRUCTIONS = [
  'Ты оцениваешь ответ инвестиционного ассистента по рубрике.',
  'Верни строго JSON: {"score": <1-5>, "reason": "<одно предложение>"}.',
  'Не добавляй текст вне JSON. Оценка 5 — все оси выполнены, 1 — ответ бесполезен.',
].join('\n');

/** Достаёт первый JSON-объект из ответа модели. */
export const parseJudgeResponse = (text: string): { score?: number; reason: string } => {
  const match = /\{[\s\S]*?\}/.exec(text);
  if (!match) {
    return { reason: 'не удалось разобрать оценку' };
  }
  try {
    const parsed = JSON.parse(match[0]) as { score?: unknown; reason?: unknown };
    const score = typeof parsed.score === 'number' ? parsed.score : undefined;
    return {
      score,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'без обоснования',
    };
  } catch {
    return { reason: 'невалидный JSON в оценке' };
  }
};

/**
 * Оценка ответа моделью по рубрике. Сеть нужна: вызывается только в режиме
 * `judge`, в обычном прогоне тестов не используется.
 */
export const judgeAnswer = async (options: {
  model: BaseChatModel;
  rubric: JudgeRubric;
  question: string;
  answer: string;
}): Promise<JudgeResult> => {
  const prompt = [
    INSTRUCTIONS,
    `Рубрика: ${options.rubric.id} (версия ${options.rubric.version}).`,
    `Оси: ${options.rubric.axes.join('; ')}.`,
    `Вопрос пользователя: ${options.question}`,
  ].join('\n');

  const response = await options.model.invoke([
    new SystemMessage(prompt),
    new HumanMessage(options.answer),
  ]);
  const text = typeof response.content === 'string' ? response.content : '';
  const parsed = parseJudgeResponse(text);

  return {
    score: parsed.score,
    reason: parsed.reason,
    rubricId: options.rubric.id,
    rubricVersion: options.rubric.version,
  };
};
