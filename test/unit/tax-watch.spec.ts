import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceRegistry } from '../../src/sources/registry.js';
import type { NewsSourceAdapter, SourceItem } from '../../src/sources/types.js';
import { loadTaxKeywords } from '../../src/tools/key-rate/key-rate.tool.js';
import {
  collectTaxFacts,
  formatTaxFacts,
  matchesKeywords,
  sumTaxOperations,
  DEFAULT_TAX_KEYWORDS,
} from '../../src/tools/tax-watch/tax-watch.tool.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  id: 'id',
  title: 'Заголовок',
  publishedAt: '2026-11-04T09:00:00Z',
  tags: [],
  source: 'smartlab',
  ...overrides,
});

const OPERATIONS = {
  operations: [
    {
      operationType: 'OPERATION_TYPE_TAX',
      payment: { currency: 'rub', value: '-1234.5' },
      date: '2026-06-01T00:00:00Z',
    },
    {
      operationType: 'OPERATION_TYPE_DIVIDEND_TAX',
      payment: { currency: 'rub', value: '-345.5' },
      date: '2026-07-01T00:00:00Z',
    },
    {
      operationType: 'OPERATION_TYPE_BUY',
      payment: { currency: 'rub', value: '-10000' },
      date: '2026-05-01T00:00:00Z',
    },
  ],
};

describe('налоговое наблюдение', () => {
  it('суммирует только налоговые операции', () => {
    const withheld = sumTaxOperations(OPERATIONS, { from: '2026-01-01', to: '2026-11-04' });

    expect(withheld).toEqual([
      { currency: 'RUB', amount: 1580, operations: 2, from: '2026-01-01', to: '2026-11-04' },
    ]);
  });

  it('отбирает публикации по словарю терминов', () => {
    expect(matchesKeywords(item({ title: 'НДФЛ с купонов вырастет' }), DEFAULT_TAX_KEYWORDS)).toBe(true);
    expect(matchesKeywords(item({ title: 'Погода в Москве' }), DEFAULT_TAX_KEYWORDS)).toBe(false);
  });

  it('не считает налоговой новость с термином только в аннотации', () => {
    // Раньше достаточно было слова «налог» в summary — в раздел попадал мусор.
    expect(
      matchesKeywords(
        item({ title: 'Аукс, тебе конечно лайк, но есть нюанс', summary: 'рассуждаем про налоги' }),
        DEFAULT_TAX_KEYWORDS,
      ),
    ).toBe(false);
  });

  it('читает словарь из файла и падает на встроенный, если файла нет', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tax-'));
    const path = join(dir, 'keywords.yaml');
    writeFileSync(path, '# комментарий\n- ндфл\n- вычет\n', 'utf8');

    expect(loadTaxKeywords(path)).toEqual(['ндфл', 'вычет']);
    expect(loadTaxKeywords(join(dir, 'нет.yaml'))).toEqual(DEFAULT_TAX_KEYWORDS);
  });

  it('собирает факты удержаний и изменения законодательства', async () => {
    const news: NewsSourceAdapter = {
      id: 'smartlab',
      topics: ['news', 'tax'],
      fetchNews: async () => [item({ title: 'Налоги в 2027: что важно знать инвестору' })],
    };

    const facts = await collectTaxFacts({
      registry: new SourceRegistry([news]),
      tool: (name) => (name === 'invest_get_operations' ? fakeTool(name, async () => OPERATIONS) : undefined),
      timeoutMs: 1_000,
      accounts: ['acc-1'],
      keywords: DEFAULT_TAX_KEYWORDS,
      pages: 1,
      maxItems: 5,
      now: new Date('2026-11-04T12:00:00Z'),
    });

    expect(facts.withheld[0]?.amount).toBe(1580);
    expect(facts.changes).toHaveLength(1);
    expect(facts.coverage.some((entry) => entry.status === 'ok')).toBe(true);

    const text = formatTaxFacts(facts);
    expect(text).toContain('Удержанные налоги');
    expect(text).toContain('Изменения налогообложения');
  });

  it('сообщает об отсутствии данных, когда операций нет', async () => {
    const facts = await collectTaxFacts({
      registry: new SourceRegistry([]),
      tool: () => undefined,
      timeoutMs: 1_000,
      accounts: ['acc-1'],
      keywords: DEFAULT_TAX_KEYWORDS,
      pages: 1,
      maxItems: 5,
    });

    expect(formatTaxFacts(facts)).toContain('Удержанных налогов в истории операций не найдено');
    expect(facts.coverage.some((entry) => entry.status === 'missing')).toBe(true);
  });
});
