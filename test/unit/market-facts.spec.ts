import {
  formatChangePct,
  periodChanges,
  seriesByTicker,
  trendWord,
} from '../../src/report/market-facts.js';
import { formatNewsDigest } from '../../src/tools/thematic/news-digest.js';
import type { SourceItem } from '../../src/sources/types.js';

const candles = (points: [string, number][]): string =>
  JSON.stringify({
    priceCurrency: 'rub',
    candles: points.map(([date, close]) => ({
      time: `${date}T00:00:00Z`,
      close: { value: String(close) },
    })),
  });

const now = new Date('2026-11-04T00:00:00Z');

describe('периоды динамики цены', () => {
  const series = seriesByTicker([
    {
      target: 'SBER',
      text: candles([
        ['2026-05-08', 100],
        ['2026-10-01', 110],
        ['2026-11-02', 120],
        ['2026-11-03', 130],
        ['2026-11-04', 150],
      ]),
    },
  ]);

  it('считает изменение от ближайшей точки не позже начала периода', () => {
    const changes = periodChanges(series.get('SBER') as never, ['1d', '7d', '30d', '180d'], now);

    expect(changes.map((change) => change.period)).toEqual(['1d', '7d', '30d', '180d']);
    // 1 день: 130 (2026-11-03) → 150
    expect(changes[0].changePct).toBeCloseTo(15.38, 1);
    // 180 дней: 100 (2026-05-08) → 150
    expect(changes.at(-1)?.changePct).toBeCloseTo(50, 5);
  });

  it('пропускает период, если истории короче', () => {
    const short = seriesByTicker([
      { target: 'AAA', text: candles([['2026-11-02', 10], ['2026-11-03', 11]]) },
    ]);

    expect(periodChanges(short.get('AAA') as never, ['180d'], now)).toEqual([]);
  });

  it('форматирует процент и направление движения', () => {
    expect(formatChangePct(12.3)).toBe('+12,30 %');
    expect(formatChangePct(-3)).toBe('-3,00 %');
    expect(trendWord(1)).toBe('рост');
    expect(trendWord(-1)).toBe('падение');
    expect(trendWord(0)).toBe('без изменений');
  });
});

describe('сводка новостей', () => {
  const item = (title: string): SourceItem => ({
    id: title,
    title,
    publishedAt: '2026-11-04T09:00:00Z',
    tags: [],
    source: 'rbc',
  });

  it('не повторяет одну публикацию в разных периодах', () => {
    const text = formatNewsDigest({
      periods: [
        { id: 'fresh', title: 'свежие', items: [item('Первая')] },
        { id: 'week', title: 'за неделю', items: [item('Первая'), item('Вторая')] },
        { id: 'month', title: 'за месяц', items: [item('Первая'), item('Вторая')] },
        { id: 'half_year', title: 'за полгода', items: [item('Первая'), item('Вторая')] },
      ],
      coverage: [],
      asOf: '2026-11-04T12:00:00Z',
    });

    expect(text.match(/Первая/g)).toHaveLength(1);
    expect(text.match(/Вторая/g)).toHaveLength(1);
    expect(text).toContain('Новости свежие:');
    expect(text).toContain('Новости за неделю:');
  });
});
