import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { AppConfigService } from '../../src/config/app-config.service.js';
import {
  formatKnowledge,
  formatKnowledgeAnswer,
  formatKnowledgeMiss,
  KnowledgeModule,
  KnowledgeRepository,
  KNOWLEDGE_PREAMBLE,
  KNOWLEDGE_QUESTION_PATTERN,
  KnowledgeService,
} from '../../src/knowledge/index.js';

const BASE_DIR = 'data/knowledge';

/** Конфиг для тестов: тот же срез `run`, что читает репозиторий. */
const configFor = (run: Record<string, unknown> = {}): AppConfigService =>
  ({
    value: {
      run: {
        knowledgeEnabled: true,
        knowledgeDir: BASE_DIR,
        knowledgeFile: undefined,
        knowledgeMaxChars: 1_800,
        ...run,
      },
    },
  }) as unknown as AppConfigService;

const serviceFor = (run: Record<string, unknown> = {}): KnowledgeService =>
  new KnowledgeService(new KnowledgeRepository(configFor(run)));

/** Временный каталог тем: каждый тест со своим набором файлов. */
const tempDir = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
};

const topicFile = (id: string, extra: string[] = []): string =>
  [
    'version: 1',
    'topics:',
    `  - id: ${id}`,
    `    title: Тема ${id}`,
    `    summary: Определение темы ${id} для проверки загрузки и отбора.`,
    '    points:',
    '      - Первый тезис темы',
    '      - Второй тезис темы',
    ...extra,
  ].join('\n');

describe('модуль знаний (Nest)', () => {
  it('поднимается через DI и отдаёт сервис', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [KnowledgeModule] })
      .overrideProvider(KnowledgeRepository)
      .useValue(new KnowledgeRepository(configFor()))
      .compile();

    const knowledge = moduleRef.get(KnowledgeService);
    expect(knowledge).toBeInstanceOf(KnowledgeService);
    expect(knowledge.isEmpty).toBe(false);
  });

  it('читает каталог тем и содержит обязательные темы', () => {
    const knowledge = serviceFor();
    const ids = knowledge.topics.map((topic) => topic.id);

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
      expect(ids).toContain(id);
    }
    for (const topic of knowledge.topics) {
      expect(topic.points.length).toBeGreaterThanOrEqual(6);
      expect(topic.details.length).toBeGreaterThanOrEqual(4);
      expect(topic.pitfalls.length).toBeGreaterThanOrEqual(3);
      expect(topic.keywords.length).toBeGreaterThan(0);
    }
  });

  it('разворачивает каталог в файлы по порядку имён', () => {
    const repository = new KnowledgeRepository(configFor());
    const files = repository.files(BASE_DIR);

    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files[0].endsWith('01-cycles.yaml')).toBe(true);
    expect(files.at(-1)?.endsWith('10-sources.yaml')).toBe(true);
    expect(repository.files(files[0])).toEqual([files[0]]);
    expect(repository.files(join(tmpdir(), 'нет-такого-каталога'))).toEqual([]);
  });

  it('деградирует в пустую базу без каталога', () => {
    const knowledge = serviceFor({ knowledgeDir: join(tmpdir(), 'нет-такого-каталога') });

    expect(knowledge.isEmpty).toBe(true);
    expect(knowledge.promptBlock({ section: 'macro', maxChars: 500 })).toBeUndefined();
    expect(knowledge.topicFor('что такое P/E')).toBeUndefined();
    expect(knowledge.miss()).toContain('нет темы');
  });

  it('пропускает битый файл и дубликат темы', () => {
    const dir = tempDir({
      '01-good.yaml': topicFile('good'),
      '02-broken.yaml': 'version: 1\ntopics: строка вместо списка',
      '03-dup.yaml': topicFile('good'),
    });
    const knowledge = serviceFor({ knowledgeDir: dir });

    expect(knowledge.topics.map((topic) => topic.id)).toEqual(['good']);
  });

  it('подбирает темы по разделу, сектору и вопросу', () => {
    const knowledge = serviceFor();

    expect(knowledge.select({ section: 'macro' }).map((topic) => topic.id)).toContain('cycles');
    expect(
      knowledge.select({ section: 'opinions', sectors: ['энергетика'] }).map((topic) => topic.id),
    ).toContain('sector-dependencies');
    expect(knowledge.select({ question: 'что такое мультипликатор P/E' }).map((topic) => topic.id))
      .toContain('multiples');
    expect(knowledge.select({ section: 'unknown-section' })).toEqual([]);
  });
});

describe('представления знаний', () => {
  it('собирает блок для промпта с преамбулой и чек-листом', () => {
    const knowledge = serviceFor();
    const block = knowledge.promptBlock({ section: 'macro', maxChars: 4_000 });

    expect(block).toContain(KNOWLEDGE_PREAMBLE);
    expect(block).toContain('Чек-лист принятия решений');
    expect(knowledge.promptBlock({ section: 'opinions', maxChars: 4_000 })).not.toContain(
      'Чек-лист принятия решений',
    );
  });

  it('держит лимит объёма и не рвёт строки', () => {
    const knowledge = serviceFor();
    const block = knowledge.promptBlock({ section: 'macro', maxChars: 900 }) ?? '';

    expect(block.length).toBeLessThanOrEqual(900 + KNOWLEDGE_PREAMBLE.length + 1);
    for (const line of block.split('\n').filter((value) => value.length > 0)) {
      expect(line.trim()).toBe(line);
      expect(line.endsWith('…')).toBe(false);
    }
    // Отдельного лимита на тему: длинная тема не вытесняет остальные.
    const oneTopic = formatKnowledge(knowledge.topics.slice(0, 1), 400);
    expect(oneTopic.length).toBeLessThanOrEqual(400);
  });

  it('отвечает определением, подразделами, ошибками и источником', () => {
    const knowledge = serviceFor();
    const answer = knowledge.answerFor('что такое экономические циклы') ?? '';

    expect(answer).toContain('Экономические циклы');
    expect(answer).toContain('Фазы цикла и что происходит');
    expect(answer).toContain('Частые ошибки:');
    expect(answer).toContain('Источник:');
    expect(answer).toContain('не индивидуальная инвестиционная рекомендация');

    const topic = knowledge.topicFor('что такое диверсификация')!;
    expect(formatKnowledgeAnswer(topic)).toContain(topic.summary);
  });

  it('не выдумывает ответ, когда темы нет', () => {
    const knowledge = serviceFor();
    const answer = knowledge.answerFor('что такое квантовая физика') ?? knowledge.miss();

    expect(answer).toContain('нет темы');
    expect(answer).toContain('Экономические циклы');
    expect(formatKnowledgeMiss({ version: 1, topics: [] })).toContain('Доступные темы:');
  });

  it('различает справочный вопрос и запрос данных', () => {
    expect(KNOWLEDGE_QUESTION_PATTERN.test('что такое P/E?')).toBe(true);
    expect(KNOWLEDGE_QUESTION_PATTERN.test('объясни, что такое диверсификация')).toBe(true);
    expect(KNOWLEDGE_QUESTION_PATTERN.test('что у меня в портфеле?')).toBe(false);
  });

  it('правило интерпретации требует числа только из брифинга', async () => {
    const { readFileSync } = await import('node:fs');
    const prompt = readFileSync('reports/prompts/interpretation.md', 'utf8');

    expect(prompt).toContain('справочный контекст');
    expect(prompt).toContain('числа, ставки и даты бери исключительно из брифинга');
  });
});

