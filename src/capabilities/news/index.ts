export {
  CanonicalItemSchema,
  parseCanonicalItem,
  type CanonicalItem,
} from './domain/canonical-item.js';
export {
  compileNewsPolicy,
  evaluateItem,
  loadNewsPolicy,
  resetNewsPolicyCache,
  type NewsPolicy,
  type NewsPolicyRaw,
  type PolicyContext,
  type PolicyDecision,
  type PolicyMode,
} from './domain/news-policy.js';
export { summarizeStage, type StageReport } from './pipeline/stage-report.js';
export { applyPolicy } from './pipeline/policy-stage.js';
export { dedupeItems, duplicateKey } from './pipeline/dedupe-stage.js';
