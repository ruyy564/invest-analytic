import { planKey, type CollectionPlan } from '../../src/collection/plan.js';
import type { CollectionResult } from '../../src/collection/executor.js';
import type { FactContext } from '../../src/report/engine.js';
import { createKnowledgeSectionProvider } from '../../src/report/providers/knowledge.provider.js';
import type { KnowledgeProvider, KnowledgeQuery, KnowledgeTopic } from '../../src/knowledge/index.js';

const TOPIC: KnowledgeTopic = {
  id: 'reporting',
  title: 'Как читать отчётность',
  summary: 'Прибыль без денежного потока и растущий долг — главные красные флаги.',
  points: ['Сначала денежный поток', 'Потом прибыль', 'Долг к EBITDA', 'Ещё тезис'],
  details: [],
  pitfalls: [],
  sections: ['securities', 'opinions', 'verdict'],
  sectors: [],
  keywords: ['отчётность'],
  sources: [],
};

const recorded: KnowledgeQuery[] = [];
const fakeKnowledge = (topics: KnowledgeTopic[] = [TOPIC]): KnowledgeProvider => ({
  isEmpty: false,
  select: (query) => {
    recorded.push(query);
    return topics;
  },
  promptBlock: () => undefined,
  topicFor: () => undefined,
  answerFor: () => undefined,
  miss: () => '',
});

const POSITIONS = JSON.stringify({ securities: [{ balance: '10', ticker: 'PLZL', classCode: 'TQBR' }] });
const PRICES = JSON.stringify({
  instruments: [
    {
      ticker: 'PLZL',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '1000' } }],
    },
  ],
});
const PORTFOLIO = JSON.stringify({ totalAmountCurrencies: [{ currency: 'rub', units: '10000' }] });

const plan: CollectionPlan = {
  entries: [
    { tool: 'invest_get_portfolio', args: { accountId: 'a' }, group: 'portfolio', priority: 'mandatory' },
    { tool: 'invest_get_positions', args: { accountId: 'a' }, group: 'portfolio', priority: 'mandatory' },
    { tool: 'invest_get_market_values', args: {}, group: 'prices', priority: 'mandatory' },
    { tool: 'invest_get_share', args: {}, group: 'reference', priority: 'optional', target: 'PLZL' },
  ],
  maxInstruments: 5,
};

const collected = (): CollectionResult => {
  const results = new Map<string, string>();
  for (const entry of plan.entries) {
    if (entry.tool === 'invest_get_portfolio') results.set(planKey(entry), PORTFOLIO);
    if (entry.tool === 'invest_get_positions') results.set(planKey(entry), POSITIONS);
    if (entry.tool === 'invest_get_market_values') results.set(planKey(entry), PRICES);
    if (entry.tool === 'invest_get_share') {
      results.set(planKey(entry), JSON.stringify({ sector: 'materials' }));
    }
  }
  return { results, coverage: [], partial: false };
};

const context = (overrides: Partial<FactContext> = {}): FactContext => ({
  plan,
  collected: collected(),
  template: { id: 'test', version: 2, periods: ['30d'], thresholds: {}, sections: [] } as never,
  now: new Date('2026-11-05T12:00:00Z'),
  ...overrides,
});

describe('справочный блок отчёта', () => {
  it('для портфеля подбирает темы раздела verdict по секторам', () => {
    recorded.length = 0;
    createKnowledgeSectionProvider(fakeKnowledge()).section(context());

    expect(recorded[0]?.section).toBe('verdict');
    expect(recorded[0]?.sectors).toContain('материалы');
  });

  it('для бумаги требует отчётность и не тянет портфельные секторы', () => {
    recorded.length = 0;
    createKnowledgeSectionProvider(fakeKnowledge()).section(
      context({ scope: 'instrument', scopeTarget: 'PLZL' }),
    );

    expect(recorded[0]?.section).toBe('securities');
    expect(recorded[0]?.required).toEqual(['reporting', 'multiples', 'sector-dependencies']);
    expect(recorded[0]?.sectors).toEqual(['материалы']);
  });

  it('выводит темы с пометкой «принципы, а не данные»', () => {
    const facts = createKnowledgeSectionProvider(fakeKnowledge()).section(context());
    const markdown = facts?.markdown ?? '';

    expect(markdown).toContain('**Как читать отчётность**');
    expect(markdown).toContain('• Сначала денежный поток');
    // Не больше трёх тезисов на тему: блок не вытесняет факты.
    expect(markdown).not.toContain('• Ещё тезис');
    expect(markdown).toContain('принципы трактовки, а не данные рынка');
  });

  it('без базы знаний секции нет', () => {
    expect(createKnowledgeSectionProvider(undefined).section(context())).toBeUndefined();
    expect(
      createKnowledgeSectionProvider(fakeKnowledge([])).section(context()),
    ).toBeUndefined();
  });
});
