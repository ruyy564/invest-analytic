import type { DynamicStructuredTool } from '@langchain/core/tools';
import { withTimeout } from '../tools/mcp-tool.adapter.js';
import { asJson } from '../tools/portfolio-snapshot.js';
import type { NewsQuery, NewsSourceAdapter, SourceItem, SourceTopic } from './types.js';
import { isDigestTitle } from './noise.js';

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

/**
 * Общие обзоры рынка: брокер помечает их всеми тикерами, но к конкретной бумаге
 * они не относятся — в разбор по бумагам такие заголовки не берём.
 */
export const GENERIC_NEWS = /итоги торгов|суммарные итоги|режим основных торгов|обзор рынка|итоги дня/i;

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
    if (GENERIC_NEWS.test(title) || isDigestTitle(title)) {
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
 * Новости брокера: только по бумагам портфеля. Общая лента сюда не попадает —
 * спорт, политика и кино не влияют на портфель. Даты в API нет, период
 * определяется по времени публикации; по тикеру листаем одну страницу.
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
    // Брокер умеет отдавать новости по конкретной бумаге.
    supportsTickerQuery: true,
    async fetchNews(query: NewsQuery): Promise<SourceItem[]> {
      const tickers = (query.tickers ?? []).filter((ticker) => ticker.length > 0).slice(0, 5);
      const batches: SourceItem[] = [];

      if (tickers.length > 0) {
        // Только новости по бумагам портфеля: общая лента не влияет на решения
        // и забивает отчёт спортом/политикой.
        for (const ticker of tickers) {
          try {
            batches.push(
              ...(await collect(ticker, {
                ...query,
                pages: 1,
                maxItems: Math.min(3, query.maxItems),
              })),
            );
          } catch {
            // Один тикер не должен ломать сводку: остальные соберём.
          }
        }
        // Пустой ответ — не ошибка: у бумаги может просто не быть новостей.
        return batches;
      }

      // Общая лента нужна только когда бумаги неизвестны (первая фаза плана).
      return collect(undefined, query);
    },
  };
};
