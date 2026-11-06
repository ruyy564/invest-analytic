import { formatNumber } from '../../portfolio-report.js';
import type { FactContext, FactProvider, SectionFacts } from '../../engine.js';
import { formatPercent, renderDistribution } from '../../renderers.js';
import { UNKNOWN_SECTOR } from '../../sector.js';
import { distribute, valuedHoldings, type Holding } from './holdings.js';
import { sectorMapOf } from './sectors.js';

export interface DistributionRow {
  name: string;
  amount: number;
  share: number;
}

export interface StructureFacts {
  byClass: DistributionRow[];
  bySector: DistributionRow[];
  byCurrency: DistributionRow[];
  byIssuer: DistributionRow[];
}

/** Разрезы портфеля: класс, сектор, валюта, эмитент. */
export const structureOf = (ctx: FactContext): StructureFacts | undefined => {
  const holdings = valuedHoldings(ctx);
  if (holdings.length === 0) {
    return undefined;
  }
  const sectors = sectorMapOf(ctx);
  const amount = (holding: Holding): number => holding.value?.amount ?? 0;

  return {
    byClass: distribute(holdings, (holding) => holding.className, amount),
    bySector: distribute(
      holdings,
      (holding) => sectors.get(holding.ticker) ?? UNKNOWN_SECTOR,
      amount,
    ),
    byCurrency: distribute(holdings, (holding) => holding.currency, amount),
    byIssuer: distribute(holdings, (holding) => holding.ticker, amount),
  };
};

export const structureProvider: FactProvider = {
  id: 'portfolio.structure',
  section(ctx: FactContext): SectionFacts | undefined {
    const structure = structureOf(ctx);
    if (!structure) {
      return { missing: 'нет данных о стоимости позиций' };
    }
    const { byClass, bySector, byCurrency, byIssuer } = structure;

    const block = (title: string, rows: DistributionRow[]): string =>
      [
        `${title}:`,
        renderDistribution(
          rows.slice(0, 8).map((row) => ({ ...row, amount: formatNumber(row.amount) })),
        ),
      ].join('\n');

    return {
      markdown: [
        block('Класс актива', byClass),
        block('Сектор', bySector),
        block('Валюта', byCurrency),
        block('Эмитент', byIssuer),
      ].join('\n\n'),
      structured: structure,
      brief: [
        byClass.map((row) => `${row.name} ${formatPercent(row.share)}`).join(', '),
        `секторы: ${bySector
          .slice(0, 5)
          .map((row) => `${row.name} ${formatPercent(row.share)}`)
          .join(', ')}`,
      ].join('; '),
    };
  },
};
