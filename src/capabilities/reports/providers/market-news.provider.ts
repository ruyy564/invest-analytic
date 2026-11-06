import { resultsInGroup } from '../collection/executor.js';
import type { FactContext, FactProvider, SectionFacts } from '../engine.js';

/** Сколько заголовков фона рынка показываем: больше — уже шум. */
export const MARKET_NEWS_LIMIT = 5;

/** Заголовки общей сводки новостей: нужны и секции фона, и выводу по бумаге. */
export const marketHeadlines = (ctx: FactContext, limit = MARKET_NEWS_LIMIT): string[] => {
  const text = resultsInGroup(ctx.plan, ctx.collected, 'market_news')[0]?.text;
  if (!text) {
    return [];
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('•'))
    .slice(0, limit);
};

/**
 * Фон рынка: общая сводка новостей из уже собранной ветки новостей.
 * Секция отвечает на «что происходит на рынке», пока разбор идёт по бумагам.
 */
export const marketNewsProvider: FactProvider = {
  id: 'market.news',
  section(ctx: FactContext): SectionFacts | undefined {
    const headlines = marketHeadlines(ctx);
    if (headlines.length === 0) {
      const text = resultsInGroup(ctx.plan, ctx.collected, 'market_news')[0]?.text;
      return { missing: text ? 'новостей за неделю нет' : 'общая сводка новостей не собиралась' };
    }
    return {
      markdown: ['Фон рынка: новости за неделю', ...headlines].join('\n'),
      brief: headlines.join(' | ').slice(0, 1_500),
    };
  },
};
