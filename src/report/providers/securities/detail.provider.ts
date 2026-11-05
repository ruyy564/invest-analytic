import { resultsInGroup } from '../../../collection/executor.js';
import { formatNumber, UNAVAILABLE } from '../../../report/portfolio-report.js';
import { METAL_LABELS, metalForTicker, metalQuoteOf } from '../../../commodities/commodity.links.js';
import {
  EXPOSURE_LABELS,
  EMPTY_PROFILES,
  exposureOf,
  sectorProfileOf,
  sensitivityWord,
  type CompanyProfiles,
} from '../../company-profiles.js';
import type { FactContext, FactProvider, SectionFacts } from '../../engine.js';
import { formatChangePct, trendWord, type PeriodChange } from '../../market-facts.js';
import { formatPercent } from '../../renderers.js';
import { CHART_DAYS } from '../../sparkline.js';
import { RECOMMENDATIONS } from '../market.js';
import {
  dividendLine,
  noHoldingsReason,
  periodsLine,
  securitiesOf,
  type SecurityFacts,
} from './shared.js';
import { bondLine } from './bond-facts.js';

/**
 * Сырьевой фактор бумаги: для PLZL важна цена золота, а не только свечи.
 * Строка появляется, только если металл известен и ЦБ дал котировку.
 */
const commodityLine = (ctx: FactContext, ticker: string): string | undefined => {
  const metal = metalForTicker(ticker);
  if (!metal) {
    return undefined;
  }
  const text = resultsInGroup(ctx.plan, ctx.collected, 'commodities')[0]?.text ?? '';
  const quote = metalQuoteOf(text, metal);
  return quote
    ? `• сырьё: ${METAL_LABELS[metal]} ${formatNumber(quote.price)} ₽/г на ${quote.date} (ЦБ РФ)`
    : undefined;
};

/** Нормализованный заголовок: по нему отчёт понимает, что новость уже показана. */
export const headlineKey = (headline: string): string =>
  headline
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Профиль бумаги: экспортёр / внутренний рынок / импортёр и драйверы её сектора.
 * Данные — из `data/company-profiles.yaml`; без файла строки просто не выводятся.
 */
const profileLines = (profiles: CompanyProfiles, security: SecurityFacts): string[] => {
  // Облигация — это долг: профиль «экспортёр / импортёр» к ней не применяется.
  if (security.bond) {
    return [];
  }
  const lines: string[] = [];
  const exposure = exposureOf(profiles, security.ticker, security.sector);
  const sectorProfile = sectorProfileOf(profiles, security.sector);

  if (exposure) {
    const parts = [EXPOSURE_LABELS[exposure.exposure]];
    if (exposure.currencyShare !== undefined) {
      parts.push(`валютная выручка около ${formatPercent(exposure.currencyShare)}`);
    }
    lines.push(`• профиль: ${parts.join(', ')}`);
  }
  if (sectorProfile) {
    lines.push(
      `• чувствительность: ${sensitivityWord(sectorProfile.currency, 'курс')}, ` +
        `${sensitivityWord(sectorProfile.rate, 'ставка')}`,
    );
    if (sectorProfile.drivers.length > 0) {
      lines.push(`• драйверы сектора: ${sectorProfile.drivers.join(', ')}`);
    }
  }
  return lines;
};

/** Разбор по бумагам: сектор, доля, график, движение цены, аналитики, дивиденды, новости. */
export const createSecuritiesProvider = (profiles: CompanyProfiles): FactProvider => ({
  id: 'securities.detail',
  section(ctx: FactContext): SectionFacts | undefined {
    const securities = securitiesOf(ctx);
    if (securities.length === 0) {
      return { missing: noHoldingsReason(ctx) };
    }

    // Одна и та же новость может относиться к нескольким бумагам (например,
    // «выросли VK, М.Видео и Самолет»): показываем её только в первой карточке.
    const shownNews = new Set<string>();

    const blocks = securities.map((security) => {
      // В разборе бумаги позиции может не быть: тогда не показываем ни долю, ни стоимость.
      const scopeLine = security.inPortfolio
        ? `${security.ticker} — ${security.sector}, ${formatPercent(security.share)} портфеля`
        : `${security.ticker} — ${security.sector}`;
      const lines = [
        `**${scopeLine}**`,
        ...(security.value === undefined
          ? []
          : [`• стоимость: ${formatNumber(security.value)} ${security.currency}`]),
        `• цена за 1 шт.: ${security.price === undefined ? UNAVAILABLE : formatNumber(security.price)} ${security.currency}`,
      ];

      if (security.periods.length > 0) {
        const longest = security.periods.at(-1) as PeriodChange;
        lines.push(
          `• цена: ${periodsLine(security.periods)} — ${trendWord(longest.change)} за ${longest.label}`,
        );
      } else {
        lines.push('• цена: истории меньше периода, движение посчитать нельзя');
      }

      if (security.chart) {
        const range = security.range;
        lines.push(
          `• график (${CHART_DAYS} дней): ${security.chart}` +
            (range
              ? ` (${formatNumber(range.min)} — ${formatNumber(range.max)} ${security.currency})`
              : ''),
        );
      }

      const forecast = security.forecast;
      if (forecast) {
        const parts = [
          RECOMMENDATIONS[forecast.recommendation ?? ''] ?? 'мнение без рекомендации',
          forecast.consensus !== undefined ? `цель ${formatNumber(forecast.consensus)}` : undefined,
          forecast.upside !== undefined
            ? `потенциал ${formatChangePct(forecast.upside)}`
            : undefined,
        ].filter((part): part is string => part !== undefined);
        lines.push(`• аналитики: ${parts.join(', ')}`);
      } else {
        lines.push('• аналитики: прогноза нет');
      }

      lines.push(dividendLine(security.dividend));
      if (security.bond) {
        lines.push(bondLine(security.bond));
      }
      const commodity = commodityLine(ctx, security.ticker);
      if (commodity) {
        lines.push(commodity);
      }
      lines.push(...profileLines(profiles, security));
      const freshNews = security.news.filter((headline) => {
        const key = headlineKey(headline);
        if (shownNews.has(key)) {
          return false;
        }
        shownNews.add(key);
        return true;
      });
      lines.push(
        freshNews.length > 0
          ? `• новости бумаги: ${freshNews.join('; ')}`
          : security.news.length > 0
            ? '• новости бумаги: общие с другими бумагами портфеля (см. выше)'
            : `• новости бумаги: ${security.newsNote ?? 'публикаций по тикеру нет'}`,
      );

      return lines.join('\n');
    });

    return {
      markdown: blocks.join('\n\n'),
      structured: securities,
      brief: securities
        .slice(0, 8)
        .map((security) =>
          security.inPortfolio
            ? `${security.ticker}: ${security.sector}, ${formatPercent(security.share)}`
            : `${security.ticker}: ${security.sector}`,
        )
        .join('; '),
    };
  },
});

/** Провайдер без профилей: используется в тестах и там, где файл не передан. */
export const securitiesProvider = createSecuritiesProvider(EMPTY_PROFILES);
