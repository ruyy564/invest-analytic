import {
  DATA_SOURCE,
  DISCLAIMER,
  formatAllAccountsReport,
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

describe('отчёт по всем счетам', () => {
  const money = (amount: number) => ({ amount, currency: 'RUB', raw: String(amount), isPoints: false });
  const position = (ticker: string, amount: number) => ({
    instrument: { uid: ticker, ticker, name: ticker },
    quantity: money(amount),
  });

  it('перечисляет каждый счёт, состав и общий итог', () => {
    const report = formatAllAccountsReport(
      [
        {
          accountId: 'acc-1',
          title: 'Долгосрочный',
          portfolio: {
            accountId: 'acc-1',
            currency: 'RUB',
            totalValue: money(237100.43),
            positions: [position('SBER', 77), position('NVTK', 19)],
            dataAsOf: '2026-10-29T15:47:13Z',
          },
        },
        {
          accountId: 'acc-2',
          title: 'Пустой',
          portfolio: {
            accountId: 'acc-2',
            currency: 'RUB',
            totalValue: money(0),
            positions: [],
            dataAsOf: '2026-10-29T15:47:13Z',
          },
        },
      ],
      { dataAsOf: '2026-10-29T15:47:13Z' },
    );

    expect(report).toContain('Долгосрочный (acc-1)');
    expect(report).toContain('SBER: 77,00 шт.');
    expect(report).toContain('Позиций нет: Пустой (acc-2)');
    expect(report).toContain('Итого по всем счетам: 237 100,43 RUB');
    expect(report).toContain(DISCLAIMER);
  });

  it('пишет «состав недоступен», а не «позиций нет», если брокер не вернул состав', () => {
    const report = formatAllAccountsReport(
      [
        {
          accountId: 'acc-3',
          portfolio: {
            accountId: 'acc-3',
            currency: 'RUB',
            totalValue: money(570.97),
            positions: [],
            positionsUnavailable: true,
            dataAsOf: '2026-10-29T15:47:13Z',
          },
        },
      ],
      { dataAsOf: '2026-10-29T15:47:13Z' },
    );

    expect(report).toContain('состав недоступен');
    expect(report).not.toContain('позиций нет');
  });

  it('перечисляет счета, по которым данные не получены', () => {
    const report = formatAllAccountsReport([], {
      dataAsOf: '2026-10-29T15:47:13Z',
      failures: [{ accountId: 'acc-9', title: 'Карта', reason: 'Account not found' }],
    });

    expect(report).toContain('Не удалось получить данные');
    expect(report).toContain('Карта (acc-9): Account not found');
    expect(report).toContain(`Итого по всем счетам: ${UNAVAILABLE}`);
  });

  it('показывает цену и стоимость позиции, когда они известны', () => {
    const priced = {
      instrument: { uid: 'uid-1', ticker: 'SBER', name: 'Сбербанк', classCode: 'TQBR' },
      quantity: money(77),
      currentPrice: money(296.7),
      positionValue: money(22845.9),
    };
    const report = formatAllAccountsReport(
      [
        {
          accountId: 'acc-4',
          title: 'Долгосрочный',
          portfolio: {
            accountId: 'acc-4',
            currency: 'RUB',
            totalValue: money(22845.9),
            positions: [priced],
            dataAsOf: '2026-10-29T15:47:13Z',
          },
        },
      ],
      { dataAsOf: '2026-10-29T15:47:13Z' },
    );

    expect(report).toContain('SBER: 77,00 шт. × 296,70 RUB = 22 845,90 RUB');
    expect(report).toContain('стоимость позиций по текущим ценам: 22 845,90 RUB');
    expect(report).not.toContain('цены и стоимость позиций недоступны');
  });
});

