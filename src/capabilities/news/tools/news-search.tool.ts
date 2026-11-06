import { DynamicStructuredTool } from '@langchain/core/tools';
import { toZodV3 } from '../../../mcp/tool-schema.js';
import { collectNewsDigest } from '../../../tools/news-digest/news-digest.service.js';
import type { NewsRegistry } from '../../../news/news.registry.js';

/** Имя фасада новостей: один инструмент на все источники. */
export const NEWS_SEARCH_TOOL = 'news__search';

export interface NewsSearchToolOptions {
  registry: NewsRegistry;
  scanPages: number;
  maxItems: number;
}

/**
 * Фасад новостей: параметры запроса вместо фиксированной сводки по четырём
 * периодам. Периоды и формат — дело представления, а не инструмента.
 */
export const createNewsSearchTool = (options: NewsSearchToolOptions): DynamicStructuredTool =>
  new DynamicStructuredTool({
    name: NEWS_SEARCH_TOOL,
    description:
      'Новости по бумаге или общая инвестиционная повестка. Параметры: тикер, глубина в днях, ' +
      'сколько заголовков вернуть. Источник и дата указаны у каждой новости.',
    schema: toZodV3({
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Тикер бумаги; без него — общая повестка' },
        days: { type: 'number', description: 'Глубина выборки в днях, по умолчанию 7' },
        limit: { type: 'number', description: 'Сколько заголовков вернуть, по умолчанию 8' },
      },
    }) as never,
    func: async (input: unknown) => {
      const args = (input ?? {}) as { ticker?: string; days?: number; limit?: number };
      const ticker = typeof args.ticker === 'string' ? args.ticker.trim().toUpperCase() : '';
      const days = Number.isFinite(args.days) && Number(args.days) > 0 ? Number(args.days) : 7;
      const limit = Number.isFinite(args.limit) && Number(args.limit) > 0 ? Number(args.limit) : 8;
      const result = await collectNewsDigest(options.registry, {
        tickers: ticker ? [ticker] : [],
        names: ticker ? [ticker] : [],
        pages: options.scanPages,
        maxItems: Math.max(limit, options.maxItems > 0 ? Math.min(options.maxItems, 20) : limit),
      });
      // Оставляем один период: глубина задана параметром, а не четырьмя окнами.
      const items = result.periods
        .flatMap((period) => period.items)
        .filter((item, index, list) => list.findIndex((other) => other.title === item.title) === index);
      const recent = filterByDays(items, days).slice(0, limit);
      const title = ticker ? `Новости ${ticker} за ${days} дн.:` : `Новости рынка за ${days} дн.:`;
      const lines = [title];
      for (const item of recent) {
        lines.push(`• ${item.publishedAt.slice(0, 10)} [${item.source}] ${item.title}`);
      }
      if (recent.length === 0) {
        lines.push('новостей нет');
      }
      const missing = result.coverage.filter((entry) => entry.status === 'missing');
      if (missing.length > 0) {
        lines.push(`Недоступные источники: ${missing.map((entry) => entry.source).join(', ')}`);
      }
      return lines.join('\n');
    },
  } as never);

/** Оставляет новости не старше указанного числа дней. */
const filterByDays = <T extends { publishedAt: string }>(items: T[], days: number): T[] => {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return items.filter((item) => Date.parse(item.publishedAt) >= since);
};
