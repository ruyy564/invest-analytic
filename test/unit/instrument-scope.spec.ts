import { planKey, type CollectionPlan } from '../../src/collection/plan.js';
import type { CollectionResult } from '../../src/collection/executor.js';
import { instrumentFromSearch } from '../../src/agent/nodes/review/instruments.js';
import type { FactContext } from '../../src/report/engine.js';
import { securitiesProvider } from '../../src/report/providers/securities/detail.provider.js';
import { mapNews } from '../../src/news/sources/tinkoff.js';

const NOW = new Date('2026-11-05T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

const PRICES = JSON.stringify({
  instruments: [
    {
      ticker: 'PLZL',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '1071.4' } }],
    },
  ],
});

// 200 дней назад бумага стоила 2181,60: в окно графика это не должно попасть.
const CANDLES = JSON.stringify({
  priceCurrency: 'rub',
  candles: [
    { time: iso(200), close: { value: '2181.6' } },
    { time: iso(30), close: { value: '1000' } },
    { time: iso(10), close: { value: '1050' } },
    { time: iso(0), close: { value: '1071.4' } },
  ],
});

const NEWS = 'Новости по тикеру:\n• 2026-11-05 [tinkoff] Полюс увеличил добычу золота';

/** План разбора бумаги: портфель не читается, только данные по тикеру. */
const plan: CollectionPlan = {
  entries: [
    { tool: 'invest_get_market_values', args: { instrumentId: ['PLZL_TQBR'] }, group: 'prices', priority: 'mandatory' },
    { tool: 'invest_get_candles', args: { instrumentId: 'PLZL_TQBR' }, group: 'candles', priority: 'optional', target: 'PLZL' },
    { tool: 'invest_get_share', args: { instrumentId: 'PLZL_TQBR' }, group: 'reference', priority: 'optional', target: 'PLZL' },
    { tool: 'market__news_digest', args: { tickers: ['PLZL'] }, group: 'news', priority: 'mandatory', target: 'PLZL' },
  ],
  maxInstruments: 5,
};

const collected = (): CollectionResult => {
  const results = new Map<string, string>();
  for (const entry of plan.entries) {
    if (entry.tool === 'invest_get_market_values') results.set(planKey(entry), PRICES);
    if (entry.tool === 'invest_get_candles') results.set(planKey(entry), CANDLES);
    if (entry.tool === 'invest_get_share') {
      results.set(planKey(entry), JSON.stringify({ sector: 'materials' }));
    }
    if (entry.group === 'news') results.set(planKey(entry), NEWS);
  }
  return { results, coverage: [], partial: false };
};

const context = (): FactContext => ({
  plan,
  collected: collected(),
  template: { id: 'test', version: 2, periods: ['1d', '7d', '30d'], thresholds: {}, sections: [] } as never,
  now: NOW,
  scope: 'instrument',
  scopeTarget: 'PLZL',
});

describe('разбор бумаги без портфеля', () => {
  it('строит карточку по цене и не показывает портфельные строки', () => {
    const markdown = securitiesProvider.section(context())?.markdown ?? '';

    expect(markdown).toContain('**PLZL — материалы**');
    expect(markdown).toContain('• цена за 1 шт.: 1 071,40 RUB');
    expect(markdown).not.toContain('• стоимость:');
    expect(markdown).not.toContain('% портфеля');
  });

  it('рисует график за 90 дней и не берёт старые выбросы в диапазон', () => {
    const markdown = securitiesProvider.section(context())?.markdown ?? '';

    expect(markdown).toContain('• график (90 дней): ');
    // 2181,60 из истории 200 дней назад в диапазон не попадает.
    expect(markdown).toContain('(1 000,00 — 1 071,40 RUB)');
  });

  it('показывает новость по бумаге и не смешивает её с портфелем', () => {
    const markdown = securitiesProvider.section(context())?.markdown ?? '';

    expect(markdown).toContain('Полюс увеличил добычу золота');
  });
});

describe('новости брокера по тикеру', () => {
  it('отбрасывает общий поток рынка, если бумага не упомянута', () => {
    const raw = JSON.stringify({
      items: [
        { id: '1', title: 'Рынок акций РФ вырос во главе с металлургами', content: 'ВК и металлурги', ts: iso(0) },
        { id: '2', title: 'Полюс отчитался за квартал', content: 'Добыча выросла', ts: iso(0) },
      ],
    });

    const items = mapNews(raw, 'tinkoff', 400, ['PLZL', 'Полюс']).items;

    expect(items.map((item) => item.title)).toEqual(['Полюс отчитался за квартал']);
  });

  it('без matchers не теряет новости', () => {
    const raw = JSON.stringify({
      items: [{ id: '1', title: 'Полюс отчитался за квартал', ts: iso(0) }],
    });

    expect(mapNews(raw, 'tinkoff').items).toHaveLength(1);
  });
});

describe('поиск инструмента по тикеру', () => {
  it('берёт ликвидный режим торгов из выдачи', () => {
    const searchPlan: CollectionPlan = {
      entries: [
        { tool: 'invest_find_instrument', args: { query: 'PLZL' }, group: 'reference', priority: 'mandatory' },
      ],
      maxInstruments: 1,
    };
    const results = new Map<string, string>([
      [
        planKey(searchPlan.entries[0]),
        JSON.stringify({
          instruments: [
            { ticker: 'PLZL', classCode: 'TQTD', name: 'Полюс' },
            { ticker: 'PLZL', classCode: 'TQBR', name: 'Полюс' },
          ],
        }),
      ],
    ]);

    const found = instrumentFromSearch(searchPlan, { results, coverage: [], partial: false }, 'plzl');

    expect(found).toEqual({ ticker: 'PLZL', classCode: 'TQBR', name: 'Полюс' });
  });

  it('без ответа поиска возвращает undefined', () => {
    expect(
      instrumentFromSearch(
        { entries: [], maxInstruments: 1 },
        { results: new Map(), coverage: [], partial: false },
        'PLZL',
      ),
    ).toBeUndefined();
  });
});
