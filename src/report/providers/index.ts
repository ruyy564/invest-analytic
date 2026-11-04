import type { FactProvider } from '../engine.js';
import {
  concentrationProvider,
  gapsProvider,
  structureProvider,
  tableProvider,
} from './portfolio.js';
import { macroProvider, taxProvider } from './market.js';
import { opinionsProvider, securitiesProvider } from './securities.js';
import { briefProvider } from './verdict.js';

/** Реестр поставщиков фактов: имена совпадают с `provider` в шаблоне отчёта. */
export const createProviderMap = (): Map<string, FactProvider> =>
  new Map(
    [
      tableProvider,
      structureProvider,
      concentrationProvider,
      gapsProvider,
      securitiesProvider,
      opinionsProvider,
      macroProvider,
      taxProvider,
      briefProvider,
    ].map((provider) => [provider.id, provider] as const),
  );

export {
  tableProvider,
  structureProvider,
  concentrationProvider,
  gapsProvider,
  securitiesProvider,
  opinionsProvider,
  macroProvider,
  taxProvider,
  briefProvider,
};
