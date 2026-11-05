import { formatNumber, UNAVAILABLE } from '../../../report/portfolio-report.js';
import type { FactContext, FactProvider, SectionFacts } from '../../engine.js';
import { formatChangePct, trendWord, type PeriodChange } from '../../market-facts.js';
import { formatPercent } from '../../renderers.js';
import { RECOMMENDATIONS } from '../market.js';
import { noHoldingsReason, periodsLine, securitiesOf } from './shared.js';

/** Разбор по бумагам: сектор, доля, движение цены, аналитики, дивиденды, новости. */
export const securitiesProvider: FactProvider = {
  id: 'securities.detail',
  section(ctx: FactContext): SectionFacts | undefined {
    const securities = securitiesOf(ctx);
    if (securities.length === 0) {
      return { missing: noHoldingsReason(ctx) };
    }

    const blocks = securities.map((security) => {
      const lines = [
        `**${security.ticker} — ${security.sector}, ${formatPercent(security.share)} портфеля**`,
        `• стоимость: ${security.value === undefined ? UNAVAILABLE : formatNumber(security.value)} RUB`,
      ];

      if (security.periods.length > 0) {
        const longest = security.periods.at(-1) as PeriodChange;
        lines.push(
          `• цена: ${periodsLine(security.periods)} — ${trendWord(longest.change)} за ${longest.label}`,
        );
      } else {
        lines.push('• цена: истории меньше периода, движение посчитать нельзя');
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

      if (security.dividends !== undefined) {
        lines.push(`• дивиденды: ${security.dividends} выплат в истории`);
      }
      lines.push(
        security.news.length > 0
          ? `• новости бумаги: ${security.news.join('; ')}`
          : `• новости бумаги: ${security.newsNote ?? 'публикаций по тикеру нет'}`,
      );

      return lines.join('\n');
    });

    return {
      markdown: blocks.join('\n\n'),
      structured: securities,
      brief: securities
        .slice(0, 8)
        .map((security) => `${security.ticker}: ${security.sector}, ${formatPercent(security.share)}`)
        .join('; '),
    };
  },
};
