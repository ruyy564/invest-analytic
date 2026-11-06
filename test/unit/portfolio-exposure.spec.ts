import { planKey, type CollectionPlan } from '../../src/capabilities/reports/collection/plan.js';
import type { CollectionResult } from '../../src/capabilities/reports/collection/executor.js';
import type { FactContext } from '../../src/capabilities/reports/engine.js';
import { loadCompanyProfiles } from '../../src/capabilities/reports/company-profiles.js';
import { createProviderMap } from '../../src/capabilities/reports/providers/index.js';

const profiles = loadCompanyProfiles('data/company-profiles.yaml');

const POSITIONS = JSON.stringify({
  securities: [
    { balance: '10', ticker: 'LKOH', classCode: 'TQBR' },
    { balance: '20', ticker: 'SBER', classCode: 'TQBR' },
  ],
});

const PRICES = JSON.stringify({
  instruments: [
    {
      ticker: 'LKOH',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '6000' } }],
    },
    {
      ticker: 'SBER',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '300' } }],
    },
  ],
});

/** Портфель: 60 000 + 6 000 = 66 000, прибыль 6 000 ₽, за день +0,5 %. */
const PORTFOLIO = JSON.stringify({
  expectedYield: { value: '6000' },
  dailyYieldRelative: { value: '0.5' },
  totalAmountPortfolio: { currency: 'rub', value: '66000' },
});

const plan: CollectionPlan = {
  entries: [
    { tool: 'invest_get_portfolio', args: { accountId: 'a' }, group: 'portfolio', priority: 'mandatory' },
    { tool: 'invest_get_positions', args: { accountId: 'a' }, group: 'portfolio', priority: 'mandatory' },
    { tool: 'invest_get_market_values', args: {}, group: 'prices', priority: 'mandatory' },
    { tool: 'invest_get_share', args: { instrumentId: 'LKOH_TQBR' }, group: 'reference', priority: 'optional', target: 'LKOH' },
    { tool: 'invest_get_share', args: { instrumentId: 'SBER_TQBR' }, group: 'reference', priority: 'optional', target: 'SBER' },
  ],
  maxInstruments: 5,
};

const collected = (): CollectionResult => {
  const results = new Map<string, string>();
  for (const entry of plan.entries) {
    if (entry.tool === 'invest_get_portfolio') results.set(planKey(entry), PORTFOLIO);
    if (entry.tool === 'invest_get_positions') results.set(planKey(entry), POSITIONS);
    if (entry.tool === 'invest_get_market_values') results.set(planKey(entry), PRICES);
    // Справочник отдаёт сектор бренда: нефть и газ и финансы.
    if (entry.tool === 'invest_get_share') {
      results.set(
        planKey(entry),
        JSON.stringify({ sector: entry.target === 'LKOH' ? 'energy' : 'financial' }),
      );
    }
  }
  return { results, coverage: [], partial: false };
};

const context = (): FactContext => ({
  plan,
  collected: collected(),
  template: { id: 'test', version: 1, periods: [], thresholds: {}, sections: [] } as never,
  now: new Date('2026-11-05T12:00:00Z'),
});

describe('внешнеэкономический профиль портфеля', () => {
  it('делит портфель на экспортёров и внутренний рынок', () => {
    const facts = createProviderMap({ profiles }).get('portfolio.exposure')?.section(context());

    expect(facts?.markdown).toContain('экспортёр');
    expect(facts?.markdown).toContain('внутренний рынок');
    // LKOH — 60 000 из 66 000, это больше 90 % портфеля.
    expect(facts?.markdown).toMatch(/экспортёр: 9\d,\d+ %/);
  });

  it('показывает валютную выручку и чувствительность к курсу и ставке', () => {
    const facts = createProviderMap({ profiles }).get('portfolio.exposure')?.section(context());

    expect(facts?.markdown).toContain('валютная выручка');
    expect(facts?.markdown).toContain('курс рубля');
    expect(facts?.markdown).toContain('ставка');
  });

  it('без профилей и без секторов честно говорит, чего не хватает', () => {
    const barePlan: CollectionPlan = {
      entries: plan.entries.filter((entry) => entry.group !== 'reference'),
      maxInstruments: 5,
    };
    const results = new Map<string, string>();
    for (const entry of barePlan.entries) {
      if (entry.tool === 'invest_get_portfolio') results.set(planKey(entry), PORTFOLIO);
      if (entry.tool === 'invest_get_positions') results.set(planKey(entry), POSITIONS);
      if (entry.tool === 'invest_get_market_values') results.set(planKey(entry), PRICES);
    }
    const facts = createProviderMap()
      .get('portfolio.exposure')
      ?.section({
        ...context(),
        plan: barePlan,
        collected: { results, coverage: [], partial: false },
      });

    expect(facts?.missing).toContain('company-profiles.yaml');
  });
});

describe('доходность портфеля в таблице', () => {
  it('показывает прибыль в процентах и за день', () => {
    const markdown = createProviderMap({ profiles }).get('portfolio.table')?.section(context())
      ?.markdown;

    // 6 000 / (66 000 − 6 000) = 10 %.
    expect(markdown).toContain('Доходность портфеля: +10,00 %');
    expect(markdown).toContain('(6 000,00 RUB)');
    expect(markdown).toContain('за день +0,50 %');
  });

  it('в разборе одной бумаги доходность портфеля не выводится', () => {
    const markdown = createProviderMap({ profiles })
      .get('portfolio.table')
      ?.section({ ...context(), scope: 'instrument', scopeTarget: 'LKOH' })?.markdown;

    expect(markdown).not.toContain('Доходность портфеля');
  });
});
