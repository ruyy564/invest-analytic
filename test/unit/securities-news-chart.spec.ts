import { planKey, type CollectionPlan } from '../../src/collection/plan.js';
import type { CollectionResult } from '../../src/collection/executor.js';
import type { FactContext } from '../../src/report/engine.js';
import { securitiesProvider } from '../../src/report/providers/securities/detail.provider.js';
import { tableProvider } from '../../src/report/providers/portfolio/table.provider.js';

const POSITIONS = JSON.stringify({
  securities: [
    { balance: '10', ticker: 'PLZL', classCode: 'TQBR' },
    { balance: '20', ticker: 'SBER', classCode: 'TQBR' },
  ],
});

const PRICES = JSON.stringify({
  instruments: [
    {
      ticker: 'PLZL',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '1400' } }],
    },
    {
      ticker: 'SBER',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '300' } }],
    },
  ],
});

const PORTFOLIO = JSON.stringify({
  totalAmountCurrencies: [{ currency: 'rub', units: '100000' }],
});

const candles = (values: number[]): string =>
  JSON.stringify({
    priceCurrency: 'rub',
    candles: values.map((value, index) => ({
      time: `2026-0${(index % 9) + 1}-10T00:00:00Z`,
      close: { value: String(value) },
    })),
  });

/** Одна и та же новость приходит по обеим бумагам: в отчёте она нужна один раз. */
const SHARED_NEWS = 'Новости по тикеру:\n• 2026-11-04 [rbc] Акции выросли на торгах';

const plan: CollectionPlan = {
  entries: [
    { tool: 'invest_get_portfolio', args: { accountId: 'a' }, group: 'portfolio', priority: 'mandatory' },
    { tool: 'invest_get_positions', args: { accountId: 'a' }, group: 'portfolio', priority: 'mandatory' },
    { tool: 'invest_get_market_values', args: {}, group: 'prices', priority: 'mandatory' },
    { tool: 'invest_get_candles', args: { instrumentId: 'PLZL_TQBR' }, group: 'candles', priority: 'optional', target: 'PLZL' },
    { tool: 'invest_get_candles', args: { instrumentId: 'SBER_TQBR' }, group: 'candles', priority: 'optional', target: 'SBER' },
    { tool: 'market__news_digest', args: { tickers: ['PLZL'] }, group: 'news', priority: 'mandatory', target: 'PLZL' },
    { tool: 'market__news_digest', args: { tickers: ['SBER'] }, group: 'news', priority: 'mandatory', target: 'SBER' },
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
    if (entry.tool === 'invest_get_candles') {
      results.set(planKey(entry), candles([1200, 1300, 1250, 1400]));
    }
    if (entry.group === 'news') {
      results.set(planKey(entry), SHARED_NEWS);
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

describe('новости и график в отчёте', () => {
  it('показывает общую новость только в первой карточке', () => {
    const markdown = securitiesProvider.section(context())?.markdown ?? '';

    const blocks = markdown.split('\n\n');
    const plzl = blocks.find((block) => block.includes('PLZL')) ?? '';
    const sber = blocks.find((block) => block.includes('SBER')) ?? '';

    expect(plzl).toContain('Акции выросли на торгах');
    expect(sber).not.toContain('Акции выросли на торгах');
    expect(sber).toContain('общие с другими бумагами портфеля');
    // Заголовок встречается в отчёте ровно один раз.
    expect(markdown.split('Акции выросли на торгах')).toHaveLength(2);
  });

  it('добавляет график цены в карточку бумаги', () => {
    const markdown = securitiesProvider.section(context())?.markdown ?? '';

    expect(markdown).toContain('• график (90 дней): ');
    expect(markdown).toMatch(/[▁▂▃▄▅▆▇█]{2,}/);
  });

  it('добавляет колонку графика в таблицу портфеля', () => {
    const markdown = tableProvider.section(context())?.markdown ?? '';
    const header = markdown.split('\n')[0];

    expect(header).toContain('График');
    expect(markdown).toMatch(/[▁▂▃▄▅▆▇█]{2,}/);
  });
});
