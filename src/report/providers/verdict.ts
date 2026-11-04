import { formatNumber } from '../../agent/report/portfolio-report.js';
import { resultsInGroup } from '../../collection/executor.js';
import type { FactContext, FactProvider, SectionFacts } from '../engine.js';
import { formatPercent } from '../renderers.js';
import { parseForecast, RECOMMENDATIONS } from './market.js';
import { concentrationOf, gapsOf } from './portfolio.js';

/**
 * Итог по портфелю: факты для модели — диверсификация, тип стратегии и что
 * менять. Модель формулирует вывод, числа остаются за кодом.
 */
export const briefProvider: FactProvider = {
  id: 'facts.brief',
  section(ctx: FactContext): SectionFacts | undefined {
    const concentration = concentrationOf(ctx);
    const gaps = gapsOf(ctx);
    if (!concentration || !gaps) {
      return { missing: 'нет данных о составе портфеля' };
    }

    const reviews = resultsInGroup(ctx.plan, ctx.collected, 'analytics').flatMap(
      ({ entry, text }) => {
        const facts = parseForecast(text);
        if (!entry.target || !facts) {
          return [];
        }
        const upside =
          facts.upside !== undefined
            ? ` ${facts.upside > 0 ? '+' : ''}${formatNumber(facts.upside)} %`
            : '';
        return [
          `${entry.target} ${RECOMMENDATIONS[facts.recommendation ?? ''] ?? 'без рекомендации'}${upside}`,
        ];
      },
    );

    const lines = [
      `стоимость ${formatNumber(concentration.total)} RUB, бумаг ${concentration.issuers}`,
      `крупнейшая ${concentration.top ?? 'нет'} ${formatPercent(concentration.topShare)}, топ-3 ${formatPercent(concentration.topThree)}, концентрация ${concentration.level}`,
      `классы: ${gaps.structure.byClass.map((row) => `${row.name} ${formatPercent(row.share)}`).join(', ')}`,
      `секторы: ${gaps.structure.bySector
        .slice(0, 8)
        .map((row) => `${row.name} ${formatPercent(row.share)}`)
        .join(', ')}`,
      gaps.classGaps.length > 0
        ? `пробелы по классам: ${gaps.classGaps.map((row) => `${row.name} ${formatPercent(row.share)}`).join(', ')}`
        : 'пробелов по классам нет',
      reviews.length > 0 ? `мнения по бумагам: ${reviews.join('; ')}` : 'мнений аналитиков нет',
    ];

    return {
      markdown: lines.join('\n'),
      structured: { concentration, classGaps: gaps.classGaps, sectorGaps: gaps.sectorGaps, reviews },
      brief: lines.join(' | ').slice(0, 2_000),
    };
  },
};
