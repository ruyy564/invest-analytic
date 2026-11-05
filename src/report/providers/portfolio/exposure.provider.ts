import type { FactContext, FactProvider, SectionFacts } from '../../engine.js';
import {
  EXPOSURE_LABELS,
  exposureOf,
  sectorProfileOf,
  type CompanyProfiles,
  type Exposure,
} from '../../company-profiles.js';
import { formatPercent } from '../../renderers.js';
import { UNKNOWN_SECTOR } from '../../sector.js';
import { totalValue, valuedHoldings } from './holdings.js';
import { sectorMapOf } from './sectors.js';

const EMPTY_REASON = 'нет данных о составе портфеля';

/**
 * Внешнеэкономический профиль портфеля: какая доля приходится на экспортёров,
 * внутренний рынок и импортёров и как на них влияют курс и ставка.
 */
export const createExposureProvider = (profiles: CompanyProfiles): FactProvider => ({
  id: 'portfolio.exposure',
  section(ctx: FactContext): SectionFacts | undefined {
    const holdings = valuedHoldings(ctx);
    if (holdings.length === 0) {
      return { missing: EMPTY_REASON };
    }
    const sectors = sectorMapOf(ctx);
    const total = totalValue(holdings);
    const sums = new Map<Exposure, number>();
    // Взвешенные чувствительности: доля портфеля, которой фактор помогает или мешает.
    let currencyPositive = 0;
    let currencyNegative = 0;
    let ratePositive = 0;
    let rateNegative = 0;
    let currencyShareWeighted = 0;
    let currencyShareBase = 0;
    const unknown: string[] = [];

    for (const holding of holdings) {
      const amount = holding.value?.amount ?? 0;
      if (amount <= 0) {
        continue;
      }
      const sector = sectors.get(holding.ticker) ?? UNKNOWN_SECTOR;
      const exposure = exposureOf(profiles, holding.ticker, sector);
      if (!exposure) {
        unknown.push(holding.ticker);
        continue;
      }
      sums.set(exposure.exposure, (sums.get(exposure.exposure) ?? 0) + amount);
      if (exposure.currencyShare !== undefined) {
        currencyShareWeighted += amount * exposure.currencyShare;
        currencyShareBase += amount;
      }
      const sectorProfile = sectorProfileOf(profiles, sector);
      if (sectorProfile?.currency === 'positive') {
        currencyPositive += amount;
      }
      if (sectorProfile?.currency === 'negative') {
        currencyNegative += amount;
      }
      // Сектор не определён: чувствительность к курсу оцениваем по профилю бумаги.
      if (!sectorProfile && exposure.exposure === 'export') {
        currencyPositive += amount;
      }
      if (!sectorProfile && exposure.exposure === 'import') {
        currencyNegative += amount;
      }
      if (sectorProfile?.rate === 'positive') {
        ratePositive += amount;
      }
      if (sectorProfile?.rate === 'negative') {
        rateNegative += amount;
      }
    }

    if (sums.size === 0) {
      return {
        missing: 'профили компаний не заданы: добавьте тикеры в data/company-profiles.yaml',
      };
    }

    const shareOf = (amount: number): number => (total > 0 ? amount / total : 0);
    const byExposure = (['export', 'domestic', 'import', 'mixed'] as const)
      .filter((exposure) => (sums.get(exposure) ?? 0) > 0)
      .map((exposure) => ({
        exposure,
        label: EXPOSURE_LABELS[exposure],
        share: shareOf(sums.get(exposure) ?? 0),
      }));

    const currencyShare = currencyShareBase > 0 ? currencyShareWeighted / currencyShareBase : undefined;
    const lines = [
      ...byExposure.map((item) => `• ${item.label}: ${formatPercent(item.share)}`),
    ];
    if (currencyShare !== undefined) {
      lines.push(`• валютная выручка: около ${formatPercent(currencyShare)} портфеля (оценка)`);
    }
    if (currencyPositive > 0 || currencyNegative > 0) {
      lines.push(
        `• курс рубля: ослабление поддерживает ${formatPercent(shareOf(currencyPositive))}, ` +
          `усиливает издержки у ${formatPercent(shareOf(currencyNegative))}`,
      );
    }
    if (ratePositive > 0 || rateNegative > 0) {
      lines.push(
        `• ставка: рост поддерживает ${formatPercent(shareOf(ratePositive))}, ` +
          `давит на ${formatPercent(shareOf(rateNegative))}`,
      );
    }
    if (unknown.length > 0) {
      lines.push(`• профиль не определён: ${unknown.slice(0, 8).join(', ')}`);
    }

    return {
      markdown: lines.join('\n'),
      structured: {
        byExposure,
        currencyShare,
        currency: { positive: shareOf(currencyPositive), negative: shareOf(currencyNegative) },
        rate: { positive: shareOf(ratePositive), negative: shareOf(rateNegative) },
        unknown,
      },
      brief: byExposure
        .map((item) => `${item.label} ${formatPercent(item.share)}`)
        .concat(currencyShare !== undefined ? [`валютная выручка ~${formatPercent(currencyShare)}`] : [])
        .join(', '),
    };
  },
});
