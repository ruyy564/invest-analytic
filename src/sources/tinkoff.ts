import type { DynamicStructuredTool } from '@langchain/core/tools';
import { withTimeout } from '../tools/mcp-tool.adapter.js';
import { asJson } from '../tools/portfolio-snapshot.js';
import type { NewsQuery, NewsSourceAdapter, SourceItem, SourceTopic } from './types.js';

export interface TinkoffNewsSourceOptions {
  /** Инструмент по короткому имени, например `invest_get_news`. */
  tool: (name: string) => DynamicStructuredTool | undefined;
  timeoutMs: number;
  topics?: readonly SourceTopic[];
  /** Сколько символов текста новости оставлять. */
  summaryLimit?: number;
}

interface RawNews {
  id?: string;
  source?: string;
  title?: string;
  content?: string;
  ts?: string;
  instrumentId?: string[];
}

/** Ответ `invest_get_news` → элементы общего вида и курсор следующей страницы. */
export const mapNews = (
  raw: unknown,
  sourceId: string,
  summaryLimit = 400,
): { items: SourceItem[]; nextCursor?: string } => {
  const root = asJson(raw) as { items?: RawNews[]; nextCursor?: string } | undefined;
  const list = Array.isArray(root?.items) ? root.items : [];

  const items = list.flatMap((item) => {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const publishedAt = typeof item.ts === 'string' ? new Date(item.ts).toISOString() : undefined;
    if (!title || publishedAt === undefined || Number.isNaN(Date.parse(publishedAt))) {
      return [];
    }
    const content = typeof item.content === 'string' ? item.content.replace(/\s+/g, ' ').trim() : '';
    return [
      {
        id: item.id ?? `${publishedAt}-${title.slice(0, 24)}`,
        title,
        summary: content ? content.slice(0, summaryLimit) : undefined,
        publishedAt,
        tags: [item.source ?? '', ...(item.instrumentId ?? [])].filter((tag) => tag.length > 0),
        source: sourceId,
      },
    ];
  });

  return { items, nextCursor: root?.nextCursor };
};

/**
 * Новости брокера: общая лента и лента по тикерам. Даты в API нет — период
 * определяется по времени публикации. По тикеру листаем одну страницу:
 * глубина выборки важнее для общей ленты, а каждая страница — вызов из бюджета.
 */
export const createTinkoffNewsSource = (options: TinkoffNewsSourceOptions): NewsSourceAdapter => {
  const call = async (args: Record<string, unknown>): Promise<{ items: SourceItem[]; nextCursor?: string }> => {
    const tool = options.tool('invest_get_news');
    if (!tool) {
      throw new Error('инструмент новостей недоступен');
    }
    const raw = await withTimeout(
      tool.invoke(args as never),
      options.timeoutMs,
      () => new Error('таймаут новостей'),
    );
    return mapNews(raw, 'tinkoff', options.summaryLimit);
  };

  const collect = async (instrumentId: string | undefined, query: NewsQuery): Promise<SourceItem[]> => {
    const collected: SourceItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < Math.max(1, query.pages); page += 1) {
      const args: Record<string, unknown> = { limit: query.maxItems };
      if (instrumentId) {
        args.instrumentId = instrumentId;
      }
      if (cursor) {
        args.cursor = cursor;
      }
      const { items, nextCursor } = await call(args);
      collected.push(...items);
      if (!nextCursor || items.length === 0) {
        break;
      }
      cursor = nextCursor;
    }
    return collected;
  };

  return {
    id: 'tinkoff',
    topics: options.topics ?? ['news', 'tax'],
    async fetchNews(query: NewsQuery): Promise<SourceItem[]> {
      const tickers = (query.tickers ?? []).filter((ticker) => ticker.length > 0);
      const batches: SourceItem[] = [];

      for (const ticker of tickers.slice(0, 5)) {
        try {
          // По бумаге достаточно первой страницы: период считается по дате публикации.
          batches.push(
            ...(await collect(ticker, { ...query, pages: 1, maxItems: Math.min(3, query.maxItems) })),
          );
        } catch {
          // Один тикер не должен ломать сводку: остальные ленты соберём.
        }
      }
      try {
        batches.push(...(await collect(undefined, query)));
      } catch {
        if (batches.length === 0) {
          throw new Error('новости брокера недоступны');
        }
      }

      return batches;
    },
  };
};
