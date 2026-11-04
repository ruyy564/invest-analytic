import { join } from 'node:path';
import { ConfigError } from '../../src/config/config.error.js';
import { buildCollectionPlan, planKey, ANALYTICS_MAX_INSTRUMENTS, CANDLES_MAX_INSTRUMENTS } from '../../src/collection/plan.js';
import type { CollectionResult } from '../../src/collection/executor.js';
import { buildReport, composeMarkdown, missingProviders } from '../../src/report/engine.js';
import { createProviderMap } from '../../src/report/providers/index.js';
import { parseYaml } from '../../src/report/yaml.js';
import { loadReportTemplate, parseReportTemplate, templateProviders } from '../../src/report/template.js';

const templatePath = join(import.meta.dirname, '..', '..', 'reports', 'portfolio-review.yaml');

const POSITIONS = JSON.stringify({
  securities: [
    { balance: '100', ticker: 'SBER', classCode: 'TQBR' },
    { balance: '10', ticker: 'SU26238', classCode: 'TQCB' },
  ],
});

const PORTFOLIO = JSON.stringify({ totalAmountCurrencies: [{ currency: 'rub', units: '150000' }] });

const PRICES = JSON.stringify({
  instruments: [
    {
      ticker: 'SBER',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '300' } }],
    },
    {
      ticker: 'SU26238',
      classCode: 'TQCB',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '900' } }],
    },
  ],
});

const plan = () => {
  const built = buildCollectionPlan({
    accounts: ['acc-1'],
    tickers: ['SBER', 'SU26238'],
    maxInstruments: 15,
    providers: ['portfolio.table', 'portfolio.structure', 'portfolio.concentration', 'portfolio.gaps'],
  });
  return built;
};

const collection = (built: ReturnType<typeof plan>): CollectionResult => {
  const results = new Map<string, string>();
  for (const entry of built.entries) {
    if (entry.tool === 'invest_get_portfolio') {
      results.set(planKey(entry), PORTFOLIO);
    }
    if (entry.tool === 'invest_get_positions') {
      results.set(planKey(entry), POSITIONS);
    }
    if (entry.tool === 'invest_get_market_values') {
      results.set(planKey(entry), PRICES);
    }
    if (entry.tool === 'invest_list_accounts') {
      results.set(planKey(entry), JSON.stringify({ accounts: [{ id: 'acc-1' }] }));
    }
  }
  return { results, coverage: [], partial: false };
};

describe('разбор шаблона отчёта', () => {
  it('читает YAML-подмножество: комментарии, вложенность, список объектов', () => {
    const parsed = parseYaml(`# комментарий
id: test
periods: [1d, 7d]
thresholds:
  concentration_high: 0.5
sections:
  - id: a
    title: Первая
    provider: portfolio.snapshot
    interpret: true
`) as Record<string, unknown>;

    expect(parsed.id).toBe('test');
    expect(parsed.periods).toEqual(['1d', '7d']);
    expect((parsed.thresholds as Record<string, unknown>).concentration_high).toBe(0.5);
    expect((parsed.sections as unknown[])[0]).toMatchObject({
      id: 'a',
      provider: 'portfolio.snapshot',
      interpret: true,
    });
  });

  it('загружает реальный шаблон проекта и видит все секции', () => {
    const template = loadReportTemplate(templatePath);

    expect(template.id).toBe('portfolio-review');
    expect(template.periods).toEqual(['1d', '7d', '30d', '180d']);
    expect(template.thresholds.concentrationHigh).toBe(0.5);
    expect(template.sections.map((section) => section.id)).toEqual([
      'table',
      'macro',
      'securities',
      'opinions',
      'structure',
      'concentration',
      'tax',
      'gaps',
      'verdict',
    ]);
    expect(template.sections.filter((section) => section.interpret).map((section) => section.id)).toEqual([
      'macro',
      'opinions',
      'verdict',
    ]);
  });

  it('отклоняет шаблон без провайдера и с дублем секции', () => {
    expect(() =>
      parseReportTemplate(
        {
          id: 'x',
          version: 1,
          periods: ['1d'],
          sections: [{ id: 'a' }, { id: 'a', provider: 'p' }],
        },
        'test.yaml',
      ),
    ).toThrow(ConfigError);
  });

  it('все провайдеры шаблона зарегистрированы', () => {
    expect(missingProviders(loadReportTemplate(templatePath), createProviderMap())).toEqual([]);
  });
});


describe('сборка отчёта движком', () => {
  const build = (providers = createProviderMap()) => {
    const built = plan();
    return buildReport({
      template: loadReportTemplate(templatePath),
      providers,
      plan: built,
      collected: collection(built),
      now: new Date('2026-11-04T12:00:00Z'),
      reportId: 'report-1',
    });
  };

  it('идёт по секциям шаблона и считает числа по собранным данным', () => {
    const report = build();
    const table = report.sections.find((section) => section.id === 'table');

    expect(report.reportId).toBe('report-1');
    expect(report.templateVersion).toBe(2);
    expect(report.sections).toHaveLength(9);
    expect(table?.markdown).toContain('SBER');
    // 100 × 300 + 10 × 900 = 39 000
    expect(table?.markdown).toContain('39 000,00');
    // Сектор в таблице: справочник в этом сборе не собирался — честное «не определён».
    expect(table?.markdown).toContain('сектор не определён');
  });

  it('помечает отчёт частичным, если источники не собраны', () => {
    const report = build();

    expect(report.partial).toBe(true);
    // Макро нет (ставка не собрана), а бумаги и итог есть — их и интерпретируем.
    expect(report.interpretation.map((request) => request.id)).toEqual(['opinions', 'verdict']);
    expect(report.sections.find((section) => section.id === 'tax')?.markdown).toContain('Данных нет');
  });

  it('отдаёт секции интерпретации, когда для них есть факты', () => {
    const built = buildCollectionPlan({
      accounts: ['acc-1'],
      tickers: ['SBER'],
      maxInstruments: 15,
      providers: ['macro.context', 'facts.brief', 'securities.opinions'],
    });
    const results = new Map<string, string>();
    for (const entry of built.entries) {
      if (entry.tool === 'macro__key_rate') {
        results.set(planKey(entry), 'Ключевая ставка ЦБ: 14,00 % годовых\nДействует с 2026-07-27');
      }
      if (entry.tool === 'market__news_digest') {
        results.set(planKey(entry), 'Новости свежие:\n• 2026-11-04 [interfax] Заголовок');
      }
    }

    const report = buildReport({
      template: loadReportTemplate(templatePath),
      providers: createProviderMap(),
      plan: built,
      collected: { results, coverage: [], partial: false },
      reportId: 'report-3',
    });

    // Позиций в этом сборе нет: остаётся только макро.
    expect(report.interpretation.map((request) => request.id)).toEqual(['macro']);
    expect(report.interpretation[0].brief).toContain('ставка ЦБ 14,00 %');
  });

  it('подставляет интерпретацию модели и добавляет дисклеймер', () => {
    const report = build();
    const text = composeMarkdown(report, {
      macro: 'Ставка снижается (оценка).',
      opinions: 'SBER — растёт.',
      verdict: 'Совет: добрать облигации.',
    });

    expect(text).toContain('## Экономический цикл и рынок');
    expect(text).toContain('Ставка снижается (оценка).');
    expect(text).toContain('не является индивидуальной инвестиционной рекомендацией');
  });

  it('не оставляет заглушек вместо интерпретации', () => {
    const report = build();
    const text = composeMarkdown(report, {});

    expect(text).not.toContain('секцию формулирует модель');
    expect(text).toContain('Раздел не сформирован');
  });

  it('сообщает об отсутствии данных, если позиции не собраны', () => {
    const built = plan();
    const empty: CollectionResult = { results: new Map(), coverage: [], partial: false };
    const report = buildReport({
      template: loadReportTemplate(templatePath),
      providers: createProviderMap(),
      plan: built,
      collected: empty,
      reportId: 'report-2',
    });

    const table = report.sections.find((section) => section.id === 'table');
    expect(table?.markdown).toContain('Данных нет');
    expect(report.partial).toBe(true);
  });
});

describe('шаблон управляет отчётом', () => {
  it('изменение шаблона меняет отчёт без правок кода', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = join(mkdtempSync(join(tmpdir(), 'template-')), 'custom.yaml');
    writeFileSync(
      path,
      [
        'id: custom',
        'version: 7',
        'periods: [1d]',
        'thresholds:',
        '  concentration_high: 0.10',
        '  concentration_medium: 0.05',
        '  min_class_share: 0.01',
        'sections:',
        '  - id: snapshot',
        '    title: Только снимок',
        '    provider: portfolio.table',
        '    render: table',
      ].join('\n'),
      'utf8',
    );

    const template = loadReportTemplate(path);
    const built = plan();
    const report = buildReport({
      template,
      providers: createProviderMap(),
      plan: built,
      collected: collection(built),
    });

    expect(template.version).toBe(7);
    expect(template.thresholds.concentrationHigh).toBe(0.1);
    expect(report.sections.map((section) => section.id)).toEqual(['snapshot']);
  });

  it('лимит бумаг ограничивает расширенную аналитику', () => {
    const tickers = Array.from({ length: 40 }, (_, index) => `T${index}`);
    const built = buildCollectionPlan({
      accounts: ['acc-1'],
      tickers,
      maxInstruments: 15,
      providers: ['securities.detail', 'securities.opinions'],
    });

    // Аналитика — только по крупнейшим бумагам (дорогая часть плана), свечи — по лимиту разбора.
    expect(built.entries.filter((entry) => entry.group === 'analytics')).toHaveLength(
      ANALYTICS_MAX_INSTRUMENTS,
    );
    expect(built.entries.filter((entry) => entry.group === 'dividends')).toHaveLength(
      ANALYTICS_MAX_INSTRUMENTS,
    );
    expect(built.entries.filter((entry) => entry.group === 'news')).toHaveLength(
      ANALYTICS_MAX_INSTRUMENTS,
    );
    // Свечи — один вызов на бумагу, без поиска инструмента.
    expect(built.entries.filter((entry) => entry.group === 'candles')).toHaveLength(
      CANDLES_MAX_INSTRUMENTS,
    );
    expect(built.maxInstruments).toBe(15);
  });
});

describe('факты поставщиков', () => {
  const ctx = () => {
    const built = plan();
    return {
      plan: built,
      collected: collection(built),
      template: loadReportTemplate(templatePath),
      now: new Date('2026-11-04T12:00:00Z'),
    };
  };

  it('считает концентрацию по порогам шаблона', () => {
    const facts = createProviderMap().get('portfolio.concentration')?.section(ctx());

    expect(facts?.structured).toMatchObject({
      level: expect.stringMatching(/высокая|умеренная|низкая/),
    });
    expect(facts?.markdown).toContain('Топ-3 позиции');
  });

  it('находит пробел по классу активов', () => {
    const facts = createProviderMap().get('portfolio.gaps')?.section(ctx());

    expect(facts?.markdown).toContain('фонды');
    expect(facts?.markdown).toContain('ниже порога');
  });

  it('распознаёт консенсус аналитиков и считает потенциал', () => {
    const built = buildCollectionPlan({
      accounts: ['acc-1'],
      tickers: ['SBER_TQBR'],
      maxInstruments: 15,
      providers: ['securities.opinions'],
    });
    const results = new Map<string, string>();
    for (const entry of built.entries) {
      if (entry.tool === 'invest_get_portfolio') {
        results.set(planKey(entry), PORTFOLIO);
      }
      if (entry.tool === 'invest_get_positions') {
        results.set(planKey(entry), POSITIONS);
      }
      if (entry.tool === 'invest_get_market_values') {
        results.set(planKey(entry), PRICES);
      }
      if (entry.tool === 'invest_get_forecast') {
        results.set(
          planKey(entry),
          JSON.stringify({
            consensus: {
              ticker: 'SBER',
              recommendation: 'RECOMMENDATION_BUY',
              consensus: { value: '382.37' },
              minTarget: { value: '320' },
              maxTarget: { value: '430' },
              currentPrice: { value: '291.77' },
              priceChangeRel: { value: '31.05' },
            },
          }),
        );
      }
    }

    const facts = createProviderMap().get('securities.opinions')?.section({
      plan: built,
      collected: { results, coverage: [], partial: false },
      template: loadReportTemplate(templatePath),
      now: new Date('2026-11-04T12:00:00Z'),
    });

    expect(facts?.markdown).toContain('SBER');
    expect(facts?.brief).toContain('потенциал +31,05 %');
  });
});

describe('область разбора в отчёте', () => {
  it('в разборе одной бумаги не показывает налоги, пробелы и разрезы', () => {
    const built = plan();
    const report = buildReport({
      template: loadReportTemplate(templatePath),
      providers: createProviderMap(),
      plan: built,
      collected: collection(built),
      reportId: 'report-4',
      scope: 'instrument',
    });

    expect(report.scope).toBe('instrument');
    expect(report.sections.map((section) => section.id)).toEqual([
      'table',
      'macro',
      'securities',
      'opinions',
      'verdict',
    ]);
    // Провайдеры тоже считаются по области: налоги в разбор бумаги не идут.
    expect(templateProviders(loadReportTemplate(templatePath), 'instrument')).not.toContain(
      'tax.context',
    );
  });

  it('в разборе счёта оставляет разрезы и налоги', () => {
    const built = plan();
    const report = buildReport({
      template: loadReportTemplate(templatePath),
      providers: createProviderMap(),
      plan: built,
      collected: collection(built),
      reportId: 'report-5',
      scope: 'account',
    });

    expect(report.sections.map((section) => section.id)).toEqual([
      'table',
      'macro',
      'securities',
      'opinions',
      'structure',
      'concentration',
      'tax',
      'gaps',
      'verdict',
    ]);
  });

  it('шапка отчёта называет область разбора', () => {
    const built = plan();
    const report = buildReport({
      template: loadReportTemplate(templatePath),
      providers: createProviderMap(),
      plan: built,
      collected: collection(built),
      reportId: 'report-6',
    });
    const text = composeMarkdown(report, {}, 'бумаги SBER');

    expect(text.startsWith('Разбор бумаги SBER (шаблон v2)')).toBe(true);
  });
});
