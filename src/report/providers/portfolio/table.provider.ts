import { formatMoney, formatNumber, UNAVAILABLE } from '../../../report/portfolio-report.js';
import { resultsInGroup } from '../../../collection/executor.js';
import type { FactContext, FactProvider, SectionFacts } from '../../engine.js';
import { formatChangePct, periodChanges, seriesByTicker } from '../../market-facts.js';
import { sparklineOf, windowOf, CHART_DAYS } from '../../sparkline.js';
import { formatPercent, renderTable } from '../../renderers.js';
import { UNKNOWN_SECTOR } from '../../sector.js';
import { parseForecast, RECOMMENDATIONS } from '../market.js';
import { portfolioTotalOf, portfolioYieldOf, totalValue, valuedHoldings } from './holdings.js';
import { sectorMapOf } from './sectors.js';

/**
 * Главная таблица отчёта: бумага, сектор, доля в портфеле, стоимость,
 * изменение за 180 дней и мнение аналитиков. Сектор и рост — то, с чего
 * начинается разбор каждой бумаги.
 */
export const tableProvider: FactProvider = {
  id: 'portfolio.table',
  section(ctx: FactContext): SectionFacts | undefined {
    const allHoldings = valuedHoldings(ctx);
    // В разборе бумаги таблица показывает только её, но итог — по всему портфелю.
    const scopedTarget = ctx.scope === 'instrument' ? ctx.scopeTarget?.toUpperCase() : undefined;
    const holdings = scopedTarget
      ? allHoldings.filter((holding) => holding.ticker.toUpperCase() === scopedTarget)
      : allHoldings;
    if (holdings.length === 0) {
      return {
        missing: scopedTarget
          ? `бумаги ${scopedTarget} нет в портфеле`
          : ctx.scope === 'account'
            ? 'на счёте нет бумаг или состав счёта недоступен'
            : 'в портфеле нет позиций или состав недоступен',
      };
    }

    const holdingsTotal = totalValue(allHoldings);
    // В разборе одной бумаги итог — её стоимость: сумма портфеля тут не при чём.
    const scopeTotal = scopedTarget ? totalValue(holdings) : holdingsTotal;
    // Долю считаем от стоимости всего портфеля: в разборе одной бумаги в выборке
    // остаётся одна позиция, и «100 %» было бы неправдой.
    const shareBase = portfolioTotalOf(ctx) ?? holdingsTotal;
    const sectors = sectorMapOf(ctx);
    const series = seriesByTicker(
      resultsInGroup(ctx.plan, ctx.collected, 'candles').map(({ entry, text }) => ({
        target: entry.target,
        text,
      })),
    );
    const forecasts = new Map(
      resultsInGroup(ctx.plan, ctx.collected, 'analytics').flatMap(({ entry, text }) => {
        const facts = parseForecast(text);
        return entry.target && facts ? [[entry.target, facts] as const] : [];
      }),
    );

    const rows = holdings.map((holding) => {
      const share = shareBase > 0 ? (holding.value?.amount ?? 0) / shareBase : 0;
      const priceSeries = series.get(holding.ticker);
      const change = priceSeries ? periodChanges(priceSeries, ['180d'], ctx.now)[0] : undefined;
      const forecast = forecasts.get(holding.ticker);
      return [
        holding.ticker,
        sectors.get(holding.ticker) ?? UNKNOWN_SECTOR,
        formatPercent(share),
        holding.price ? formatMoney(holding.price) : UNAVAILABLE,
        holding.value ? formatMoney(holding.value) : UNAVAILABLE,
        sparklineOf(windowOf(priceSeries, CHART_DAYS, ctx.now), 12) || UNAVAILABLE,
        change ? formatChangePct(change.changePct) : UNAVAILABLE,
        forecast?.upside === undefined
          ? (RECOMMENDATIONS[forecast?.recommendation ?? ''] ?? UNAVAILABLE)
          : `${RECOMMENDATIONS[forecast.recommendation ?? ''] ?? 'мнение'} ${formatChangePct(forecast.upside)}`,
      ];
    });

    const yieldFacts = portfolioYieldOf(ctx);
    const yieldLine =
      yieldFacts && !scopedTarget && (yieldFacts.pct !== undefined || yieldFacts.dailyPct !== undefined)
        ? `Доходность портфеля: ${
            yieldFacts.pct !== undefined ? formatChangePct(yieldFacts.pct) : UNAVAILABLE
          }` +
          (yieldFacts.amount !== undefined
            ? ` (${formatNumber(yieldFacts.amount)} ${yieldFacts.currency})`
            : '') +
          (yieldFacts.dailyPct !== undefined
            ? `, за день ${formatChangePct(yieldFacts.dailyPct)}`
            : '')
        : undefined;

    return {
      markdown: [
        renderTable(
          ['Тикер', 'Сектор', 'Доля', 'Цена', 'Стоимость', 'График', '180 дней', 'Аналитики'],
          rows,
        ),
        `${scopedTarget ? 'Итого по бумаге' : 'Итого по текущим ценам'}: ` +
          `${formatNumber(scopeTotal)} ${holdings[0]?.currency ?? 'RUB'}`,
        ...(yieldLine ? [yieldLine] : []),
      ].join('\n'),
      structured: {
        total: scopeTotal,
        currency: holdings[0]?.currency,
        rows: holdings.map((holding, index) => ({ ticker: holding.ticker, cells: rows[index] })),
      },
      brief: holdings
        .slice(0, 10)
        .map(
          (holding) =>
            `${holding.ticker} (${sectors.get(holding.ticker) ?? UNKNOWN_SECTOR}, ` +
            `${formatPercent(shareBase > 0 ? (holding.value?.amount ?? 0) / shareBase : 0)})`,
        )
        .join(', '),
    };
  },
};
