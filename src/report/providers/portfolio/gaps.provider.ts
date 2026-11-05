import type { FactContext, FactProvider, SectionFacts } from '../../engine.js';
import { formatPercent } from '../../renderers.js';
import { UNKNOWN_SECTOR } from '../../sector.js';
import { structureOf, type DistributionRow, type StructureFacts } from './structure.provider.js';

export interface GapsFacts {
  minShare: number;
  classGaps: { name: string; share: number }[];
  sectorGaps: DistributionRow[];
  unknownSectorShare?: number;
  structure: StructureFacts;
}

/** Пробелы структуры: классы и секторы ниже минимальной доли. */
export const gapsOf = (ctx: FactContext): GapsFacts | undefined => {
  const structure = structureOf(ctx);
  if (!structure) {
    return undefined;
  }

  const minShare = ctx.template.thresholds.minClassShare;
  const classGaps = ['акции', 'фонды', 'облигации']
    .map((name) => ({
      name,
      share: structure.byClass.find((row) => row.name === name)?.share ?? 0,
    }))
    .filter((row) => row.share < minShare);
  // Секторы ниже порога: только те, что реально есть в портфеле и известны.
  const sectorGaps = structure.bySector.filter(
    (row) => row.name !== UNKNOWN_SECTOR && row.share < minShare,
  );
  const unknownSector = structure.bySector.find((row) => row.name === UNKNOWN_SECTOR);

  return {
    minShare,
    classGaps,
    sectorGaps,
    unknownSectorShare: unknownSector?.share,
    structure,
  };
};

export const gapsProvider: FactProvider = {
  id: 'portfolio.gaps',
  section(ctx: FactContext): SectionFacts | undefined {
    const facts = gapsOf(ctx);
    if (!facts) {
      return { missing: 'нет данных о составе портфеля' };
    }

    const lines: string[] = [`Порог минимальной доли: ${formatPercent(facts.minShare)}`];
    lines.push(
      facts.classGaps.length > 0
        ? `• классы ниже порога: ${facts.classGaps.map((row) => `${row.name} ${formatPercent(row.share)}`).join(', ')}`
        : '• классы активов: явных пробелов нет',
    );
    lines.push(
      facts.sectorGaps.length > 0
        ? `• секторы ниже порога: ${facts.sectorGaps
            .map((row) => `${row.name} ${formatPercent(row.share)}`)
            .join(', ')}`
        : '• секторы: недопредставленных нет',
    );
    // Нулевая доля — не пробел: строка «не определён у 0,00 %» только шумит.
    if (facts.unknownSectorShare !== undefined && facts.unknownSectorShare >= 0.001) {
      lines.push(
        `• сектор не определён у ${formatPercent(facts.unknownSectorShare)} портфеля: справочник активов не дал сектор`,
      );
    }

    return {
      markdown: lines.join('\n'),
      structured: {
        classGaps: facts.classGaps,
        sectorGaps: facts.sectorGaps,
        minShare: facts.minShare,
        unknownSectorShare: facts.unknownSectorShare,
      },
      brief: [
        facts.classGaps.length > 0
          ? `классы ниже порога: ${facts.classGaps.map((row) => `${row.name} ${formatPercent(row.share)}`).join(', ')}`
          : 'классы в норме',
        facts.sectorGaps.length > 0
          ? `секторы ниже порога: ${facts.sectorGaps.map((row) => row.name).join(', ')}`
          : 'секторы в норме',
      ].join('; '),
    };
  },
};
