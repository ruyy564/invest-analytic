import {
  applyPolicy,
  dedupeItems,
  loadNewsPolicy,
  parseCanonicalItem,
  resetNewsPolicyCache,
  type CanonicalItem,
} from '../../src/capabilities/news/index.js';

const item = (overrides: Partial<CanonicalItem> = {}): CanonicalItem => ({
  id: 'n-1',
  title: 'Индекс Мосбиржи вырос на 1,2 %',
  publishedAt: '2026-11-05T09:00:00+03:00',
  source: 'tass',
  tags: [],
  instrumentTags: [],
  ...overrides,
});

beforeAll(() => {
  resetNewsPolicyCache();
});

describe('канонический элемент', () => {
  it('требует корректную дату и отбрасывает невалидный элемент с причиной', () => {
    const ok = parseCanonicalItem({ ...item(), publishedAt: '2026-11-05T09:00:00Z' });
    const broken = parseCanonicalItem({ ...item(), publishedAt: '5 ноября' });

    expect(ok.ok).toBe(true);
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.reason).toContain('publishedAt');
    }
  });

  it('хранит привязку к бумаге отдельно от рубрик', () => {
    const parsed = parseCanonicalItem({ ...item(), tags: ['рынок'], instrumentTags: ['LKOH'] });

    expect(parsed.ok && parsed.item.tags).toEqual(['рынок']);
    expect(parsed.ok && parsed.item.instrumentTags).toEqual(['LKOH']);
  });
});

describe('политика новостей', () => {
  const policy = loadNewsPolicy('data/policy/news.yaml');

  it('загружается из файла с версией', () => {
    expect(policy.version).toBe(2);
    expect(policy.markers.length).toBeGreaterThan(5);
  });

  it('отбрасывает общие сводки', () => {
    const result = applyPolicy(
      [item({ title: 'Утренний дайджест: главное за день' })],
      { mode: 'general' },
      policy,
    );

    expect(result.items).toHaveLength(0);
    expect(result.report.dropped[0]).toMatchObject({ reason: 'digest', count: 1 });
  });

  it('в общей ленте оставляет только инвестиционную повестку', () => {
    const result = applyPolicy(
      [
        item({ id: 'a', title: 'В АдГ заявили, что визиты обходятся дорого' }),
        item({ id: 'b', title: 'Более 570 тыс. человек участвовали в акциях всеобщей забастовки' }),
        item({ id: 'c', title: 'Индекс Мосбиржи вырос на 1,2 %' }),
      ],
      { mode: 'general' },
      policy,
    );

    expect(result.items.map((entry) => entry.id)).toEqual(['c']);
    expect(result.report.in).toBe(3);
    expect(result.report.out).toBe(1);
  });

  it('по бумаге проверяет заголовок, а не аннотацию', () => {
    const result = applyPolicy(
      [
        item({ id: 'match', title: 'ЛУКОЙЛ отчитался за квартал' }),
        item({
          id: 'review',
          title: 'Состав народного портфеля не изменился',
          summary: 'В обзор вошли ЛУКОЙЛ и другие бумаги',
        }),
      ],
      { mode: 'ticker', matchers: ['ЛУКОЙЛ', 'LKOH'], tickers: ['LKOH'] },
      policy,
    );

    expect(result.items.map((entry) => entry.id)).toEqual(['match']);
    expect(result.report.dropped).toContainEqual({ reason: 'no_matcher', count: 1 });
  });

  it('считает привязкой тег инструмента от источника', () => {
    const result = applyPolicy(
      [item({ id: 'tagged', title: 'Акции нефтяных компаний снизились', instrumentTags: ['LKOH'] })],
      { mode: 'ticker', matchers: ['ЛУКОЙЛ'], tickers: ['LKOH'] },
      policy,
    );

    expect(result.items.map((entry) => entry.id)).toEqual(['tagged']);
  });

  it('устраняет дубли по ссылке и заголовку', () => {
    const result = dedupeItems([
      item({ id: 'a', url: 'https://n/1' }),
      item({ id: 'b', url: 'https://n/1' }),
      item({ id: 'c', title: 'Другая новость', url: undefined }),
      item({ id: 'd', title: 'Другая новость', url: undefined }),
    ]);

    expect(result.items.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(result.report.dropped).toEqual([{ reason: 'duplicate', count: 2 }]);
  });
});
