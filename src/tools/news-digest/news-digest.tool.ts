import type { DynamicStructuredTool } from '@langchain/core/tools';
import { DynamicStructuredTool as DynamicTool } from '@langchain/core/tools';
import { toZodV3 } from '../../mcp/tool-schema.js';
import type { NewsRegistry } from '../../news/news.registry.js';
import { collectNewsDigest, formatNewsDigest, NEWS_DIGEST_TOOL } from './news-digest.service.js';

/** Параметры тула сводки: реестр новостей и лимиты выборки. */
export interface NewsDigestToolOptions {
  newsRegistry: NewsRegistry;
  scanPages: number;
  maxItems: number;
}

/** Тонкая обёртка: схема аргументов, описание и вызов сводки. */
export const createNewsDigestTool = (options: NewsDigestToolOptions): DynamicStructuredTool => {
  const { newsRegistry, scanPages, maxItems } = options;
  return new DynamicTool({
    name: NEWS_DIGEST_TOOL,
    description:
      'Сводка новостей по бумагам портфеля и по общей ленте: свежие, за неделю, за месяц, ' +
      'за полгода. Источник и дата указаны у каждой новости.',
    schema: toZodV3({
      type: 'object',
      properties: {
        tickers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Тикеры портфеля, по которым нужны новости',
        },
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Названия компаний бумаг: по ним фильтруются общие ленты',
        },
        days: { type: 'number', description: 'Глубина выборки в днях, по умолчанию 180' },
      },
    }) as never,
    func: async (input: unknown) => {
      const args = (input ?? {}) as { tickers?: string[]; names?: string[]; days?: number };
      const result = await collectNewsDigest(newsRegistry, {
        tickers: Array.isArray(args.tickers) ? args.tickers : [],
        names: Array.isArray(args.names) ? args.names : [],
        pages: scanPages,
        maxItems,
      });
      const total = result.periods.reduce((sum, period) => sum + period.items.length, 0);
      if (total === 0) {
        // В отчёте видно только «новостей нет», причина — в логе.
        console.warn(
          '[news] пусто:',
          JSON.stringify(args.tickers ?? []),
          JSON.stringify(result.coverage.filter((entry) => entry.status !== 'ok' || !entry.items)),
        );
      }
      return formatNewsDigest(result);
    },
  } as never);
};
