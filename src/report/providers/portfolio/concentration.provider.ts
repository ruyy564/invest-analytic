import { UNAVAILABLE } from '../../../report/portfolio-report.js';
import type { FactContext, FactProvider, SectionFacts } from '../../engine.js';
import { formatPercent, renderKpi } from '../../renderers.js';
import { portfolioTotalOf, totalValue, valuedHoldings } from './holdings.js';

export interface ConcentrationFacts {
  total: number;
  top?: string;
  topShare: number;
  topThree: number;
  issuers: number;
  level: string;
}

/** Концентрация портфеля по порогам шаблона. */
export const concentrationOf = (ctx: FactContext): ConcentrationFacts | undefined => {
  const holdings = valuedHoldings(ctx);
  const total = portfolioTotalOf(ctx) ?? totalValue(holdings);
  if (total <= 0) {
    return undefined;
  }

  const topShare = (holdings[0]?.value?.amount ?? 0) / total;
  const topThree =
    holdings.slice(0, 3).reduce((sum, holding) => sum + (holding.value?.amount ?? 0), 0) / total;
  const { concentrationHigh, concentrationMedium } = ctx.template.thresholds;
  const level =
    topShare >= concentrationHigh
      ? 'высокая'
      : topShare >= concentrationMedium
        ? 'умеренная'
        : 'низкая';

  return {
    total,
    top: holdings[0]?.ticker,
    topShare,
    topThree,
    issuers: holdings.length,
    level,
  };
};

export const concentrationProvider: FactProvider = {
  id: 'portfolio.concentration',
  section(ctx: FactContext): SectionFacts | undefined {
    const facts = concentrationOf(ctx);
    if (!facts) {
      return { missing: 'нет данных о стоимости позиций' };
    }

    return {
      markdown: renderKpi([
        {
          label: 'Крупнейшая позиция',
          value: `${facts.top ?? UNAVAILABLE} — ${formatPercent(facts.topShare)}`,
        },
        { label: 'Топ-3 позиции', value: formatPercent(facts.topThree) },
        { label: 'Бумаг в портфеле', value: String(facts.issuers) },
        { label: 'Концентрация', value: facts.level },
      ]),
      structured: facts,
      brief: `Крупнейшая позиция ${formatPercent(facts.topShare)}, топ-3 ${formatPercent(facts.topThree)}, концентрация ${facts.level}`,
    };
  },
};
