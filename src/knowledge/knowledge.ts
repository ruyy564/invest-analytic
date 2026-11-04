import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { z } from 'zod';
import { parseYaml } from '../report/yaml.js';

/**
 * База знаний по инвестициям: каталог файлов-тем (`data/knowledge/*.yaml`) и отбор
 * под контекст. Тексты — принципы, а не факты рынка: числа в разборах берутся только
 * из собранных данных, а знания объясняют, как их трактовать.
 */

/** Подраздел темы: свой заголовок и тезисы (фазы цикла, разбор по кризисам и т.п.). */
export const KnowledgeSectionSchema = z.object({
  title: z.string().trim().min(1),
  points: z.array(z.string()).default([]),
});

export type KnowledgeSection = z.infer<typeof KnowledgeSectionSchema>;

/** Тема базы: определение, тезисы, подразделы, ошибки, теги отбора и источники. */
export const KnowledgeTopicSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  points: z.array(z.string()).default([]),
  /** Подробности: подразделы с тезисами (в промпт не идут, нужны справочному ответу). */
  details: z.array(KnowledgeSectionSchema).default([]),
  /** Частые ошибки: чего не делать, применяя тему. */
  pitfalls: z.array(z.string()).default([]),
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

/** Читаем источники один раз: база меняется правкой файлов, а не в рантайме. */
const cache = new Map<string, KnowledgeBase>();

/** Сброс кэша: нужен тестам и перечитыванию после правки файлов. */
export const resetKnowledgeCache = (): void => {
  cache.clear();
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Файлы-темы: каталог разворачивается в список YAML, файл остаётся файлом. */
export const knowledgeFiles = (source: string): string[] => {
  try {
    if (!statSync(source).isDirectory()) {
      return [source];
    }
    return readdirSync(source)
      .filter((name) => ['.yaml', '.yml'].includes(extname(name).toLowerCase()))
      .sort()
      .map((name) => join(source, name));
  } catch (error) {
    // Каталога нет — это не ошибка: база знаний необязательна.
    console.warn(`[knowledge] источник знаний недоступен (${source}): ${reasonOf(error)}`);
    return [];
  }
};

/**
 * Загрузка базы знаний из файла, каталога или списка источников. Битый файл не
 * ломает остальные: тема пропускается с предупреждением, разбор идёт без неё.
 */
export const loadKnowledgeBase = (source: string | readonly string[]): KnowledgeBase => {
  const files = (typeof source === 'string' ? [source] : [...source]).flatMap(knowledgeFiles);
  if (files.length === 0) {
    return EMPTY_KNOWLEDGE;
  }

  const key = files.join('|');
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const topics: KnowledgeTopic[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = parseYaml(readFileSync(file, 'utf8'));
    } catch (error) {
      console.warn(`[knowledge] файл темы пропущен (${file}): ${reasonOf(error)}`);
      continue;
    }

    const result = KnowledgeBaseSchema.safeParse(parsed ?? {});
    if (!result.success) {
      const issues = result.error.issues.map((issue) => issue.message).join('; ');
      console.warn(`[knowledge] файл темы пропущен (${file}): ${issues}`);
      continue;
    }

    for (const topic of result.data.topics) {
      if (seen.has(topic.id)) {
        console.warn(`[knowledge] тема ${topic.id} уже загружена, файл ${file} пропущен`);
        continue;
      }
      seen.add(topic.id);
      topics.push(topic);
    }
  }

  const base: KnowledgeBase = { version: 1, topics };
  cache.set(key, base);
  return base;
};

/** Источники знаний из настроек: каталог тем и необязательный дополнительный файл. */
export const knowledgeSources = (run: {
  knowledgeDir: string;
  knowledgeFile?: string;
}): string[] => [run.knowledgeDir, ...(run.knowledgeFile ? [run.knowledgeFile] : [])];

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
  sources: string | readonly string[],
  maxChars: number,
): { enabled: boolean; text?: string } => {
  if (!enabled) {
    return { enabled: false };
  }
  const base = loadKnowledgeBase(sources);
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

