export {
  CanonicalItemSchema,
  parseCanonicalItem,
  type CanonicalItem,
} from './domain/canonical-item.js';
export {
  compileNewsPolicy,
  evaluateItem,
  type NewsPolicy,
  type NewsPolicyRaw,
  type PolicyContext,
  type PolicyDecision,
  type PolicyMode,
} from './domain/news-policy.js';
export { loadNewsPolicy, resetNewsPolicyCache } from './policy-loader.js';
export { summarizeStage, type StageReport } from './pipeline/stage-report.js';
export { applyPolicy } from './pipeline/policy-stage.js';
export { dedupeItems, duplicateKey } from './pipeline/dedupe-stage.js';
export * from './news.types.js';
export * from './news.filters.js';
export * from './news.aliases.js';
export * from './news.registry.js';
export * from './news.factory.js';
export * from './tools/news-digest/news-digest.service.js';
export { createNewsDigestTool, type NewsDigestToolOptions } from './tools/news-digest/news-digest.tool.js';
export { NEWS_SEARCH_TOOL, createNewsSearchTool, type NewsSearchToolOptions } from './tools/news-search.tool.js';
