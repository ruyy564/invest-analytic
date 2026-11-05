import { type SourceCoverageEntry, type NewsRegistry } from '../../news/news.registry.js';
import { isDigestTitle, isOffTopicTitle, hasInvestmentMarker } from '../../news/news.filters.js';
import type { SourceItem } from '../../news/news.types.js';

export const NEWS_DIGEST_TOOL = 'market__news_digest';

/** Периоды сводки: свежие, неделя, месяц, полгода. */
export const NEWS_PERIODS = [
  { id: 'fresh', title: 'свежие', days: 1 },
  { id: 'week', title: 'за неделю', days: 7 },
  { id: 'month', title: 'за месяц', days: 30 },
  { id: 'half_year', title: 'за полгода', days: 180 },
] as const;

export type NewsPeriodId = (typeof NEWS_PERIODS)[number]['id'];

export interface NewsDigestResult {
  /** Новости по периодам, от свежих к старым. */
  periods: { id: NewsPeriodId; title: string; items: SourceItem[] }[];
  coverage: SourceCoverageEntry[];
  asOf: string;
}

const PERIOD_MS = (days: number): number => days * 24 * 60 * 60 * 1000;

/**
 * Сводка новостей по бумагам портфеля и по общей ленте: один сбор, затем
 * раскладка по периодам по времени публикации. Названия компаний нужны,
 * чтобы ленты (РБК, «Интерфакс») фильтровали заголовки по бумаге.
 */
export const collectNewsDigest = async (
  registry: NewsRegistry,
  params: { tickers?: string[]; names?: string[]; pages: number; maxItems: number; now?: Date },
): Promise<NewsDigestResult> => {
  const now = params.now ?? new Date();
  const tickers = params.tickers ?? [];
  const matchers = [...tickers, ...(params.names ?? [])].filter((value) => value.trim().length > 1);
  const { items, coverage } = await registry.newsDigest({
    tickers,
    matchers,
    pages: params.pages,
    maxItems: Math.max(params.maxItems, 20),
    sinceDays: 180,
  });

  const periods = NEWS_PERIODS.map((period) => ({
    id: period.id,
    title: period.title,
    items: items
      .filter((item) => now.getTime() - Date.parse(item.publishedAt) <= PERIOD_MS(period.days))
      .slice(0, params.maxItems),
  }));

  return { periods, coverage, asOf: now.toISOString() };
};

/** Текст сводки: заголовки с датой и источником, без пересказа содержания. */
export const formatNewsDigest = (result: NewsDigestResult): string => {
  const lines: string[] = [];
  const empty = result.periods.every((period) => period.items.length === 0);
  if (empty) {
    lines.push('Новостей по портфелю за последние полгода не найдено.');
  }

  // Одна публикация показывается один раз — в самом свежем периоде, куда попала:
  // иначе свежие новости дублируются в неделе, месяце и полугодии.
  const seen = new Set<string>();
  for (const period of result.periods) {
    const items = period.items.filter((item) => !seen.has(item.title));
    for (const item of items) {
      seen.add(item.title);
    }
    if (items.length === 0) {
      continue;
    }
    lines.push(`Новости ${period.title}:`);
    for (const item of items) {
      lines.push(`• ${item.publishedAt.slice(0, 10)} [${item.source}] ${item.title}`);
    }
  }

  const missing = result.coverage.filter((entry) => entry.status === 'missing');
  if (missing.length > 0) {
    lines.push(
      `Недоступные источники: ${missing.map((entry) => `${entry.source} (${entry.reason})`).join(', ')}`,
    );
  }
  lines.push(`Данные на ${result.asOf}`);
  return lines.join('\n');
};

/** Краткая версия для брифинга интерпретации: только свежие заголовки. */
/** Окно новостной сводки: подпись и глубина в днях. */
export interface NewsFeedPeriod {
  id: string;
  title: string;
  days: number;
  items: SourceItem[];
}

export interface NewsFeedResult {
  periods: NewsFeedPeriod[];
  coverage: SourceCoverageEntry[];
  asOf: string;
}

/** Периоды по умолчанию: сегодня, неделя, месяц, полгода. */
export const NEWS_FEED_PERIODS = [
  { id: 'today', title: 'Сегодня', days: 1 },
  { id: 'week', title: 'За неделю', days: 7 },
  { id: 'month', title: 'За месяц', days: 30 },
  { id: 'half_year', title: 'За полгода', days: 180 },
] as const;

/** Сколько публикаций показывать в одном периоде, если лимит не задан. */
export const NEWS_FEED_MAX_PER_PERIOD = 8;

/**
 * Сводка инвестиционных новостей без привязки к портфелю: общая повестка всех
 * источников, разложенная по окнам времени. Каждая публикация попадает только
 * в самое свежее окно, куда укладывается по дате.
 */
export const collectNewsFeed = async (
  registry: NewsRegistry,
  params: {
    pages: number;
    maxItems: number;
    periods?: readonly { id: string; title: string; days: number }[];
    maxPerPeriod?: number;
    now?: Date;
  },
): Promise<NewsFeedResult> => {
  const now = params.now ?? new Date();
  const periods = params.periods ?? NEWS_FEED_PERIODS;
  const maxPerPeriod = params.maxPerPeriod ?? NEWS_FEED_MAX_PER_PERIOD;
  const longest = periods.reduce((max, period) => Math.max(max, period.days), 1);

  // Тикеров нет: это общая повестка, а не новости конкретных бумаг.
  const { items, coverage } = await registry.newsDigest({
    pages: params.pages,
    // Пул должен быть заметно больше выдачи: иначе в окна попадают только
    // самые свежие публикации двух-трёх лент, а деловые ленты не видны вовсе.
    maxItems: Math.max(params.maxItems, maxPerPeriod * periods.length * 8),
    sinceDays: longest,
  });

  const relevant = items
    .filter((entry) => !isDigestTitle(entry.title))
    .filter((entry) => !isOffTopicTitle(entry.title, entry.summary))
    // Общая лента приносит и некрологи, и политику: в сводку берём только
    // заголовки с инвестиционным маркером (рынок, бумаги, ставка, эмитент…).
    .filter((entry) => hasInvestmentMarker(entry.title))
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));

  const used = new Set<string>();
  // Один источник не должен занимать весь период: сводка должна быть обзорной.
  const maxPerSource = Math.max(1, Math.ceil(maxPerPeriod / 2));
  const buckets = periods.map((period) => ({
    id: period.id,
    title: period.title,
    days: period.days,
    items: [] as SourceItem[],
    perSource: new Map<string, number>(),
  }));

  for (const entry of relevant) {
    const age = now.getTime() - Date.parse(entry.publishedAt);
    // Самое свежее окно, в которое попадает публикация.
    const bucket = buckets.find((candidate) => age <= candidate.days * 24 * 60 * 60 * 1000);
    if (!bucket || bucket.items.length >= maxPerPeriod) {
      continue;
    }
    const fromSource = bucket.perSource.get(entry.source) ?? 0;
    if (fromSource >= maxPerSource) {
      continue;
    }
    const key = entry.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (used.has(key)) {
      continue;
    }
    used.add(key);
    bucket.perSource.set(entry.source, fromSource + 1);
    bucket.items.push(entry);
  }

  return {
    periods: buckets.map(({ perSource: _perSource, ...period }) => period),
    coverage,
    asOf: now.toISOString(),
  };
};

/** Ответ пользователю: периоды с датами и источниками, покрытие и время данных. */
export const formatNewsFeed = (result: NewsFeedResult): string => {
  const lines: string[] = [`Новости инвестиционного рынка (данные на ${result.asOf})`, ''];
  const filled = result.periods.filter((period) => period.items.length > 0);

  // Пустые окна не занимают экран: если новостей нет вовсе — одна строка.
  if (filled.length === 0) {
    lines.push('За выбранный период инвестиционных новостей нет.', '');
  }

  for (const period of filled) {
    lines.push(period.title);
    for (const entry of period.items) {
      lines.push(`• ${entry.publishedAt.slice(0, 10)} [${entry.source}] ${entry.title}`);
    }
    lines.push('');
  }

  if (result.coverage.length > 0) {
    lines.push(
      `Источники: ${result.coverage
        .map((entry) =>
          entry.status === 'ok'
            ? `${entry.source} — получено${entry.items ? ` (${entry.items})` : ''}`
            : `${entry.source} — недоступен${entry.reason ? ` (${entry.reason})` : ''}`,
        )
        .join(', ')}`,
    );
  }
  lines.push(`Данные обновлены: ${result.asOf}`);
  return lines.join('\n');
};

