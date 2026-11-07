import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '../../platform/config/app-config.service.js';
import { collectNewsDigest } from '../../capabilities/news/tools/news-digest/news-digest.service.js';
import { factorsFor } from '../../capabilities/news/factors.js';
import { loadCompanyProfiles } from '../../capabilities/reports/index.js';
import { loadWatchlist } from '../../capabilities/news/watchlist.js';
import { loadTickerAliases } from '../../capabilities/news/news.aliases.js';
import { storedId, toStored, type StoredNews } from '../../capabilities/news/store/news-index.js';
import { McpRegistryService } from './mcp-registry.service.js';

/**
 * Фоновый сбор новостей.
 *
 * Пока пользователь не спросил — публикации уже лежат в индексе: ответ не ждёт
 * ленты и не упирается в её сетевое окно. Собираем общую повестку и отраслевые
 * факторы (нефть, курс, ставка, санкции) — именно там причины движения цены.
 */
@Injectable()
export class NewsCrawlerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('NewsCrawler');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfigService,
    private readonly registry: McpRegistryService,
  ) {}

  onModuleInit(): void {
    const news = this.config.value.sources.news;
    if (!news.crawlerEnabled) {
      return;
    }
    this.timer = setInterval(
      () => {
        void this.collectOnce().catch((error: unknown) => {
          this.logger.warn(`фон новостей: ${(error as Error)?.message ?? String(error)}`);
        });
      },
      news.crawlerIntervalMin * 60_000,
    );
    // Сбор не должен держать процесс живым.
    this.timer.unref?.();
    void this.collectOnce().catch(() => undefined);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Один проход: общая повестка и факторы → индекс, затем чистка старого. */
  async collectOnce(now: Date = new Date()): Promise<number> {
    const news = this.config.value.sources.news;
    await this.registry.ensureInitialized();
    const index = this.registry.index;
    const registry = this.registry.news;
    if (!index || !registry) {
      return 0;
    }

    // Факторы: рыночные плюс отраслевые ключи — их новости и бывают причинами.
    const profiles = loadCompanyProfiles(this.config.value.sources.companyProfilesFile);
    const keywords = [...new Set(factorsFor(undefined, profiles).flatMap((q) => q.keywords))];
    const collected: StoredNews[] = [];

    for (const names of [keywords, []]) {
      try {
        const digest = await collectNewsDigest(registry, {
          names,
          pages: news.scanPages,
          maxItems: news.crawlerMaxItems,
          now,
        });
        for (const item of digest.periods.flatMap((period) => period.items)) {
          collected.push(toStored(item, { now }));
        }
      } catch (error) {
        // Один проход не собрал — следующий соберёт: фон не падает.
        this.logger.warn(`фон новостей: ${(error as Error)?.message ?? String(error)}`);
      }
    }

    const unique = new Map(collected.map((item) => [storedId(item), item]));

    // Бумаги из watchlist: их новости нужны чаще всего, держим их свежими в индексе.
    const aliases = loadTickerAliases(this.config.value.sources.tickerAliasesFile);
    for (const ticker of loadWatchlist(news.watchlistFile)) {
      try {
        const digest = await collectNewsDigest(registry, {
          tickers: [ticker],
          names: aliases[ticker] ?? [],
          pages: news.scanPages,
          maxItems: Math.min(news.crawlerMaxItems, 20),
          now,
        });
        for (const item of digest.periods.flatMap((period) => period.items)) {
          const stored = toStored(item, { tickers: [ticker], now });
          unique.set(stored.id, stored);
        }
      } catch (error) {
        this.logger.warn(
          `фон новостей ${ticker}: ${(error as Error)?.message ?? String(error)}`,
        );
      }
    }

    index.save([...unique.values()], now);
    index.prune(news.indexTtlDays, now);
    this.logger.log(`индекс новостей: +${unique.size}, всего ${index.size()}`);
    return unique.size;
  }
}
