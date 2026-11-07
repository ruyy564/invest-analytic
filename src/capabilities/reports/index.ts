/**
 * Возможность «отчёты»: сборка текста, шаблон секций, план и исполнение сбора
 * фактов. Публичный вход для агента и других возможностей.
 */
export { buildReport, composeMarkdown, missingProviders } from './engine.js';
export type {
  BuildReportDeps,
  FactContext,
  FactProvider,
  InterpretationRequest,
  ReportBuildResult,
  SectionFacts,
  SectionOutput,
} from './engine.types.js';
export {
  DATA_SOURCE,
  DISCLAIMER,
  UNAVAILABLE,
  formatAllAccountsReport,
  formatDataAsOf,
  formatMoney,
  formatNumber,
  formatPortfolioReport,
  type AccountPortfolio,
  type AllAccountsReportOptions,
  type ReportOptions,
} from './portfolio-report.js';
export {
  loadReportTemplate,
  parseReportTemplate,
  templateProviders,
  type ReportPeriod,
  type ReportSection,
  type ReportTemplate,
  type SectionScope,
} from './template.js';
export { createProviderMap, type ProviderMapOptions } from './providers/index.js';
export { loadCompanyProfiles } from './company-profiles.js';
export {
  SECTOR_ALIASES,
  SECTOR_LABELS,
  UNKNOWN_SECTOR,
  sectorKey,
  sectorLabel,
} from './sector.js';
export {
  EXPOSURE_LABELS,
  EMPTY_PROFILES,
  companyProfileOf,
  exposureOf,
  sectorProfileOf,
  type CompanyProfile,
  type CompanyProfiles,
  type Exposure,
  type MarketFactor,
  type SectorProfile,
} from './company-profiles.js';
export * from './collection/plan.js';
export * from './collection/executor.js';
export * from './collection/reference.js';
export * from './market-facts.js';
