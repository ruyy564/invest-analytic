import {
  DATA_SOURCE,
  DISCLAIMER,
  formatDataAsOf,
  formatMoney,
  formatNumber,
  formatPortfolioReport,
  formatPosition,
  UNAVAILABLE,
} from '../../src/agent/report/portfolio-report.js';
import { buildPortfolioReportPrompt } from '../../src/agent/prompts/portfolio-report.js';
import type { Portfolio } from '../../src/tools/mappers/portfolio.mapper.js';

const PORTFOLIO: Portfolio = {
  accountId: 'acc-1',
  currency: 'RUB',
  totalValue: { amount: 152345.67, currency: 'RUB', raw: '152345.67', isPoints: false },
  expectedYield: { amount: 12345.67, currency: 'RUB', raw: '12345.67', isPoints: false },
  dataAsOf: '2026-10-29T15:47:13Z',
  positions: [
    {
      instrument: { uid: 'uid-1', positionUid: 'pos-1', ticker: 'SBER', name: 'Сбербанк' },
      quantity: { amount: 100, currency: 'RUB', raw: '100', isPoints: false },
      currentPrice: { amount: 294.55, currency: 'RUB', raw: '294.55', isPoints: false },
      positionValue: { amount: 29455, currency: 'RUB', raw: '29455.00', isPoints: false },
    },
    {
      instrument: { uid: 'uid-2', positionUid: 'pos-2', ticker: 'GAZP', name: 'Газпром' },
      quantity: { amount: 250, currency: 'RUB', raw: '250', isPoints: false },
    },
  ],
};

describe('форматтеры отчёта', () => {
  it('форматирует числа с двумя знаками и пробелами между тысячами', () => {
    expect(formatNumber(152345.67)).toBe('152 345,67');
    expect(formatNumber(-10)).toBe('-10,00');
    expect(formatNumber(0.5)).toBe('0,50');
  });

  it('помечает недоступные значения и пункты', () => {
    expect(formatMoney(undefined)).toBe(UNAVAILABLE);
    expect(
      formatMoney({ amount: 10, currency: 'RUB', raw: '10', isPoints: false }),
    ).toBe('10,00 RUB');
    expect(formatMoney({ amount: 10, currency: 'pt', raw: '10', isPoints: true })).toBe('10,00 пт');
  });

  it('печатает позицию и помечает отсутствие цены', () => {
    expect(formatPosition(PORTFOLIO.positions[0]!)).toBe(
      'SBER (Сбербанк): 100,00 шт. × 294,55 RUB = 29 455,00 RUB',
    );
    expect(formatPosition(PORTFOLIO.positions[1]!)).toContain(UNAVAILABLE);
  });

  it('приводит время данных к ISO с часовым поясом', () => {
    expect(formatDataAsOf('2026-10-29T15:47:13Z')).toBe('2026-10-29T15:47:13.000Z');
    expect(formatDataAsOf('не дата', new Date('2026-10-29T12:00:00Z'))).toBe(
      '2026-10-29T12:00:00.000Z',
    );
  });
});

describe('отчёт по портфелю', () => {
  it('содержит позиции, итоги, доходность, источник и дисклеймер', () => {
    const report = formatPortfolioReport(PORTFOLIO, { dataAsOf: PORTFOLIO.dataAsOf });

    expect(report).toContain('SBER (Сбербанк)');
    expect(report).toContain('Итого: 152 345,67 RUB');
    expect(report).toContain('Доходность: 12 345,67 RUB');
    expect(report).toContain(`Источник: ${DATA_SOURCE}`);
    expect(report).toContain('2026-10-29T15:47:13.000Z');
    expect(report).toContain(DISCLAIMER);
  });

  it('не показывает доходность, если её нет в данных', () => {
    const report = formatPortfolioReport(
      { ...PORTFOLIO, expectedYield: undefined },
      { dataAsOf: PORTFOLIO.dataAsOf },
    );

    expect(report).not.toContain('Доходность');
  });

  it('явно сообщает о пустом портфеле', () => {
    const report = formatPortfolioReport(
      { ...PORTFOLIO, positions: [], totalValue: undefined, expectedYield: undefined },
      { dataAsOf: PORTFOLIO.dataAsOf },
    );

    expect(report).toContain('Портфель пуст');
    expect(report).toContain('Итого: недоступно');
  });
});

describe('промпт отчёта', () => {
  it('перечисляет требования и подставляет время данных', () => {
    const prompt = buildPortfolioReportPrompt('2026-10-29T15:47:13.000Z');

    expect(prompt).toContain('недоступно');
    expect(prompt).toContain('доходность');
    expect(prompt).toContain(DISCLAIMER);
    expect(prompt).toContain('2026-10-29T15:47:13.000Z');
  });
});
