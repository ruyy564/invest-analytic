import type { FactProvider } from '../engine.js';
import { EMPTY_PROFILES, type CompanyProfiles } from '../company-profiles.js';
import type { KnowledgeProvider } from '../../knowledge/index.js';
import {
  concentrationProvider,
  createExposureProvider,
  gapsProvider,
  structureProvider,
  tableProvider,
} from './portfolio/index.js';
import { macroProvider, taxProvider } from './market.js';
import {
  createSecuritiesProvider,
  opinionsProvider,
  securitiesProvider,
} from './securities/index.js';
import { briefProvider } from './verdict.js';
import { createKnowledgeSectionProvider } from './knowledge.provider.js';
import { marketNewsProvider } from './market-news.provider.js';
import { createConclusionProvider } from './securities/conclusion.provider.js';

/** Настройки реестра: профили компаний и база знаний для справочного блока. */
export interface ProviderMapOptions {
  profiles?: CompanyProfiles;
  /** База знаний: её темы показываются отдельной секцией отчёта. */
  knowledge?: KnowledgeProvider;
}

/** Реестр поставщиков фактов: имена совпадают с `provider` в шаблоне отчёта. */
export const createProviderMap = (
  options: ProviderMapOptions = {},
): Map<string, FactProvider> => {
  const profiles = options.profiles ?? EMPTY_PROFILES;
  return new Map(
    [
      tableProvider,
      structureProvider,
      concentrationProvider,
      gapsProvider,
      createExposureProvider(profiles),
      createSecuritiesProvider(profiles),
      // Вывод по бумаге: брифинг со всеми фактами о ней и её секторе.
      createConclusionProvider(profiles),
      opinionsProvider,
      macroProvider,
      // Фон рынка: общая сводка новостей, собранная веткой новостей.
      marketNewsProvider,
      taxProvider,
      // Справочный блок: темы базы знаний под секторы портфеля или под бумагу.
      createKnowledgeSectionProvider(options.knowledge),
      briefProvider,
    ].map((provider) => [provider.id, provider] as const),
  );
};

export {
  tableProvider,
  structureProvider,
  concentrationProvider,
  gapsProvider,
  createExposureProvider,
  securitiesProvider,
  createSecuritiesProvider,
  opinionsProvider,
  macroProvider,
  marketNewsProvider,
  taxProvider,
  briefProvider,
};
