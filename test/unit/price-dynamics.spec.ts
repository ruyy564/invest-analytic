import {
  formatDynamics,
  mapCandles,
  pickInstrument,
  summarize,
} from '../../src/tools/price-dynamics/price-dynamics.tool.js';

const CANDLES = JSON.stringify({
  candles: [
    { time: '2026-05-05', close: { value: '2238.2' } },
    { time: '2026-07-01', close: { value: '1800' } },
    { time: '2026-10-20', close: { value: '1010.6' } },
    { time: '2026-11-01', close: { value: '1049.8' } },
  ],
  priceCurrency: 'rub',
});

describe('динамика цены бумаги', () => {
  it('считает изменение, минимум и максимум по свечам', () => {
    const { points, currency } = mapCandles(CANDLES);
    const dynamics = summarize(points, { ticker: 'PLZL', currency, days: 180 });
    const text = formatDynamics(dynamics);

    expect(points).toHaveLength(4);
    // 1049.8 против 2238.2 — падение чуть больше 53%.
    expect(text).toContain('изменение: -1 188,40 RUB (-53,10%), падение');
    expect(text).toContain('минимум: 2026-10-20 — 1 010,60 RUB');
    expect(text).toContain('максимум: 2026-05-05 — 2 238,20 RUB');
    expect(text).toContain('торговых дней в расчёте: 4');
  });

  it('сортирует свечи по дате, даже если брокер отдал их не по порядку', () => {
    const shuffled = JSON.stringify({
      candles: [
        { time: '2026-11-01', close: { value: '1049.8' } },
        { time: '2026-05-05', close: { value: '2238.2' } },
      ],
    });

    expect(mapCandles(shuffled).points.map((point) => point.date)).toEqual([
      '2026-05-05',
      '2026-11-01',
    ]);
  });

  it('не выдумывает данные, если свечей нет', () => {
    expect(formatDynamics(summarize([], { ticker: 'PLZL', currency: 'RUB', days: 180 }))).toContain(
      'брокер не вернул свечи',
    );
  });

  it('находит бумагу по тикеру или названию', () => {
    const found = {
      instruments: [
        { ticker: 'RU000A1025U5', classCode: 'TQCB', name: 'Сбербанк 001Р-SBER17' },
        { ticker: 'PLZL', classCode: 'TQBR', name: 'Полюс' },
      ],
    };

    expect(pickInstrument(found, 'plzl')).toMatchObject({ ticker: 'PLZL', classCode: 'TQBR' });
    expect(pickInstrument(found, 'Полюс')).toMatchObject({ ticker: 'PLZL' });
  });
});
