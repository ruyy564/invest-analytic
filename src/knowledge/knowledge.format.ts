import { KNOWLEDGE_POINTS_PER_TOPIC, KNOWLEDGE_PREAMBLE } from './knowledge.constants.js';
import type { KnowledgeData, KnowledgeTopic } from './knowledge.types.js';

/** Представления знаний: компактный блок для промпта и полный ответ пользователю. */

/**
 * Блок знаний с ограничением объёма. Режем по целым строкам: тема либо попадает
 * целиком, либо в усечённом виде (заголовок и столько тезисов, сколько влезает).
 * Тезисов на тему — не больше лимита: иначе одна тема вытесняет остальные.
 */
export const formatKnowledge = (
  topics: readonly KnowledgeTopic[],
  maxChars: number,
  maxPointsPerTopic = KNOWLEDGE_POINTS_PER_TOPIC,
): string => {
  if (topics.length === 0 || maxChars <= 0) {
    return '';
  }

  const lines: string[] = [];
  let length = 0;

  for (const topic of topics) {
    const topicLine = `${topic.title} — ${topic.summary}`;
    if (length + topicLine.length > maxChars) {
      break;
    }
    lines.push(topicLine);
    length += topicLine.length + 1;

    for (const point of topic.points.slice(0, maxPointsPerTopic)) {
      const line = `• ${point}`;
      if (length + line.length > maxChars) {
        return lines.join('\n');
      }
      lines.push(line);
      length += line.length + 1;
    }
  }

  return lines.join('\n');
};

/** Готовый блок для промпта: преамбула + отобранные темы. */
export const withPreamble = (body: string): string | undefined =>
  body.length > 0 ? `${KNOWLEDGE_PREAMBLE}\n${body}` : undefined;

/** Ответ на справочный вопрос: определение, тезисы, подразделы, ошибки и источник. */
export const formatKnowledgeAnswer = (topic: KnowledgeTopic): string => {
  const lines = [`${topic.title}. ${topic.summary}`, ''];

  if (topic.points.length > 0) {
    lines.push(...topic.points.slice(0, 8).map((point) => `• ${point}`), '');
  }

  // Подразделы дают глубину: фазы цикла, разбор по кризисам, блоки мультипликаторов.
  for (const section of topic.details) {
    lines.push(`**${section.title}**`);
    lines.push(...section.points.slice(0, 5).map((point) => `• ${point}`), '');
  }

  if (topic.pitfalls.length > 0) {
    lines.push('Частые ошибки:');
    lines.push(...topic.pitfalls.slice(0, 5).map((point) => `• ${point}`), '');
  }

  if (topic.sources.length > 0) {
    lines.push(`Источник: ${topic.sources.join('; ')}.`, '');
  }

  lines.push(
    'Это справочная информация, а не индивидуальная инвестиционная рекомендация: применимость к вашему портфелю зависит от цели, горизонта и допустимого риска.',
  );
  return lines.join('\n');
};

/** Ответ, когда темы нет: честный отказ и список доступных тем. */
export const formatKnowledgeMiss = (base: KnowledgeData): string =>
  [
    'В базе знаний нет темы по этому вопросу, поэтому отвечать не буду — не хочу выдумывать.',
    `Доступные темы: ${base.topics.map((topic) => topic.title).join(', ')}.`,
    'Можно спросить, например: «что такое диверсификация?» или «что такое P/E?».',
  ].join(' ');
