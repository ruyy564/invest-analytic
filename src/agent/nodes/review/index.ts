/** Публичный API ветки разбора: по файлу на узел, общие части — рядом. */
export { templateOf, type ReviewDeps } from './deps.js';
export { instrumentsOf, matchAccount } from './instruments.js';
export { createPlanNode } from './plan.node.js';
export { collectionFromState, createCollectNode } from './collect.node.js';
export { createReportNode } from './report.node.js';
export {
  cleanSection,
  INTERPRETATION_FALLBACK,
  INTERPRETATION_TIMEOUT_MS,
  loadInterpretationPrompt,
} from './interpretation.js';
export type { ReportBuildResult } from './report.node.js';
