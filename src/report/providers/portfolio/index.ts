/** Провайдеры секций портфеля: по файлу на секцию, общие расчёты — рядом. */
export { tableProvider } from './table.provider.js';
export { createExposureProvider } from './exposure.provider.js';
export { structureProvider, structureOf, type DistributionRow, type StructureFacts } from './structure.provider.js';
export { concentrationProvider, concentrationOf, type ConcentrationFacts } from './concentration.provider.js';
export { gapsProvider, gapsOf, type GapsFacts } from './gaps.provider.js';
export {
  aggregateHoldings,
  distribute,
  holdingsOf,
  instrumentKind,
  portfolioTotalOf,
  portfolioYieldOf,
  pricesOf,
  totalValue,
  valuedHoldings,
  type Holding,
} from './holdings.js';
export { sectorMapOf } from './sectors.js';
