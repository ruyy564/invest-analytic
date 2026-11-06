import { planKey, type CollectionPlan } from '../../src/capabilities/reports/collection/plan.js';
import type { CollectionResult } from '../../src/capabilities/reports/collection/executor.js';
import type { FactContext } from '../../src/capabilities/reports/engine.js';
import { securitiesProvider } from '../../src/capabilities/reports/providers/securities/detail.provider.js';
import { tableProvider } from '../../src/capabilities/reports/providers/portfolio/table.provider.js';

const POSITIONS = JSON.stringify({
  securities: [{ balance: '10', ticker: 'PLZL', classCode: 'TQBR', instrumentUid: 'uid-plzl' }],
});

const PRICES = JSON.stringify({
  instruments: [
    {
      ticker: 'PLZL',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '1400' } }],
    },
  ],
});

const PORTFOLIO = JSON.stringify({
  totalAmountCurrencies: [{ currency: 'rub', units: '100000' }],
});

const METALS =
  'Учётные цены драгметаллов ЦБ на 03.11.2026 (RUB за грамм):\n• золото: 10 187,57 ₽/г (03.11.2026)';

const plan: CollectionPlan = {
  entries: [
    { tool: 'invest_get_portfolio', args: { accountId: 'acc-1' }, group: 'portfolio', priority: 'mandatory' },
    { tool: 'invest_get_positions', args: { accountId: 'acc-1' }, group: 'portfolio', priority: 'mandatory' },
    { tool: 'invest_get_market_values', args: {}, group: 'prices', priority: 'mandatory' },
    { tool: 'macro__commodities', args: {}, group: 'commodities', priority: 'optional' },
  ],
  maxInstruments: 5,
};

const collected = (): CollectionResult => {
  const results = new Map<string, string>();
  for (const entry of plan.entries) {
    if (entry.tool === 'invest_get_portfolio') {
      results.set(planKey(entry), PORTFOLIO);
    }
    if (entry.tool === 'invest_get_positions') {
      results.set(planKey(entry), POSITIONS);
    }
    if (entry.tool === 'invest_get_market_values') {
      results.set(planKey(entry), PRICES);
    }
    if (entry.group === 'commodities') {
      results.set(planKey(entry), METALS);
    }
  }
  return { results, coverage: [], partial: false };
};

const context = (): FactContext => ({
  plan,
  collected: collected(),
  template: { id: 'test', version: 1, periods: [], thresholds: {}, sections: [] } as never,
  now: new Date('2026-11-05T12:00:00Z'),
  scope: 'instrument',
  scopeTarget: 'PLZL',
});

describe('разбор одной бумаги', () => {
  it('берёт только PLZL и показывает цену за штуку', () => {
    // Позиций в фикстуре одна, но вторая нужна, чтобы проверить фильтр по тикеру.
    const facts = securitiesProvider.section(context());

    expect(facts?.markdown).toContain('PLZL');
    expect(facts?.markdown).toContain('цена за 1 шт.');
    expect(facts?.markdown).not.toContain('SU26238');
  });

  it('добавляет цену металла из ЦБ для золотодобытчика', () => {
    const facts = securitiesProvider.section(context());

    expect(facts?.markdown).toContain('сырьё: золото');
    expect(facts?.markdown).toContain('03.11.2026');
  });

  it('не показывает сумму всего портфеля в разборе одной бумаги', () => {
    const facts = tableProvider.section(context());

    expect(facts?.markdown).toContain('Итого по бумаге');
    expect(facts?.markdown).not.toContain('Итого по текущим ценам');
  });
});
