/** Публичный API модуля знаний: сервис, контракт и типы. */
export { KnowledgeModule } from './knowledge.module.js';
export { KnowledgeService } from './knowledge.service.js';
export { KnowledgeRepository } from './knowledge.repository.js';
export {
  DEFAULT_KNOWLEDGE_LIMIT,
  DEFAULT_KNOWLEDGE_MAX_CHARS,
  KNOWLEDGE_POINTS_PER_TOPIC,
  KNOWLEDGE_PREAMBLE,
  KNOWLEDGE_QUESTION_PATTERN,
} from './knowledge.constants.js';
export {
  formatKnowledge,
  formatKnowledgeAnswer,
  formatKnowledgeBlock,
  formatKnowledgeMiss,
} from './knowledge.format.js';
export { findTopicForQuestion, selectTopics } from './knowledge.select.js';
export {
  EMPTY_KNOWLEDGE,
  KnowledgeFileSchema,
  KnowledgeTopicSchema,
  type KnowledgeData,
  type KnowledgeProvider,
  type KnowledgeQuery,
  type KnowledgeTopic,
} from './knowledge.types.js';
export { createKnowledgeTool } from './tools/knowledge/knowledge.tool.js';
