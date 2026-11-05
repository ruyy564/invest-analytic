import { DEFAULT_KNOWLEDGE_LIMIT } from './knowledge.constants.js';
import type { KnowledgeData, KnowledgeQuery, KnowledgeTopic } from './knowledge.types.js';

/** Отбор тем под ситуацию: чистые функции, одинаковые для отчёта, ответа и теста. */

export const normalize = (value: string): string => value.toLowerCase().replace(/ё/g, 'е').trim();

/** Тема относится к сектору портфеля. */
export const inSectors = (topic: KnowledgeTopic, sectors: readonly string[]): boolean =>
  topic.sectors.some((value) => sectors.some((sector) => normalize(sector) === normalize(value)));

/** Тема упоминает термин: ключевое слово или заголовок. */
export const mentions = (topic: KnowledgeTopic, question: string): boolean => {
  const text = normalize(question);
  return [topic.title, ...topic.keywords].some((term) => {
    const normalized = normalize(term);
    return normalized.length > 2 && text.includes(normalized);
  });
};

/** Вес раздела по его позиции: первый раздел темы важнее третьего. */
export const sectionWeight = (topic: KnowledgeTopic, section: string): number => {
  const index = topic.sections.findIndex((value) => normalize(value) === normalize(section));
  return index < 0 ? 0 : 4 - Math.min(index, 3);
};

/** Вес темы: раздел + сектор (+2 для бумаг) + термин вопроса. */
const scoreOf = (topic: KnowledgeTopic, query: KnowledgeQuery): number => {
  let score = query.section ? sectionWeight(topic, query.section) : 0;
  if (query.sectors && query.sectors.length > 0 && inSectors(topic, query.sectors)) {
    score += query.section === 'opinions' ? 2 : 1;
  }
  if (query.question && mentions(topic, query.question)) {
    score += 1;
  }
  return score;
};

/**
 * Отбор: сначала обязательные темы, затем по весу, при равенстве — порядок каталога.
 */
export const selectTopics = (
  base: KnowledgeData,
  query: KnowledgeQuery = {},
): KnowledgeTopic[] => {
  const scored = base.topics
    .map((topic, index) => ({ topic, index, score: scoreOf(topic, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const limit = query.limit ?? DEFAULT_KNOWLEDGE_LIMIT;
  const required = (query.required ?? [])
    .map((id) => base.topics.find((topic) => topic.id === id))
    .filter((topic): topic is KnowledgeTopic => topic !== undefined);
  const rest = scored
    .map((entry) => entry.topic)
    .filter((topic) => !required.some((item) => item.id === topic.id));

  return [...required, ...rest].slice(0, limit);
};

/** Тема вопроса: максимум совпадений по ключевым словам и заголовку. */
export const findTopicForQuestion = (
  base: KnowledgeData,
  question: string,
): KnowledgeTopic | undefined => {
  const text = normalize(question);
  let best: { topic: KnowledgeTopic; score: number } | undefined;

  for (const topic of base.topics) {
    const terms = [topic.title, ...topic.keywords].map(normalize).filter((term) => term.length > 2);
    const score = terms.filter((term) => text.includes(term)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { topic, score };
    }
  }

  return best?.topic;
};
