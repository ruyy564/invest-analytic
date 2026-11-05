import { planKey, type CollectionPlan } from '../../src/collection/plan.js';
import type { CollectionResult } from '../../src/collection/executor.js';
import type { FactContext } from '../../src/report/engine.js';
import { bondFactsOf, bondLine } from '../../src/report/providers/securities/bond-facts.js';
import { dividendsOf, dividendLine } from '../../src/report/providers/securities/shared.js';

const NOW = new Date('2026-11-05T12:00:00Z');

const DIVIDENDS = JSON.stringify({
  dividends: [
    {
      dividendNet: { currency: 'rub', value: '37.64' },
      paymentDate: '2026-08-04',
      recordDate: '2026-07-20',
      lastBuyDate: '2026-07-17',
      regularity: 'Annual',
      yieldValue: { value: '13.49' },
    },
    {
      dividendNet: { currency: 'rub', value: '34.84' },
      paymentDate: '2025-08-01',
      recordDate: '2025-07-18',
      regularity: 'Annual',
      yieldValue: { value: '10.83' },
    },
    {
      dividendNet: { currency: 'rub', value: '12.00' },
      paymentDate: '2027-07-01',
      recordDate: '2027-06-20',
      regularity: 'Annual',
    },
  ],
});

const BOND = JSON.stringify({
  instrument: {
    ticker: 'SU26238RMFS4',
    classCode: 'TQOB',
    name: 'ОФЗ 26238',
    couponQuantityPerYear: 2,
    maturityDate: '2041-05-15',
    nominal: { currency: 'rub', value: '1000' },
    aciValue: { currency: 'rub', value: '30.34' },
    floatingCouponFlag: false,
    amortizationFlag: false,
    perpetualFlag: false,
  },
});

const EVENTS = JSON.stringify({
  events: [
    { eventDate: '2026-12-02', eventType: 'EVENT_TYPE_CPN' },
    { eventDate: '2026-06-03', eventType: 'EVENT_TYPE_CPN' },
    { eventDate: '2041-05-15', eventType: 'EVENT_TYPE_MATURITY' },
  ],
});

const ACCRUED = JSON.stringify({
  accruedInterests: [
    { date: '2026-06-04', valuePercent: { value: '0.019' } },
    { date: '2026-11-01', valuePercent: { value: '3.55' } },
    { date: '2026-11-05', valuePercent: { value: '3.58' } },
  ],
});

const plan: CollectionPlan = {
  entries: [
    { tool: 'invest_get_bond', args: { instrumentId: 'SU26238_TQOB' }, group: 'bonds', priority: 'optional', target: 'SU26238' },
    { tool: 'invest_get_bond_events', args: { instrumentId: 'SU26238_TQOB' }, group: 'bond_events', priority: 'optional', target: 'SU26238' },
    { tool: 'invest_get_bond_accrued', args: { instrumentId: 'SU26238_TQOB' }, group: 'bond_accrued', priority: 'optional', target: 'SU26238' },
  ],
  maxInstruments: 5,
};

const collected = (): CollectionResult => {
  const results = new Map<string, string>();
  for (const entry of plan.entries) {
    if (entry.group === 'bonds') results.set(planKey(entry), BOND);
    if (entry.group === 'bond_events') results.set(planKey(entry), EVENTS);
    if (entry.group === 'bond_accrued') results.set(planKey(entry), ACCRUED);
  }
  return { results, coverage: [], partial: false };
};

const context = (): FactContext => ({
  plan,
  collected: collected(),
  template: { id: 'test', version: 1, periods: [], thresholds: {}, sections: [] } as never,
  now: NOW,
});

describe('дивиденды бумаги', () => {
  it('берёт ближайшую будущую выплату и последнюю прошедшую', () => {
    const facts = dividendsOf(DIVIDENDS, NOW);

    expect(facts?.count).toBe(3);
    expect(facts?.next?.paymentDate).toBe('2027-07-01');
    expect(facts?.last?.paymentDate).toBe('2026-08-04');
  });

  it('пишет размер, доходность, даты отсечки и выплаты', () => {
    const line = dividendLine(dividendsOf(DIVIDENDS, NOW));

    expect(line).toContain('ближайшая выплата');
    expect(line).toContain('12,00 RUB');
    expect(line).toContain('отсечка 2027-06-20');
    expect(line).toContain('раз в год');
    expect(line).toContain('всего выплат 3');
  });

  it('честно говорит, когда выплат нет или данных нет', () => {
    expect(dividendLine(dividendsOf(JSON.stringify({ dividends: [] }), NOW))).toContain(
      'выплат в истории нет',
    );
    expect(dividendLine(undefined)).toContain('данных нет');
    expect(dividendsOf('не json', NOW)).toBeUndefined();
  });
});

describe('облигации в разборе', () => {
  it('определяет категорию, купон и даты', () => {
    const facts = bondFactsOf(context(), 'SU26238', 'TQOB');

    expect(facts?.category).toBe('ОФЗ');
    expect(facts?.couponPerYear).toBe(2);
    expect(facts?.couponPct).toBeCloseTo(7.16, 1);
    expect(facts?.maturityDate).toBe('2041-05-15');
    expect(facts?.nextCouponDate).toBe('2026-12-02');
    expect(facts?.accrued).toBeCloseTo(30.34);
  });

  it('описывает бумагу строкой для карточки', () => {
    const line = bondLine(bondFactsOf(context(), 'SU26238', 'TQOB') as never);

    expect(line).toContain('• облигация: ОФЗ');
    expect(line).toContain('купон 2 раз в год');
    expect(line).toContain('погашение 2041-05-15');
    expect(line).toContain('НКД 30,34');
  });

  it('не считает акцию облигацией', () => {
    expect(bondFactsOf(context(), 'SBER', 'TQBR')).toBeUndefined();
  });

  it('замещающая облигация определяется по валюте номинала', () => {
    const planCopy: CollectionPlan = {
      entries: [
        { tool: 'invest_get_bond', args: { instrumentId: 'RU000A10DT08_TQCB' }, group: 'bonds', priority: 'optional', target: 'RU000A10DT08' },
      ],
      maxInstruments: 1,
    };
    const results = new Map<string, string>([
      [
        planKey(planCopy.entries[0]),
        JSON.stringify({
          instrument: {
            ticker: 'RU000A10DT08',
            classCode: 'TQCB',
            nominal: { currency: 'cny', value: '1000' },
            couponQuantityPerYear: 12,
            floatingCouponFlag: true,
            maturityDate: '2029-02-27',
          },
        }),
      ],
    ]);
    const facts = bondFactsOf(
      { ...context(), plan: planCopy, collected: { results, coverage: [], partial: false } },
      'RU000A10DT08',
      'TQCB',
    );

    expect(facts?.category).toBe('замещающая');
    expect(facts?.floating).toBe(true);
  });
});
