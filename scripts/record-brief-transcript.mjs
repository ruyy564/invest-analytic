// Запись эталонного ответа разбора бумаги из реального кода (без модели).
// Используется один раз для наполнения корзины аналитики: транскрипт — это
// фактический вывод сборщика отчёта на фикстурах, а не текст, придуманный руками.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildReport } from '../dist/capabilities/reports/engine.js';
import { composeMarkdown } from '../dist/capabilities/reports/compose.js';
import { buildCollectionPlan, planKey } from '../dist/capabilities/reports/collection/plan.js';
import { createProviderMap } from '../dist/capabilities/reports/providers/index.js';
import { parseCompanyProfiles } from '../dist/capabilities/reports/company-profiles.js';
import { loadReportTemplate } from '../dist/capabilities/reports/template.js';

const NOW = new Date('2026-11-07T10:00:00.000Z');

const texts = {
  invest_get_portfolio: JSON.stringify({
    totalAmountCurrencies: [{ currency: 'rub', units: '150000' }],
  }),
  invest_get_positions: JSON.stringify({
    securities: [{ balance: '100', ticker: 'SBER', classCode: 'TQBR' }],
  }),
  invest_get_market_values: JSON.stringify({
    instruments: [
      {
        ticker: 'SBER',
        classCode: 'TQBR',
        priceCurrency: 'rub',
        values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '291.77' } }],
      },
    ],
  }),
  invest_get_forecast: JSON.stringify({
    consensus: {
      ticker: 'SBER',
      recommendation: 'RECOMMENDATION_BUY',
      consensus: { value: '382.37' },
      priceChangeRel: { value: '31.05' },
    },
  }),
  invest_get_share_dividends: JSON.stringify({
    dividends: [
      {
        dividendNet: { currency: 'rub', value: '37.64' },
        paymentDate: '2026-08-04',
        lastBuyDate: '2026-07-17',
        recordDate: '2026-07-20',
        regularity: 'Annual',
        yieldValue: { value: '13.49' },
      },
    ],
  }),
  invest_get_instrument_reports: JSON.stringify({
    events: [
      { reportDate: '2026-04-29', periodYear: 2026, periodNum: 1 },
      { reportDate: '2026-07-29', periodYear: 2026, periodNum: 2 },
      { reportDate: '2026-10-28', periodYear: 2026, periodNum: 3 },
    ],
  }),
  invest_get_asset_fundamentals: JSON.stringify({
    fundamentals: [
      {
        peRatioTtm: 3.29,
        priceToBookTtm: 0.71,
        roe: 22.88,
        netMarginMrq: 0,
        netDebtToEbitda: 0,
        dividendYieldDailyTtm: 12.8,
        fiveYearsAverageDividendYield: 9.15,
      },
    ],
  }),
  invest_get_brand: JSON.stringify({ brand: { sector: 'SECTOR_FINANCIAL' } }),
  market__factors: [
    'Рыночные факторы за 30 дн. (данные на 2026-11-07):',
    '• Нефть Brent: 98,64 USD за баррель, за 30 дн.: +0,13 % (98,51 → 98,64)',
    '• Доллар/рубль: 82,18 RUB, за 30 дн.: -3,79 % (85,42 → 82,18)',
    '• Ключевая ставка ЦБ: 14,00 % годовых — действует с 2026-07-27',
  ].join('\n'),
  macro__cb_meetings:
    'Заседания ЦБ по ключевой ставке: 2026-12-18 (опорное), 2027-02-12 (предварительное) (план на 2026-11-01).',
};

const built = buildCollectionPlan({
  accounts: ['acc-1'],
  tickers: ['SBER_TQBR'],
  maxInstruments: 5,
  providers: ['securities.detail', 'securities.opinions'],
});
const extraEntries = [
  { tool: 'invest_get_brand', args: { id: 'brand-1' }, group: 'reference', priority: 'optional', target: 'SBER' },
  {
    tool: 'invest_get_asset_fundamentals',
    args: { assets: ['asset-sber'] },
    group: 'fundamentals',
    priority: 'optional',
    target: 'SBER',
  },
];
const entries = [...built.entries, ...extraEntries];
const results = new Map();
for (const entry of entries) {
  const text = texts[entry.tool];
  if (text !== undefined) {
    results.set(planKey(entry), text);
  }
}

const profiles = parseCompanyProfiles({
  sectors: [
    { key: 'financial', drivers: ['ставка', 'кредитование'], currency: 'neutral', rate: 'negative' },
  ],
});

const report = buildReport({
  template: loadReportTemplate('reports/portfolio-review.yaml'),
  providers: createProviderMap({ profiles }),
  plan: { entries, maxInstruments: 5 },
  collected: { results, coverage: [], partial: false },
  now: NOW,
  scope: 'instrument',
  scopeTarget: 'SBER',
});

const transcript = composeMarkdown(report, {}, 'бумаги SBER');
const target = join('test', 'eval', 'transcripts', 'analytics-brief-sber.txt');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${transcript}\n`, 'utf8');
console.log(transcript);
