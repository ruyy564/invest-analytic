import { AIMessage } from '@langchain/core/messages';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AppConfigService } from '../../../platform/config/app-config.service.js';
import type { McpRegistryService } from '../../../transports/mcp/mcp-registry.service.js';
import { collectNewsFeed, formatNewsFeed } from '../../../capabilities/news/tools/news-digest/news-digest.service.js';
import type { AgentStateType } from '../../graph/state.js';

export interface NewsDeps {
  config: AppConfigService;
  registry: McpRegistryService;
}

/** Подпись периода по числу дней: 1 — «Сегодня», 7 — «За неделю» и так далее. */
export const feedPeriodTitle = (days: number): string => {
  if (days === 1) {
    return 'Сегодня';
  }
  if (days === 7) {
    return 'За неделю';
  }
  if (days === 30) {
    return 'За месяц';
  }
  if (days === 180) {
    return 'За полгода';
  }
  return `За ${days} дней`;
};

/**
 * Узел сводки новостей: общая инвестиционная повестка по периодам.
 * Не читает портфель, не запрашивает подтверждение и не вызывает модель —
 * ответ собирается кодом из данных источников.
 */
export const createNewsNode =
  (deps: NewsDeps) =>
  async (
    _state: AgentStateType,
    config?: LangGraphRunnableConfig,
  ): Promise<Partial<AgentStateType>> => {
    const sessionId = String(config?.configurable?.thread_id ?? '');
    // Брокерский источник внутри дергает MCP-инструмент: бюджет прогона нужен,
    // хотя подтверждение для публичных новостей не запрашивается.
    deps.registry.beginRun(sessionId);
    try {
      const { news, newsFeed } = deps.config.value.sources;
      const registry = deps.registry.news;
      if (!registry) {
        return {
          messages: [
            new AIMessage('Источники новостей недоступны: реестр источников не инициализирован.'),
          ],
          reportType: 'market_news',
          dataAsOf: new Date().toISOString(),
          partial: true,
        };
      }

      const feed = await collectNewsFeed(registry, {
        pages: news.scanPages,
        maxItems: news.maxItems,
        periods: newsFeed.periodDays.map((days) => ({
          id: `d${days}`,
          title: feedPeriodTitle(days),
          days,
        })),
        maxPerPeriod: newsFeed.maxPerPeriod,
      });

      return {
        messages: [new AIMessage(formatNewsFeed(feed))],
        reportType: 'market_news',
        dataAsOf: feed.asOf,
        // Покрытие источников попадает в метаданные ответа тем же полем, что и у отчёта.
        collection: {
          results: {},
          coverage: feed.coverage,
          partial: feed.coverage.some((entry) => entry.status === 'missing'),
        },
        // Недоступный источник делает сводку частичной, но не пустой.
        partial: feed.coverage.some((entry) => entry.status === 'missing'),
      };
    } catch (error) {
      return {
        messages: [
          new AIMessage(
            `Не удалось собрать новости: ${(error as Error)?.message ?? 'источники не ответили'}.`,
          ),
        ],
        reportType: 'market_news',
        dataAsOf: new Date().toISOString(),
        partial: true,
      };
    } finally {
      deps.registry.endRun(sessionId);
    }
  };
