import { planKey, type CollectionPlan } from '../../src/collection/plan.js';
import type { CollectionResult } from '../../src/collection/executor.js';
import type { FactContext } from '../../src/report/engine.js';
import { createConclusionProvider } from '../../src/report/providers/securities/conclusion.provider.js';
import { EMPTY_PROFILES, loadCompanyProfiles } from '../../src/report/company-profiles.js';

const profiles = loadCompanyProfiles('data/company-profiles.yaml');
const NOW = new Date('2026-11-05T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

const plan: CollectionPlan = {
  entries: [
    { tool: 'invest_get_market_values', args: {}, group: 'prices', priority: 'mandatory' },
    { tool: 'invest_get_candles', args: {}, group: 'candles', priority: 'optional', target: 'SBER' },
    { tool: 'invest_get_share', args: {}, group: 'reference', priority: 'optional', target: 'SBER' },
    { tool: 'invest_get_forecast', args: {}, group: 'analytics', priority: 'optional', target: 'SBER' },
    { tool: 'invest_get_share_dividends', args: {}, group: 'dividends', priority: 'optional', target: 'SBER' },
    { tool: 'invest_get_insider_deals', args: {}, group: 'insiders', priority: 'optional', target: 'SBER' },
    { tool: 'market__news_digest', args: { tickers: ['SBER'] }, group: 'news', priority: 'optional', target: 'SBER' },
    { tool: 'market__news_digest', args: { days: 7 }, group: 'market_news', priority: 'optional' },
    { tool: 'macro__key_rate', args: {}, group: 'macro', priority: 'optional' },
  ],
  maxInstruments: 5,
};

const collected = (): CollectionResult => {
  const results = new Map<string, string>();
  for (const entry of plan.entries) {
    const key = planKey(entry);
    if (entry.tool === 'invest_get_market_values') {
      results.set(
        key,
        JSON.stringify({
          instruments: [
            {
              ticker: 'SBER',
              classCode: 'TQBR',
              priceCurrency: 'rub',
              values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '292.32' } }],
            },
          ],
        }),
      );
    }
    if (entry.group === 'candles') {
      results.set(
        key,
        JSON.stringify({
          priceCurrency: 'rub',
          candles: [
            { time: iso(180), close: { value: '320' } },
            { time: iso(30), close: { value: '282' } },
            { time: iso(0), close: { value: '292.32' } },
          ],
        }),
      );
    }
    if (entry.tool === 'invest_get_share') results.set(key, JSON.stringify({ sector: 'financial' }));
    if (entry.tool === 'invest_get_forecast') {
      results.set(
        key,
        JSON.stringify({
          consensus: {
            recommendation: 'RECOMMENDATION_BUY',
            consensus: { value: '382.37' },
            priceChangeRel: { value: '30.63' },
          },
        }),
      );
    }
    if (entry.group === 'dividends') {
      results.set(
        key,
        JSON.stringify({
          dividends: [
            {
              dividendNet: { currency: 'rub', value: '37.64' },
              recordDate: '2026-07-20',
              paymentDate: '2026-08-04',
              regularity: 'Annual',
              yieldValue: { value: '13.49' },
            },
          ],
        }),
      );
    }
    if (entry.group === 'insiders') {
      results.set(
        key,
        JSON.stringify({
          insiderDeals: [
            {
              date: '2025-12-11',
              direction: 'TRADE_DIRECTION_SELL',
              currency: 'RUR',
              quantity: '216732',
              price: { value: '307.19' },
              investorPosition: 'Подконтрольная эмитенту организация',
            },
          ],
        }),
      );
    }
    if (entry.group === 'news') {
      results.set(key, 'Новости по тикеру:\n• 2026-11-05 [tinkoff] Сбербанк отчитался за квартал');
    }
    if (entry.group === 'market_news') {
      results.set(key, 'Новости за неделю:\n• 2026-11-05 [rbc] ЦБ сохранил ставку 14 %');
    }
    if (entry.group === 'macro') {
      results.set(key, 'Ключевая ставка ЦБ: 14,00 % годовых\nДействует с 2026-10-24');
    }
  }
  return { results, coverage: [], partial: false };
};

const context = (scope: 'portfolio' | 'instrument' = 'instrument'): FactContext => ({
  plan,
  collected: collected(),
  template: { id: 't', version: 2, periods: ['1d', '7d', '30d', '180d'], thresholds: {}, sections: [] } as never,
  now: NOW,
  scope,
  scopeTarget: scope === 'instrument' ? 'SBER' : undefined,
});

describe('вывод по бумаге', () => {
  it('собирает в брифинг все факты: цену, динамику, аналитиков, дивиденды, инсайдеров и фон', () => {
    const facts = createConclusionProvider(profiles).section(context());
    const brief = facts?.brief ?? '';

    expect(brief).toContain('SBER (финансы)');
    expect(brief).toContain('цена 292,32 RUB');
    expect(brief).toContain('аналитики: покупать');
    expect(brief).toContain('цель 382,37');
    expect(brief).toContain('потенциал +30,63 %');
    expect(brief).toContain('дивиденды');
    expect(brief).toContain('инсайдеры');
    expect(brief).toContain('профиль: внутренний рынок');
    expect(brief).toContain('драйверы сектора');
    expect(brief).toContain('новости бумаги');
    expect(brief).toContain('фон рынка');
    expect(brief).toContain('ставка: Ключевая ставка ЦБ');
  });

  it('в разборе портфеля вывода по бумаге нет', () => {
    expect(createConclusionProvider(profiles).section(context('portfolio'))).toBeUndefined();
  });

  it('без профилей работает по сектору', () => {
    const facts = createConclusionProvider(EMPTY_PROFILES).section(context());

    expect(facts?.brief).toContain('SBER (финансы)');
    expect(facts?.brief).toContain('профиль: внутренний рынок');
  });
});
