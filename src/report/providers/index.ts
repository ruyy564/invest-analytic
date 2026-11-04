import type { FactProvider } from '../engine.js';
import {
  concentrationProvider,
  gapsProvider,
  snapshotProvider,
  structureProvider,
} from './portfolio.js';
import {
  analyticsProvider,
  briefProvider,
  dynamicsProvider,
  macroProvider,
  newsProvider,
  taxProvider,
} from './market.js';

/** Реестр поставщиков фактов: имена совпадают с `provider` в шаблоне отчёта. */
export const createProviderMap = (): Map<string, FactProvider> =>
  new Map(
    [
      snapshotProvider,
      structureProvider,
      concentrationProvider,
      gapsProvider,
      dynamicsProvider,
      analyticsProvider,
      newsProvider,
      taxProvider,
      macroProvider,
      briefProvider,
    ].map((provider) => [provider.id, provider] as const),
  );

export {
  snapshotProvider,
  structureProvider,
  concentrationProvider,
  gapsProvider,
  dynamicsProvider,
  analyticsProvider,
  newsProvider,
  taxProvider,
  macroProvider,
  briefProvider,
};
