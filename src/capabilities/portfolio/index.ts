/**
 * Возможность «портфель»: снимок по счетам, налоговый дозор и выбор счёта по
 * умолчанию. Публичный вход для агента и других возможностей.
 */
export * from './resolve-account.js';
export {
  collectAllAccounts,
  openAccounts,
  type AccountRef,
  type SnapshotDeps,
} from './tools/portfolio-snapshot/portfolio-snapshot.service.js';
export { createAllAccountsTool } from './tools/portfolio-snapshot/portfolio-snapshot.tool.js';
export {
  DEFAULT_TAX_KEYWORDS,
  TAX_MAX_ACCOUNTS,
  TAX_WATCH_TOOL,
  collectTaxFacts,
  formatTaxFacts,
  matchesKeywords,
  openAccountIds,
  sumTaxOperations,
  type TaxFacts,
  type TaxWatchDeps,
  type TaxWithholding,
} from './tools/tax-watch/tax-watch.service.js';
export { createTaxWatchTool, type TaxWatchToolOptions } from './tools/tax-watch/tax-watch.tool.js';
