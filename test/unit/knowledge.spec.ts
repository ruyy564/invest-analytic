import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_KNOWLEDGE_LIMIT,
  EMPTY_KNOWLEDGE,
  formatKnowledge,
  formatKnowledgeAnswer,
  formatKnowledgeMiss,
  KNOWLEDGE_PREAMBLE,
  KNOWLEDGE_QUESTION_PATTERN,
  knowledgeFiles,
  knowledgeForPrompt,
  loadKnowledgeBase,
  resetKnowledgeCache,
  selectKnowledge,
  topicForQuestion,
  type KnowledgeBase,
} from '../../src/knowledge/knowledge.js';

const BASE_FILE = 'data/knowledge';

const base = (): KnowledgeBase => {
  resetKnowledgeCache();
  return loadKnowledgeBase(BASE_FILE);
};

const writeTemp = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-'));
  const file = join(dir, 'knowledge.yaml');
  writeFileSync(file, content);
  return file;
};

describe('база знаний по инвестициям', () => {
  it('читает файл базы и содержит все обязательные темы', () => {
    const knowledge = base();

    for (const id of [
      'cycles',
      'macro',
      'multiples',
      'diversification',
      'psychology',
      'sector-dependencies',
      'commodities',
      'history',
      'decision-checklist',
      'sources',
    ]) {
      expect(knowledge.topics.map((topic) => topic.id)).toContain(id);
    }
    for (const topic of knowledge.topics) {
      expect(topic.title.length).toBeGreaterThan(3);
      expect(topic.summary.length).toBeGreaterThan(20);
      expect(topic.points.length).toBeGreaterThan(2);
      expect(topic.keywords.length).toBeGreaterThan(0);
    }
    // Источники — ссылки на литературу и аналитику БКС, а не текущие данные рынка.
    expect(
      knowledge.topics.some((topic) => topic.sources.some((source) => /БКС/.test(source))),
    ).toBe(true);
    expect(
      knowledge.topics.some((topic) =>
        topic.sources.some((source) => /Разумный инвестор|Дамодаран|Канеман/.test(source)),
      ),
    ).toBe(true);
  });

  it('расширяется данными без правки кода', () => {
    const knowledge = loadKnowledgeBase(
      writeTemp(
        [
          'version: 1',
          'topics:',
          '  - id: new-topic',
          '    title: Новая тема',
          '    summary: Проверяем, что тема из файла доступна отбору по разделу.',
          '    points:',
          '      - Первый тезис новой темы',
          '    sections: [verdict]',
          '    keywords: [новая тема]',
          '    sources:',
          '      - Книга',
        ].join('\n'),
      ),
    );

    expect(knowledge.topics).toHaveLength(1);
    expect(selectKnowledge(knowledge, { section: 'verdict' })[0].id).toBe('new-topic');
  });

  it('деградирует в пустую базу при отсутствии файла или ошибке схемы', () => {
    const missing = loadKnowledgeBase(join(tmpdir(), 'нет-такого-knowledge.yaml'));
    expect(missing).toEqual(EMPTY_KNOWLEDGE);
    // База не мешает прогону: блок просто не формируется.
    expect(knowledgeForPrompt(missing, { section: 'macro', maxChars: 500 })).toBeUndefined();

    const broken = loadKnowledgeBase(writeTemp('version: 1\ntopics: строка вместо списка'));
    expect(broken.topics).toEqual([]);
  });
});

describe('отбор тем под контекст', () => {
  it('подбирает темы по разделу отчёта', () => {
    const knowledge = base();

    const macro = selectKnowledge(knowledge, { section: 'macro' }).map((topic) => topic.id);
    expect(macro).toContain('cycles');
    expect(macro).toContain('macro');

    const opinions = selectKnowledge(knowledge, { section: 'opinions' }).map((topic) => topic.id);
    expect(opinions).toContain('multiples');
  });

  it('добавляет тему сектора портфеля', () => {
    const knowledge = base();

    const energy = selectKnowledge(knowledge, {
      section: 'opinions',
      sectors: ['энергетика'],
    }).map((topic) => topic.id);
    expect(energy).toContain('sector-dependencies');
    expect(energy).toContain('commodities');

    const it = selectKnowledge(knowledge, {
      sectors: ['информационные технологии'],
    }).map((topic) => topic.id);
    expect(it).toContain('sector-dependencies');
    expect(it).not.toContain('commodities');
  });

  it('не отдаёт больше лимита и не дублирует темы', () => {
    const knowledge = base();
    const picked = selectKnowledge(knowledge, {
      section: 'verdict',
      sectors: ['материалы', 'энергетика'],
    });

    expect(picked).toHaveLength(DEFAULT_KNOWLEDGE_LIMIT);
    expect(new Set(picked.map((topic) => topic.id)).size).toBe(picked.length);
  });

  it('возвращает пустой список, когда совпадений нет', () => {
    const knowledge = base();
    expect(selectKnowledge(knowledge, { section: 'unknown-section' })).toEqual([]);
    expect(selectKnowledge(EMPTY_KNOWLEDGE, { section: 'macro' })).toEqual([]);
  });

  it('использует вопрос пользователя как признак отбора', () => {
    const knowledge = base();
    const picked = selectKnowledge(knowledge, { question: 'что такое мультипликатор P/E' });
    expect(picked.map((topic) => topic.id)).toContain('multiples');
  });
});

describe('блок знаний для промпта', () => {
  it('добавляет преамбулу и держит лимит по целым строкам', () => {
    const knowledge = base();
    const block = knowledgeForPrompt(knowledge, {
      section: 'macro',
      sectors: ['энергетика'],
      maxChars: 900,
    });

    expect(block).toBeDefined();
    expect(block).toContain(KNOWLEDGE_PREAMBLE);
    expect(block?.length).toBeLessThanOrEqual(900 + KNOWLEDGE_PREAMBLE.length + 1);
    // Ни одна строка не обрезана: каждая содержит целое предложение.
    for (const line of (block ?? '').split('\n').filter((value) => value.length > 0)) {
      expect(line.trim()).toBe(line);
      expect(line.endsWith('…')).toBe(false);
    }
  });

  it('включает чек-лист в разделы про цикл и итог', () => {
    const knowledge = base();

    expect(
      knowledgeForPrompt(knowledge, { section: 'macro', maxChars: 4_000 }),
    ).toContain('Чек-лист принятия решений');
    expect(
      knowledgeForPrompt(knowledge, { section: 'verdict', maxChars: 4_000 }),
    ).toContain('Чек-лист принятия решений');
    expect(
      knowledgeForPrompt(knowledge, { section: 'opinions', maxChars: 4_000 }),
    ).not.toContain('Чек-лист принятия решений');
  });

  it('ограничивает объём, не разрывая строку', () => {
    const small = { version: 1, topics: base().topics.filter((topic) => topic.id === 'cycles') };
    const block = formatKnowledge(small.topics, 400);

    expect(block.length).toBeLessThanOrEqual(400);
    expect(block.split('\n')[0]).toContain('Экономические циклы');
  });

  it('отдаёт пустую строку, когда лимита не хватает даже на заголовок', () => {
    const knowledge = base();
    expect(formatKnowledge(knowledge.topics, 10)).toBe('');
    expect(knowledgeForPrompt(knowledge, { section: 'macro', maxChars: 0 })).toBeUndefined();
  });
});

describe('правило интерпретации отчёта', () => {
  it('требует брать числа только из брифинга, а знания — только для трактовки', async () => {
    const { readFileSync } = await import('node:fs');
    const prompt = readFileSync('reports/prompts/interpretation.md', 'utf8');

    expect(prompt).toContain('справочный контекст');
    expect(prompt).toContain('числа, ставки и даты бери исключительно из брифинга');
    expect(prompt).toContain('не переноси в текущий вывод как данные');
  });
});

describe('справочный ответ по понятию', () => {
  it('находит тему по вопросу', () => {
    const knowledge = base();

    expect(topicForQuestion(knowledge, 'что такое мультипликатор P/E')?.id).toBe('multiples');
    expect(topicForQuestion(knowledge, 'что такое диверсификация?')?.id).toBe('diversification');
    expect(topicForQuestion(knowledge, 'как влияют цены на металлы на эмитентов')?.id).toBe(
      'commodities',
    );
    expect(topicForQuestion(knowledge, 'что такое квантовая физика')).toBeUndefined();
  });

  it('отличает справочный вопрос от запроса данных', () => {
    expect(KNOWLEDGE_QUESTION_PATTERN.test('что такое P/E?')).toBe(true);
    expect(KNOWLEDGE_QUESTION_PATTERN.test('объясни, что такое диверсификация')).toBe(true);
    expect(KNOWLEDGE_QUESTION_PATTERN.test('что у меня в портфеле?')).toBe(false);
    expect(KNOWLEDGE_QUESTION_PATTERN.test('разбери бумагу SBER')).toBe(false);
  });

  it('отвечает определением, тезисами и источником', () => {
    const knowledge = base();
    const topic = topicForQuestion(knowledge, 'что такое диверсификация')!;
    const answer = formatKnowledgeAnswer(topic);

    expect(answer).toContain('Диверсификация');
    expect(answer).toContain(topic.summary);
    expect(answer).toContain(`Источник: ${topic.sources[0]}`);
    expect(answer).toContain('не индивидуальная инвестиционная рекомендация');
  });

  it('не выдумывает ответ, когда темы нет', () => {
    const knowledge = base();
    const answer = formatKnowledgeMiss(knowledge);

    expect(answer).toContain('нет темы');
    expect(answer).toContain('Экономические циклы');
  });
});


describe('каталог тем', () => {
  it('разворачивает каталог в файлы по порядку имён', () => {
    const files = knowledgeFiles('data/knowledge');

    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files[0].endsWith('01-cycles.yaml')).toBe(true);
    expect(files.at(-1)?.endsWith('10-sources.yaml')).toBe(true);
    // Один файл остаётся файлом.
    expect(knowledgeFiles(files[0])).toEqual([files[0]]);
    // Несуществующий каталог — пустой список, а не исключение.
    expect(knowledgeFiles(join(tmpdir(), 'нет-такого-каталога'))).toEqual([]);
  });

  it('читает все темы каталога и склеивает их в одну базу', () => {
    const knowledge = base();
    const ids = knowledge.topics.map((topic) => topic.id);

    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(ids.length);
    // Каждая тема содержательна: тезисы, подразделы и частые ошибки.
    for (const topic of knowledge.topics) {
      expect(topic.points.length).toBeGreaterThanOrEqual(6);
      expect(topic.details.length).toBeGreaterThanOrEqual(4);
      expect(topic.pitfalls.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('пропускает битый файл, сохраняя остальные темы', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-dir-'));
    writeFileSync(
      join(dir, '01-good.yaml'),
      ['version: 1', 'topics:', '  - id: good', '    title: Хорошая тема', '    summary: Читается без ошибок и попадает в базу.', '    points:', '      - Тезис'].join('\n'),
    );
    writeFileSync(join(dir, '02-broken.yaml'), 'version: 1\ntopics: строка вместо списка');

    const knowledge = loadKnowledgeBase(dir);

    expect(knowledge.topics.map((topic) => topic.id)).toEqual(['good']);
  });

  it('не дублирует тему с тем же id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-dup-'));
    const body = (id: string): string =>
      ['version: 1', 'topics:', `  - id: ${id}`, `    title: Тема ${id}`, '    summary: Первая версия темы побеждает при совпадении идентификатора.', '    points:', '      - Тезис'].join('\n');
    writeFileSync(join(dir, '01-first.yaml'), body('same'));
    writeFileSync(join(dir, '02-second.yaml'), body('same'));

    const knowledge = loadKnowledgeBase(dir);

    expect(knowledge.topics).toHaveLength(1);
    expect(knowledge.topics[0].title).toBe('Тема same');
  });

  it('отдаёт подразделы и ошибки в справочном ответе', () => {
    const knowledge = base();
    const topic = knowledge.topics.find((item) => item.id === 'cycles')!;
    const answer = formatKnowledgeAnswer(topic);

    expect(answer).toContain('Фазы цикла и что происходит');
    expect(answer).toContain('Индикаторы, на которые смотрят');
    expect(answer).toContain('Частые ошибки:');
    expect(answer).toContain(topic.pitfalls[0]);
  });
});

