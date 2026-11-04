import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { parseYaml } from '../report/yaml.js';

/**
 * База знаний по инвестициям: данные (`data/investment-knowledge.yaml`) и их отбор
 * под контекст. Тексты — принципы, а не факты рынка: числа в разборах берутся только
 * из собранных данных, а знания объясняют, как их трактовать.
 */

/** Тема базы: определение, тезисы, теги отбора и источники. */
export const KnowledgeTopicSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  points: z.array(z.string()).default([]),
  /** Разделы отчёта, для которых тема полезна (`macro`, `opinions`, `verdict`). */
  sections: z.array(z.string()).default([]),
  /** Секторы портфеля в тех же названиях, что отдаёт брокер («энергетика»). */
  sectors: z.array(z.string()).default([]),
  /** Термины вопроса: «мультипликатор», «диверсификация», «кризис». */
  keywords: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
});

export type KnowledgeTopic = z.infer<typeof KnowledgeTopicSchema>;

export const KnowledgeBaseSchema = z.object({
  version: z.number().int().positive().default(1),
  topics: z.array(KnowledgeTopicSchema).default([]),
});

export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;

export const EMPTY_KNOWLEDGE: KnowledgeBase = { version: 1, topics: [] };

/** Читаем файл один раз на путь: база меняется правкой файла, а не в рантайме. */
const cache = new Map<string, KnowledgeBase>();

/** Сброс кэша: нужен тестам и перечитыванию после правки файла. */
export const resetKnowledgeCache = (): void => {
  cache.clear();
};

const fail = (path: string, reason: string): KnowledgeBase => {
  console.warn(`[knowledge] база знаний недоступна (${path}): ${reason}`);
  return EMPTY_KNOWLEDGE;
};

/**
 * Загрузка базы знаний. Отсутствие файла, нечитаемый YAML или несоответствие схеме
 * не ломают прогон: возвращаем пустую базу, поведение остаётся прежним.
 */
export const loadKnowledgeBase = (path: string): KnowledgeBase => {
  const cached = cache.get(path);
  if (cached) {
    return cached;
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    // Файла нет — это не ошибка: база знаний необязательна.
    const reason = error instanceof Error ? error.message : String(error);
    const empty = fail(path, reason);
    cache.set(path, empty);
    return empty;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const empty = fail(path, reason);
    cache.set(path, empty);
    return empty;
  }

  const result = KnowledgeBaseSchema.safeParse(parsed ?? {});
  if (!result.success) {
    const empty = fail(path, result.error.issues.map((issue) => issue.message).join('; '));
    cache.set(path, empty);
    return empty;
  }

  cache.set(path, result.data);
  return result.data;
};

export interface KnowledgeQuery {
  /** Раздел отчёта: `macro`, `opinions`, `verdict`. */
  section?: string;
  /** Секторы портфеля в названиях брокера. */
  sectors?: readonly string[];
  /** Вопрос пользователя: совпадение по ключевым словам и заголовку. */
  question?: string;
  /** Темы, которые попадают в блок всегда (например, чек-лист решений). */
  required?: readonly string[];
  /** Сколько тем максимум вернуть. */
  limit?: number;
}

const normalize = (value: string): string => value.toLowerCase().replace(/ё/g, 'е').trim();

/** Тема относится к сектору портфеля. */
const inSectors = (topic: KnowledgeTopic, sectors: readonly string[]): boolean =>
  topic.sectors.some((value) =>
    sectors.some((sector) => normalize(sector) === normalize(value)),
  );

/** Тема упоминает термин: ключевое слово или заголовок. */
const mentions = (topic: KnowledgeTopic, question: string): boolean => {
  const text = normalize(question);
  return [topic.title, ...topic.keywords].some((term) => {
    const normalized = normalize(term);
    return normalized.length > 2 && text.includes(normalized);
  });
};

/** Вес раздела по его позиции: первый раздел темы важнее третьего. */
const sectionWeight = (topic: KnowledgeTopic, section: string): number => {
  const index = topic.sections.findIndex((value) => normalize(value) === normalize(section));
  return index < 0 ? 0 : 4 - Math.min(index, 3);
};

/** Сколько тем отдаём по умолчанию: больше в промпт не помещается. */
export const DEFAULT_KNOWLEDGE_LIMIT = 3;

/** Предел объёма справочного блока по умолчанию: факты брифинга важнее. */
export const DEFAULT_KNOWLEDGE_MAX_CHARS = 1_800;

/** Сколько тезисов темы попадает в блок: длинные темы не вытесняют остальные. */
export const KNOWLEDGE_POINTS_PER_TOPIC = 5;

/**
 * Отбор тем под контекст: раздел отчёта (вес по позиции), секторы портфеля (+2),
 * ключевое слово вопроса (+1). Сортировка по весу, при равенстве — порядок файла.
 */
export const selectKnowledge = (
  base: KnowledgeBase,
  query: KnowledgeQuery = {},
): KnowledgeTopic[] => {
  const scored = base.topics
    .map((topic, index) => {
      let score = query.section ? sectionWeight(topic, query.section) : 0;
      if (query.sectors && query.sectors.length > 0 && inSectors(topic, query.sectors)) {
        // Про бумаги сектор важнее прочих признаков, для итога — лишь чуть весомее.
        score += query.section === 'opinions' ? 2 : 1;
      }
      if (query.question && mentions(topic, query.question)) {
        score += 1;
      }
      return { topic, index, score };
    })
    .filter((entry) => entry.score > 0)
    // Стабильная сортировка: вес важнее порядка, порядок файла сохраняется.
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


/** Преамбула блока: знания — трактовка, факты — из брифинга. */
export const KNOWLEDGE_PREAMBLE = [
  'Справочный контекст (принципы, не данные рынка):',
  'используй его только для трактовки фактов брифинга; числа, ставки, цены и даты бери',
  'исключительно из брифинга; выводы, основанные на принципах, а не на данных, помечай (оценка).',
].join(' ');

/** Разделы, где чек-лист решений обязателен вместе с тематическим блоком. */
const CHECKLIST_SECTIONS = new Set(['macro', 'verdict']);

/** Готовый блок для промпта: преамбула + отобранные темы. */
export const knowledgeForPrompt = (
  base: KnowledgeBase,
  query: KnowledgeQuery & { maxChars: number },
): string | undefined => {
  const topics = selectKnowledge(base, {
    ...query,
    required:
      query.required ?? (query.section && CHECKLIST_SECTIONS.has(query.section) ? ['decision-checklist'] : undefined),
  });
  const body = formatKnowledge(topics, query.maxChars);
  return body.length > 0 ? `${KNOWLEDGE_PREAMBLE}\n${body}` : undefined;
};

/** Вопрос о понятии: просит объяснить термин, а не показать данные. */
export const KNOWLEDGE_QUESTION_PATTERN =
  /что такое|что значит|что означает|объясни|расскажи (про|о|об)|как работает|как устроен|как влия(ет|ют)|что почитать|что читать/i;

/** Тема вопроса: совпадение по ключевым словам и заголовку, максимум совпадений. */
export const topicForQuestion = (
  base: KnowledgeBase,
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

/** Ответ на справочный вопрос: определение, тезисы и источник. */
export const formatKnowledgeAnswer = (topic: KnowledgeTopic): string => {
  const lines = [`${topic.title}. ${topic.summary}`, ''];

  if (topic.points.length > 0) {
    lines.push(...topic.points.slice(0, 6).map((point) => `• ${point}`), '');
  }
  if (topic.sources.length > 0) {
    lines.push(`Источник: ${topic.sources.join('; ')}.`, '');
  }

  lines.push(
    'Это справочная информация, а не индивидуальная инвестиционная рекомендация: применимость к вашему портфелю зависит от цели, горизонта и допустимого риска.',
  );
  return lines.join('\n');
};

/** Блок знаний для системного промпта агента: только чек-лист принятия решений. */
export const agentKnowledgePrompt = (
  base: KnowledgeBase,
  maxChars: number,
): string | undefined =>
  knowledgeForPrompt(base, {
    section: 'verdict',
    required: ['decision-checklist'],
    limit: 1,
    maxChars,
  });

/** Активна ли ветка справочных ответов: флаг и непустая база. */
export const knowledgeBranchEnabled = (enabled: boolean, base: KnowledgeBase): boolean =>
  enabled && base.topics.length > 0;

/** Знания для системного промпта агента по настройкам: чек-лист или ничего. */
export const loadAgentKnowledge = (
  enabled: boolean,
  file: string,
  maxChars: number,
): { enabled: boolean; text?: string } => {
  if (!enabled) {
    return { enabled: false };
  }
  const base = loadKnowledgeBase(file);
  return {
    enabled: knowledgeBranchEnabled(enabled, base),
    text: agentKnowledgePrompt(base, maxChars),
  };
};

/** Ответ, когда темы нет: честный отказ и список доступных тем. */
export const formatKnowledgeMiss = (base: KnowledgeBase): string =>
  [
    'В базе знаний нет темы по этому вопросу, поэтому отвечать не буду — не хочу выдумывать.',
    `Доступные темы: ${base.topics.map((topic) => topic.title).join(', ')}.`,
    'Можно спросить, например: «что такое диверсификация?» или «что такое P/E?».',
  ].join(' ');

