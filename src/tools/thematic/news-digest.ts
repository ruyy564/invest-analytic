import { formatNumber } from '../../agent/report/portfolio-report.js';
import type { SourceCoverageEntry, SourceRegistry } from '../../sources/registry.js';
import type { SourceItem } from '../../sources/types.js';

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
 * раскладка по периодам по времени публикации.
 */
export const collectNewsDigest = async (
  registry: SourceRegistry,
  params: { tickers?: string[]; pages: number; maxItems: number; now?: Date },
): Promise<NewsDigestResult> => {
  const now = params.now ?? new Date();
  const { items, coverage } = await registry.newsDigest({
    tickers: params.tickers ?? [],
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

  for (const period of result.periods) {
    if (period.items.length === 0) {
      continue;
    }
    lines.push(`Новости ${period.title}:`);
    for (const item of period.items) {
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
export const newsBrief = (result: NewsDigestResult, limit = 6): string[] =>
  result.periods
    .flatMap((period) => period.items)
    .slice(0, limit)
    .map((item) => `${item.publishedAt.slice(0, 10)} ${item.title}`);

/** Относительное изменение ставки — для раздела макро. */
export const formatRateChange = (from: number, to: number): string => {
  if (from === 0) {
    return 'нет базы для сравнения';
  }
  const diff = to - from;
  const percent = (diff / from) * 100;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${formatNumber(diff)} п.п. (${sign}${formatNumber(percent)} %)`;
};
