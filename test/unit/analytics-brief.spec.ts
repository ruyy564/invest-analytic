import { join } from 'node:path';
import {
  calendarItems,
  driverLines,
  parseCbMeetingLines,
  parseFactors,
  parseFundamentals,
  parseReportCalendar,
  scoreItems,
} from '../../src/capabilities/reports/analytics.js';
import {
  buildCollectionPlan,
  planKey,
  type PlanEntry,
} from '../../src/capabilities/reports/collection/plan.js';
import { executePlan } from '../../src/capabilities/reports/collection/executor.js';
import { composeMarkdown } from '../../src/capabilities/reports/compose.js';
import { buildReport } from '../../src/capabilities/reports/engine.js';
import { ToolBudget } from '../../src/transports/mcp/tool-budget.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';
import { parseCompanyProfiles } from '../../src/capabilities/reports/company-profiles.js';
import { createAnalyticsProviders } from '../../src/capabilities/reports/providers/securities/analytics.provider.js';
import { createProviderMap } from '../../src/capabilities/reports/providers/index.js';
import { loadReportTemplate } from '../../src/capabilities/reports/template.js';
import type { FactContext } from '../../src/capabilities/reports/engine.js';

const templatePath = join(import.meta.dirname, '..', '..', 'reports', 'portfolio-review.yaml');
const NOW = new Date('2026-11-07T10:00:00.000Z');

const PORTFOLIO = JSON.stringify({ totalAmountCurrencies: [{ currency: 'rub', units: '150000' }] });

const POSITIONS = JSON.stringify({
  securities: [{ balance: '100', ticker: 'SBER', classCode: 'TQBR' }],
});

const PRICES = JSON.stringify({
  instruments: [
    {
      ticker: 'SBER',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '291.77' } }],
    },
  ],
});

const FORECAST = JSON.stringify({
  consensus: {
    ticker: 'SBER',
    recommendation: 'RECOMMENDATION_BUY',
    consensus: { value: '382.37' },
    priceChangeRel: { value: '31.05' },
  },
});

const DIVIDENDS = JSON.stringify({
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
});

/** Ответ брокера как есть: даты публикации отчётности за последние кварталы. */
const REPORTS = JSON.stringify({
  events: [
    { reportDate: '2026-04-29', periodYear: 2026, periodNum: 1, periodType: 'PERIOD_TYPE_QUARTER' },
    { reportDate: '2026-07-29', periodYear: 2026, periodNum: 2, periodType: 'PERIOD_TYPE_QUARTER' },
    {
      reportDate: '2026-10-28',
      periodYear: 2026,
      periodNum: 3,
      periodType: 'PERIOD_TYPE_QUARTER',
    },
  ],
});

const FUNDAMENTALS = JSON.stringify({
  fundamentals: [
    {
      assetUid: 'asset-sber',
      peRatioTtm: 3.29,
      priceToBookTtm: 0.71,
      roe: 22.88,
      netMarginMrq: 0,
      totalDebtToEquityMrq: 0,
      netDebtToEbitda: 0,
      dividendYieldDailyTtm: 12.8,
      fiveYearsAverageDividendYield: 9.15,
    },
  ],
});

const FACTORS = [
  'Рыночные факторы за 30 дн. (данные на 2026-11-07):',
  '• Нефть Brent: 98,64 USD за баррель, за 30 дн.: +0,13 % (98,51 → 98,64)',
  '• Доллар/рубль: 82,18 RUB, за 30 дн.: -3,79 % (85,42 → 82,18)',
  '• Ключевая ставка ЦБ: 14,00 % годовых — действует с 2026-07-27',
].join('\n');

const CB_MEETINGS =
  'Заседания ЦБ по ключевой ставке: 2026-12-18 (опорное), 2027-02-12 (предварительное) (план на 2026-11-01).';

const BRAND = JSON.stringify({ brand: { sector: 'SECTOR_FINANCIAL' } });

const profiles = parseCompanyProfiles({
  sectors: [
    { key: 'financial', drivers: ['ставка', 'кредитование'], currency: 'neutral', rate: 'negative' },
    { key: 'energy', drivers: ['нефть', 'курс рубля'], currency: 'positive', rate: 'negative' },
  ],
});

describe('расчёты аналитики', () => {
  it('читает рыночные факторы из своих же строк', () => {
    const factors = parseFactors(FACTORS);

    expect(factors.map((factor) => factor.title)).toEqual([
      'Нефть Brent',
      'Доллар/рубль',
      'Ключевая ставка ЦБ',
    ]);
    expect(factors[0].value).toBe(98.64);
    expect(factors[1].changePct).toBe(-3.79);
    expect(factors[2].note).toBe('действует с 2026-07-27');
  });

  it('считает ожидаемую дату отчётности по периодичности', () => {
    const reports = parseReportCalendar(REPORTS, NOW);

    expect(reports.last).toEqual({ date: '2026-10-28', label: '3 кв. 2026' });
    expect(reports.cadenceDays).toBe(91);
    expect(reports.next).toEqual({ date: '2027-01-27', estimated: true });
    // Одно событие — не повод придумывать следующую дату.
    expect(
      parseReportCalendar(JSON.stringify({ events: [{ reportDate: '2026-10-28' }] }), NOW).next,
    ).toBeUndefined();
    expect(parseReportCalendar('не json', NOW)).toEqual({});
  });

  it('нулевые показатели брокера считает отсутствующими', () => {
    const fundamentals = parseFundamentals(FUNDAMENTALS);

    expect(fundamentals?.pe).toBe(3.29);
    expect(fundamentals?.roe).toBe(22.88);
    expect(fundamentals?.netMargin).toBeUndefined();
    expect(fundamentals?.netDebtToEbitda).toBeUndefined();
    expect(parseFundamentals('{}')).toBeUndefined();
  });

  it('ставит вердикты по порогам и не выдумывает данные', () => {
    const items = scoreItems({
      upsidePct: 31.05,
      price: 291.77,
      target: 382.37,
      fundamentals: parseFundamentals(FUNDAMENTALS),
    });
    const verdict = (label: string): string | undefined =>
      items.find((item) => item.label === label)?.verdict;

    expect(verdict('Мнение аналитиков')).toBe('хорошо');
    expect(verdict('Дивиденды')).toBe('хорошо');
    expect(verdict('Рентабельность капитала')).toBe('хорошо');
    expect(verdict('Долговая нагрузка')).toBe('нет данных');
    expect(items[0].detail).toContain('потенциал +31,05 %');
    expect(items[3].detail).toContain('долговую нагрузку брокер не раскрыл');
  });

  it('пишет календарь только датами из данных', () => {
    const items = calendarItems({
      now: NOW,
      report: parseReportCalendar(REPORTS, NOW),
      dividendLast: { recordDate: '2026-07-20' },
      cbMeetings: parseCbMeetingLines(CB_MEETINGS),
    });

    expect(items.map((item) => `${item.date} ${item.title}`)).toEqual([
      '2027-01-27 Отчётность',
      '2026-07-20 Дивиденды',
      '2026-12-18 Заседание ЦБ',
    ]);
    expect(items[0].note).toContain('оценка');
    expect(calendarItems({ now: NOW })).toEqual([]);
  });

  it('направление влияния берёт из профиля сектора', () => {
    const lines = driverLines({
      sectorDrivers: ['нефть', 'курс рубля'],
      currency: 'positive',
      rate: 'negative',
      factors: parseFactors(FACTORS),
    });

    expect(lines[0]).toBe('Драйверы сектора: нефть, курс рубля.');
    expect(lines[1]).toContain('Нефть Brent: 98,64 USD за баррель');
    expect(lines[1]).toContain('плюс (оценка)');
    // Рубль укрепился, а экспортёр от этого проигрывает.
    expect(lines[2]).toContain('Доллар/рубль: 82,18 RUB');
    expect(lines[2]).toContain('минус (оценка)');
    expect(lines[3]).toContain('рост ставки — в минус');
  });

  it('разбирает заседания ЦБ из текста инструмента', () => {
    expect(parseCbMeetingLines(CB_MEETINGS)).toEqual([
      { date: '2026-12-18', type: 'опорное' },
      { date: '2027-02-12', type: 'предварительное' },
    ]);
    expect(parseCbMeetingLines('Плана заседаний ЦБ нет: дат в данных не найдено.')).toEqual([]);
  });
});


/** План бумаги как в разборе: плюс записи, которые планируются после справочника. */
const contextOf = (withAnalytics: boolean): FactContext => {
  const built = buildCollectionPlan({
    accounts: ['acc-1'],
    tickers: ['SBER_TQBR'],
    maxInstruments: 5,
    providers: ['securities.detail', 'securities.opinions'],
  });
  const fundamentalsEntry: PlanEntry = {
    tool: 'invest_get_asset_fundamentals',
    args: { assets: ['asset-sber'] },
    group: 'fundamentals',
    priority: 'optional',
    target: 'SBER',
  };
  const referenceEntry: PlanEntry = {
    tool: 'invest_get_brand',
    args: { id: 'brand-1' },
    group: 'reference',
    priority: 'optional',
    target: 'SBER',
  };
  const entries = [...built.entries, fundamentalsEntry, referenceEntry];
  const texts: Record<string, string> = {
    invest_get_forecast: FORECAST,
    invest_get_share_dividends: DIVIDENDS,
    invest_get_instrument_reports: REPORTS,
    market__factors: FACTORS,
    macro__cb_meetings: CB_MEETINGS,
    invest_get_asset_fundamentals: FUNDAMENTALS,
    invest_get_brand: BRAND,
  };
  // Без аналитики остаются только позиции и цены: бумага известна, событий нет.
  const baseTexts: Record<string, string> = {
    invest_get_portfolio: PORTFOLIO,
    invest_get_positions: POSITIONS,
    invest_get_market_values: PRICES,
  };
  const results = new Map<string, string>();
  for (const entry of entries) {
    const text = baseTexts[entry.tool] ?? (withAnalytics ? texts[entry.tool] : undefined);
    if (text !== undefined) {
      results.set(planKey(entry), text);
    }
  }
  return {
    plan: { entries, maxInstruments: 5 },
    collected: { results, coverage: [], partial: false },
    template: loadReportTemplate(templatePath),
    now: NOW,
    scope: 'instrument',
    scopeTarget: 'SBER',
  };
};

describe('секции аналитической записки', () => {
  const providers = new Map(createAnalyticsProviders(profiles).map((item) => [item.id, item]));
  const section = (id: string, withAnalytics = true): string | undefined =>
    providers.get(id)?.section(contextOf(withAnalytics))?.markdown;

  it('«что влияет» показывает драйверы сектора и ставку числами', () => {
    const markdown = section('analytics.drivers') ?? '';

    expect(markdown).toContain('Факторы для SBER (финансы)');
    expect(markdown).toContain('Драйверы сектора: ставка, кредитование');
    expect(markdown).toContain('Ключевая ставка ЦБ: 14,00 % годовых');
    expect(markdown).toContain('рост ставки — в минус (оценка)');
    // Нефть к финансовому сектору не относится — в блок не попадает.
    expect(markdown).not.toContain('Нефть Brent');
  });

  it('«хорошо / нейтрально / плохо» считает по числам и помечает ориентиры', () => {
    const markdown = section('analytics.scorecard') ?? '';

    expect(markdown).toContain('Мнение аналитиков: хорошо — потенциал +31,05 %');
    expect(markdown).toContain('Рентабельность капитала: хорошо — ROE 22,88 %');
    expect(markdown).toContain('Долговая нагрузка: нет данных');
    expect(markdown).toContain('Ориентиры кода, а не рекомендация');
  });

  it('«чего ждём» перечисляет отчётность, дивиденды и заседание ЦБ', () => {
    const markdown = section('analytics.calendar') ?? '';

    expect(markdown).toContain('2027-01-27 — Отчётность');
    expect(markdown).toContain('2026-07-20 — Дивиденды');
    expect(markdown).toContain('2026-12-18 — Заседание ЦБ');
  });

  it('без данных говорит прямо, а не выдумывает сроки', () => {
    expect(section('analytics.calendar', false)).toContain('Дат в данных нет');
    // Драйверов нет — необязательная секция просто не попадает в отчёт.
    expect(providers.get('analytics.drivers')?.section(contextOf(false))?.missing).toContain(
      'драйверов сектора',
    );
  });

  it('в разборе бумаги появляются все три блока', () => {
    const ctx = contextOf(true);
    const report = buildReport({
      template: ctx.template,
      providers: createProviderMap({ profiles }),
      plan: ctx.plan,
      collected: ctx.collected,
      now: NOW,
      scope: 'instrument',
      scopeTarget: 'SBER',
    });

    const ids = report.sections.map((item) => item.id);
    expect(ids).toContain('drivers');
    expect(ids).toContain('scorecard');
    expect(ids).toContain('calendar');
    // Блоки идут до вывода по бумаге: сначала факты, потом текст модели.
    expect(ids.indexOf('scorecard')).toBeLessThan(ids.indexOf('conclusion'));
  });
});


describe('сбор календаря и фундаментала', () => {
  it('недоступность необязательных источников попадает в покрытие, а не в ошибку', async () => {
    const plan = {
      entries: [
        {
          tool: 'invest_get_positions',
          args: {},
          group: 'portfolio' as const,
          priority: 'mandatory' as const,
        },
        {
          tool: 'invest_get_instrument_reports',
          args: {},
          group: 'reports_calendar' as const,
          priority: 'optional' as const,
        },
        {
          tool: 'invest_get_asset_fundamentals',
          args: {},
          group: 'fundamentals' as const,
          priority: 'optional' as const,
        },
      ],
      maxInstruments: 5,
    };
    const collected = await executePlan(plan, {
      tool: (name) =>
        name === 'invest_get_positions'
          ? fakeTool(name, async () => POSITIONS)
          : fakeTool(name, async () => {
              throw new Error('нет доступа');
            }),
      budget: new ToolBudget({ maxCalls: 10, deadlineMs: 5_000 }),
      parallelism: 1,
      timeoutMs: 100,
    });

    // Данные портфеля собраны, провал необязательных источников виден в покрытии.
    expect(collected.results.size).toBe(1);
    const missing = collected.coverage.filter((entry) => entry.status === 'missing');
    expect(missing.map((entry) => entry.source)).toEqual([
      'invest_get_instrument_reports',
      'invest_get_asset_fundamentals',
    ]);
    expect(missing[0].reason).toContain('нет доступа');
    // Пометка частичности — про полноту данных, а не про провал разбора.
    expect(collected.partial).toBe(true);
  });

  it('в собранном отчёте есть блок недоступных источников и дисклеймер', () => {
    const ctx = contextOf(false);
    const report = buildReport({
      template: ctx.template,
      providers: createProviderMap({ profiles }),
      plan: ctx.plan,
      collected: {
        ...ctx.collected,
        coverage: [
          { source: 'invest_get_instrument_reports', status: 'missing', reason: 'нет доступа' },
        ],
        partial: true,
      },
      now: NOW,
      scope: 'instrument',
      scopeTarget: 'SBER',
    });
    const text = composeMarkdown(report, {}, 'бумаги SBER');

    expect(text).toContain('## Недоступные источники');
    expect(text).toContain('invest_get_instrument_reports: нет доступа');
    expect(text).toContain('а не инвестиционная рекомендация');
  });
});

