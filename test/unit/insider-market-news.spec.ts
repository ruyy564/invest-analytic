import { planKey, type CollectionPlan } from '../../src/capabilities/reports/collection/plan.js';
import type { CollectionResult } from '../../src/capabilities/reports/collection/executor.js';
import type { FactContext } from '../../src/capabilities/reports/engine.js';
import { insiderDealOf, insiderLine } from '../../src/capabilities/reports/providers/securities/shared.js';
import { marketNewsProvider } from '../../src/capabilities/reports/providers/market-news.provider.js';

const DEALS = JSON.stringify({
  insiderDeals: [
    {
      date: '2020-06-14',
      direction: 'TRADE_DIRECTION_BUY',
      currency: 'RUR',
      quantity: '79872',
      price: { value: '208.35' },
      investorName: 'Ганеев Олег',
      investorPosition: 'Заместитель Председателя Правления',
    },
    {
      date: '2025-12-11',
      direction: 'TRADE_DIRECTION_SELL',
      currency: 'RUR',
      quantity: '216732',
      price: { value: '307.19' },
      investorName: 'Анонимный инвестор',
      investorPosition: 'Подконтрольная эмитенту организация',
    },
  ],
});

const NEWS_DIGEST =
  'Новости за неделю:\n' +
  '• 2026-11-05 [rbc] ЦБ сохранил ставку 14 %\n' +
  '• 2026-11-05 [tass] Индекс Мосбиржи вырос на 1,2 %\n' +
  '• 2026-11-04 [finam] Нефть подешевела на 3 %\n' +
  'Источники: rbc — получено (1), tass — получено (1), finam — получено (1)';

describe('сделки инсайдеров', () => {
  it('берёт самую свежую сделку и описывает её строкой', () => {
    const deal = insiderDealOf(DEALS);

    expect(deal).toMatchObject({ date: '2025-12-11', direction: 'sell', quantity: 216732 });
    expect(insiderLine(deal as never)).toContain('• инсайдеры: 2025-12-11 продажа');
    expect(insiderLine(deal as never)).toContain('216 732 шт.');
    expect(insiderLine(deal as never)).toContain('по 307,19 RUB');
  });

  it('без сделок и на битом ответе возвращает undefined', () => {
    expect(insiderDealOf(JSON.stringify({ insiderDeals: [] }))).toBeUndefined();
    expect(insiderDealOf('не json')).toBeUndefined();
  });
});

describe('фон рынка в отчёте', () => {
  const plan: CollectionPlan = {
    entries: [
      { tool: 'market__news_digest', args: { days: 7 }, group: 'market_news', priority: 'optional' },
    ],
    maxInstruments: 1,
  };

  const context = (text?: string): FactContext => {
    const results = new Map<string, string>();
    if (text !== undefined) {
      results.set(planKey(plan.entries[0]), text);
    }
    return {
      plan,
      collected: { results, coverage: [], partial: false } as CollectionResult,
      template: { id: 't', version: 2, periods: [], thresholds: {}, sections: [] } as never,
      now: new Date('2026-11-05T12:00:00Z'),
    };
  };

  it('показывает до пяти заголовков из общей сводки', () => {
    const facts = marketNewsProvider.section(context(NEWS_DIGEST));

    expect(facts?.markdown).toContain('Фон рынка: новости за неделю');
    expect(facts?.markdown).toContain('ЦБ сохранил ставку 14 %');
    expect(facts?.markdown).toContain('Индекс Мосбиржи вырос');
    // Строка покрытия источников в фон рынка не попадает.
    expect(facts?.markdown).not.toContain('Источники:');
  });

  it('без сводки и без новостей честно сообщает причину', () => {
    expect(marketNewsProvider.section(context())?.missing).toContain('не собиралась');
    expect(
      marketNewsProvider.section(context('Новости за неделю:\nИсточники: rbc'))?.missing,
    ).toContain('новостей');
  });
});
