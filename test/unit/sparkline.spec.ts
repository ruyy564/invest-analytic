import { sparkline, sparklineOf, seriesRange } from '../../src/report/sparkline.js';
import type { PriceSeries } from '../../src/report/market-facts.js';

const series = (closes: number[]): PriceSeries => ({
  ticker: 'TEST',
  currency: 'RUB',
  points: closes.map((close, index) => ({ date: `2026-11-0${(index % 9) + 1}`, close })),
});

describe('график цены в отчёте', () => {
  it('строит спарклайн по возрастающему ряду', () => {
    const chart = sparkline([1, 2, 3, 4, 5, 6, 7, 8], 8);

    expect(chart).toHaveLength(8);
    expect(chart.startsWith('▁')).toBe(true);
    expect(chart.endsWith('█')).toBe(true);
  });

  it('не больше ширины и не меньше двух точек', () => {
    expect(sparkline([1, 5, 9, 3, 7], 3).length).toBe(3);
    // Одной точки недостаточно, чтобы показать форму движения.
    expect(sparkline([5])).toBe('');
    expect(sparkline([])).toBe('');
  });

  it('плоский ряд рисуется серединой, а не пустотой', () => {
    expect(sparkline([5, 5, 5, 5])).toBe('▄▄▄▄');
  });

  it('берёт ряд цен бумаги и его диапазон', () => {
    const price = series([100, 120, 90, 150]);

    expect(sparklineOf(price, 4)).toHaveLength(4);
    expect(seriesRange(price)).toEqual({ min: 90, max: 150 });
    expect(sparklineOf(undefined)).toBe('');
    expect(seriesRange(undefined)).toBeUndefined();
  });
});
