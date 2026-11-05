import { readFileSync } from 'node:fs';

export const INTERPRETATION_FALLBACK = [
  'Ты пишешь один раздел отчёта по портфелю частного инвестора: макро и цикл, оценку бумаг и секторов или итог по диверсификации и стратегии.',
  'Опирайся ТОЛЬКО на факты брифинга: числа, ставки, цены и события не придумывай.',
  'Если факта нет — пиши «данных нет», а не оценку. Оценки помечай словом (оценка).',
  'Отвечай по-русски, верни только текст раздела: без заголовков markdown и без префикса с кодом раздела.',
].join(' ');

export const loadInterpretationPrompt = (path: string): string => {
  try {
    return readFileSync(path, 'utf8').trim() || INTERPRETATION_FALLBACK;
  } catch {
    return INTERPRETATION_FALLBACK;
  }
};

/** Интерпретация идёт отдельными вызовами: разделов три, ответа ждём до минуты. */
export const INTERPRETATION_TIMEOUT_MS = 60_000;

/**
 * Ответ модели на конкретный раздел: снимаем заголовок и префикс `id:`.
 * Раздел уже подписан шаблоном, дублировать имя не нужно.
 */
export const cleanSection = (text: string, id: string): string =>
  text
    .replace(/^\s*#+\s+.*(\r?\n|$)/, '')
    .replace(new RegExp(`^\\s*[*_#>-]*\\s*${id}\\s*[*_]*\\s*[:\\-—]\\s*`, 'i'), '')
    .trim();

/** Узел отчёта: сборка по шаблону + один вызов модели на интерпретацию. */
