import { resultsInGroup } from '../../collection/executor.js';
import type { FactContext, FactProvider, SectionFacts } from '../engine.js';

/** Сколько заголовков фона рынка показываем: больше — уже шум. */
export const MARKET_NEWS_LIMIT = 5;

/**
 * Фон рынка: общая сводка новостей из уже собранной ветки новостей.
 * Секция отвечает на «что происходит на рынке», пока разбор идёт по бумагам.
 */
export const marketNewsProvider: FactProvider = {
  id: 'market.news',
  section(ctx: FactContext): SectionFacts | undefined {
    const text = resultsInGroup(ctx.plan, ctx.collected, 'market_news')[0]?.text;
    if (!text) {
      return { missing: 'общая сводка новостей не собиралась' };
    }
    const headlines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('•'))
      .slice(0, MARKET_NEWS_LIMIT);
    if (headlines.length === 0) {
      return { missing: 'новостей за неделю нет' };
    }
    return {
      markdown: ['Фон рынка: новости за неделю', ...headlines].join('\n'),
      brief: headlines.join(' | ').slice(0, 1_500),
    };
  },
};
